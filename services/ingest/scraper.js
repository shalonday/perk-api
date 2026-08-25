const { chromium } = require("playwright");
const { isKhanAcademyUrl } = require("./extractors/khanAcademyExtractor");

/**
 * Loads a page with a real browser and extracts the main readable text.
 *
 * @param {string} url - URL to scrape.
 * @returns {Promise<{ content: string, title?: string }>} Extracted page content and title.
 */
async function scrapeContent(url) {
  if (!url || typeof url !== "string" || !url.trim()) {
    throw new Error("A valid URL is required.");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Please provide a valid URL.");
  }

  const browser = await chromium.launch({
    headless: true,
  });

  try {
    const page = await browser.newPage();

    let response;
    if (isKhanAcademyUrl(parsedUrl)) {
      try {
        response = await page.goto(parsedUrl.toString(), {
          waitUntil: "networkidle",
          timeout: 45000,
        });
      } catch (error) {
        if (error?.name !== "TimeoutError") {
          throw error;
        }

        response = await page.goto(parsedUrl.toString(), {
          waitUntil: "domcontentloaded",
          timeout: 45000,
        });
      }
    } else {
      response = await page.goto(parsedUrl.toString(), {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
    }

    if (!response || response.status() >= 400) {
      throw new Error("Unable to load the page for ingestion.");
    }

    const title = await page.title().catch(() => "");

    const content = await page
      .evaluate(() => {
        const articleRoot =
          document.querySelector("main") ??
          document.querySelector("article") ??
          document.body;

        const text = articleRoot?.innerHTML ?? "";
        return text.replace(/\s+/g, " ").trim();
      })
      .catch(() => "");

    if (!content) {
      throw new Error("Unable to load the page for ingestion.");
    }

    return {
      content,
      title: title || undefined,
    };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

module.exports = {
  scrapeContent,
};
