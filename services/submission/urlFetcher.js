/**
 * URL Fetcher Utility (Puppeteer Wrapper)
 *
 * Fetches and extracts structured content from URLs using a headless browser.
 * - Lazy-initializes browser on first use, reuses across fetches.
 * - Extracts title, meta description, headings, and readable body text.
 * - Graceful shutdown on application exit.
 */

const puppeteer = require("puppeteer");

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

/** Maximum characters for extracted body text. */
const MAX_TEXT_LENGTH = 5000;

/** Default page navigation timeout in milliseconds (15 seconds). */
const DEFAULT_TIMEOUT_MS = 15_000;

/** HTTP status codes that should return null (content inaccessible). */
const NULL_STATUS_CODES = new Set([403, 404, 410, 451]);

// --------------------------------------------------------------------------
// Browser Instance Management
// --------------------------------------------------------------------------

/** @type {import('puppeteer').Browser | null} */
let browserInstance = null;

/** Whether a browser launch is currently in progress. */
let browserLaunching = false;

/** Queue of resolve/reject callbacks waiting for the browser to launch. */
const launchQueue = [];

/**
 * Get or lazily initialize the shared Puppeteer browser instance.
 * If a launch is already in progress, callers queue up and share the result.
 *
 * @returns {Promise<import('puppeteer').Browser>} The shared browser instance.
 */
async function getBrowser() {
  // Return existing instance if still connected
  if (browserInstance && browserInstance.connected) {
    return browserInstance;
  }

  // If a launch is in progress, wait for it
  if (browserLaunching) {
    return new Promise((resolve, reject) => {
      launchQueue.push({ resolve, reject });
    });
  }

  browserLaunching = true;

  try {
    const timeout =
      parseInt(process.env.PUPPETEER_TIMEOUT, 10) || DEFAULT_TIMEOUT_MS;

    browserInstance = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
      defaultViewport: { width: 1280, height: 800 },
      timeout,
    });

    // Resolve all queued callers
    for (const { resolve } of launchQueue) {
      resolve(browserInstance);
    }
    launchQueue.length = 0;

    return browserInstance;
  } catch (error) {
    // Reject all queued callers
    for (const { reject } of launchQueue) {
      reject(error);
    }
    launchQueue.length = 0;

    throw error;
  } finally {
    browserLaunching = false;
  }
}

/**
 * Close the shared browser instance gracefully.
 * Safe to call multiple times — no-ops if already closed.
 *
 * @returns {Promise<void>}
 */
async function closeBrowser() {
  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch {
      // Browser may already be disconnected — ignore
    }
    browserInstance = null;
  }
}

// Register graceful shutdown handlers
process.on("SIGINT", closeBrowser);
process.on("SIGTERM", closeBrowser);
process.on("exit", () => {
  // Synchronous — can't await, but signals intent
  if (browserInstance) {
    browserInstance.close().catch(() => {});
    browserInstance = null;
  }
});

// --------------------------------------------------------------------------
// Content Extraction Helpers
// --------------------------------------------------------------------------

/**
 * Extract structured content from a loaded page.
 * Runs inside the browser context via page.evaluate().
 *
 * @param {import('puppeteer').Page} page - The Puppeteer page.
 * @param {number} maxTextLength - Maximum characters for body text.
 * @returns {Promise<{ title: string, description: string, headings: string[], text: string }>}
 */
async function extractPageContent(page, maxTextLength) {
  return page.evaluate((maxLen) => {
    // --- Title ---
    const title = document.title || "";

    // --- Meta description ---
    const metaDesc =
      document.querySelector('meta[name="description"]')?.content || "";

    // --- Headings (H1 and H2) ---
    const headingElements = document.querySelectorAll("h1, h2");
    const headings = Array.from(headingElements)
      .map((el) => el.textContent?.trim())
      .filter(Boolean)
      .slice(0, 20); // Limit to 20 headings

    // --- Body text (strip scripts, styles, nav, footer) ---
    // Clone body to avoid modifying the live DOM
    const bodyClone = document.body.cloneNode(true);

    // Remove non-content elements
    const removeSelectors = [
      "script",
      "style",
      "noscript",
      "nav",
      "footer",
      "header",
      "aside",
      "iframe",
      "svg",
      "[role='navigation']",
      "[role='banner']",
      "[role='contentinfo']",
      ".sidebar",
      ".nav",
      ".footer",
      ".header",
      ".advertisement",
      ".ad",
    ];

    for (const selector of removeSelectors) {
      const elements = bodyClone.querySelectorAll(selector);
      for (const el of elements) {
        el.remove();
      }
    }

    // Extract text and normalize whitespace
    const rawText = bodyClone.textContent || "";
    const text = rawText.replace(/\s+/g, " ").trim().slice(0, maxLen);

    return { title, description: metaDesc, headings, text };
  }, maxTextLength);
}

// --------------------------------------------------------------------------
// Main Fetcher Function
// --------------------------------------------------------------------------

/**
 * Fetch and extract structured content from a URL.
 *
 * Flow:
 * 1. Open a new page in the shared browser.
 * 2. Navigate to the URL with a timeout.
 * 3. Extract title, meta description, headings, and body text.
 * 4. On timeout: return partial data (metadata only).
 * 5. On 404/403: return null.
 * 6. On JS errors: retry once.
 *
 * @param {string} url - The URL to fetch content from.
 * @returns {Promise<{ title: string, description: string, headings: string[], text: string } | null>}
 *   Structured content, or null if the page is inaccessible (404/403).
 */
async function fetchUrlContent(url) {
  if (!url || typeof url !== "string") {
    console.error("[urlFetcher] Invalid URL provided:", url);
    return null;
  }

  const timeout =
    parseInt(process.env.PUPPETEER_TIMEOUT, 10) || DEFAULT_TIMEOUT_MS;

  let page = null;
  let retried = false;

  /**
   * Attempt to fetch content from the URL.
   * Separated into a helper to support retry on JS errors.
   *
   * @returns {Promise<{ title: string, description: string, headings: string[], text: string } | null>}
   */
  async function attemptFetch() {
    const browser = await getBrowser();
    page = await browser.newPage();

    // Block unnecessary resource types for faster loading
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const resourceType = request.resourceType();
      if (["image", "media", "font", "stylesheet"].includes(resourceType)) {
        request.abort();
      } else {
        request.continue();
      }
    });

    // Collect JS errors for retry logic
    const jsErrors = [];
    page.on("pageerror", (error) => {
      jsErrors.push(error.message);
    });

    let response;
    try {
      response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout,
      });
    } catch (navigationError) {
      // Timeout during navigation
      if (navigationError.name === "TimeoutError") {
        console.warn(
          `[urlFetcher] Navigation timeout for ${url} — extracting partial data`,
        );
        // Try to extract whatever metadata loaded before timeout
        try {
          const partialContent = await extractPageContent(
            page,
            MAX_TEXT_LENGTH,
          );
          return {
            title: partialContent.title || "",
            description: partialContent.description || "",
            headings: partialContent.headings || [],
            text: "", // No body text on timeout
          };
        } catch {
          return { title: "", description: "", headings: [], text: "" };
        }
      }
      throw navigationError;
    }

    // Check HTTP status
    const status = response ? response.status() : 0;
    if (NULL_STATUS_CODES.has(status)) {
      console.warn(`[urlFetcher] HTTP ${status} for ${url} — returning null`);
      return null;
    }

    // Check for JS errors and retry once
    if (jsErrors.length > 0 && !retried) {
      console.warn(
        `[urlFetcher] JavaScript errors on ${url}: ${jsErrors[0]} — retrying`,
      );
      retried = true;
      await page.close();
      page = null;
      return attemptFetch();
    }

    // Extract content
    const content = await extractPageContent(page, MAX_TEXT_LENGTH);

    return {
      title: content.title || "",
      description: content.description || "",
      headings: content.headings || [],
      text: content.text || "",
    };
  }

  try {
    return await attemptFetch();
  } catch (error) {
    console.error(`[urlFetcher] Failed to fetch ${url}: ${error.message}`);
    return null;
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
        // Page may already be closed — ignore
      }
    }
  }
}

/**
 * Fetch content from multiple URLs in parallel.
 *
 * @param {string[]} urls - Array of URLs to fetch.
 * @returns {Promise<Array<{ url: string, content: { title: string, description: string, headings: string[], text: string } | null }>>}
 */
async function fetchMultipleUrls(urls) {
  if (!Array.isArray(urls) || urls.length === 0) {
    return [];
  }

  const results = await Promise.all(
    urls.map(async (url) => {
      const content = await fetchUrlContent(url);
      return { url, content };
    }),
  );

  return results;
}

// --------------------------------------------------------------------------
// Exports
// --------------------------------------------------------------------------

module.exports = {
  fetchUrlContent,
  fetchMultipleUrls,
  closeBrowser,
  getBrowser,
  MAX_TEXT_LENGTH,
  DEFAULT_TIMEOUT_MS,
  NULL_STATUS_CODES,
};
