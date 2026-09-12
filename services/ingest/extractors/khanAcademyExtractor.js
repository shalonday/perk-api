const { normalizeHostname } = require("../scraperConfig");

const TRANSCRIPT_START_MARKERS = ["video transcript"];
const ARTICLE_START_MARKERS = ["share link"];
const SUMMARY_START_MARKERS = ["abouttranscript", "about transcript"];
const TRANSCRIPT_END_MARKERS = [
  "creative commons attribution",
  "video on youtube",
  "skip to main content",
  "use of cookies",
  "additional links",
  "want to join the conversation",
  "questions",
  "tips & thanks",
  "up next:",
];
const ARTICLE_ONLY_END_MARKERS = ["skip to end of discussions"];
const BOILERPLATE_LINE_MARKERS = [
  "welcome to khan academy",
  "skip to main content",
  "use of cookies",
  "additional links",
  "want to join the conversation",
  "sign up",
  "log in",
  "accept all cookies",
  "strictly necessary only",
  "cookies settings",
];

function cleanLine(line) {
  return line.replace(/\s+/g, " ").trim();
}

/**
 * Normalizes non-empty page text lines and removes consecutive duplicates.
 *
 * @param {unknown} text - Raw page text, or a non-string value.
 * @returns {string[]} Cleaned, non-empty page lines.
 */
function getNormalizedLines(text) {
  const lines = [];
  for (const line of typeof text === "string" ? text.split(/\r?\n/) : []) {
    const cleaned = cleanLine(line);
    if (cleaned && lines.at(-1) !== cleaned) {
      lines.push(cleaned);
    }
  }
  return lines;
}

/**
 * Finds where educational content begins in normalized, lowercase page lines.
 * An exact "transcript" heading takes priority, followed by transcript markers
 * and then summary markers. Returns -1 when no recognized starting marker exists.
 *
 * @param {string[]} lowerLines - Normalized page lines converted to lowercase.
 * @returns {number} Index of the preferred content-start marker, or -1.
 */
function findContentStartIndex(lowerLines) {
  const transcriptIndex = lowerLines.findIndex((line) =>
    TRANSCRIPT_START_MARKERS.some((marker) => line.includes(marker)),
  );
  if (transcriptIndex >= 0) {
    return transcriptIndex;
  }

  const articleIndex = lowerLines.findIndex((line) =>
    ARTICLE_START_MARKERS.some((marker) => line.includes(marker)),
  );
  if (articleIndex >= 0) {
    return articleIndex;
  }

  return lowerLines.findIndex((line) =>
    SUMMARY_START_MARKERS.some((marker) => line.includes(marker)),
  );
}

/**
 * Selects the end markers used to stop extraction for the given page URL.
 *
 * @param {unknown} url - Page URL used to identify article pages.
 * @returns {string[]} Markers that terminate body extraction.
 */
function getEndMarkers(url) {
  return typeof url === "string" && url.includes("/a/")
    ? ARTICLE_ONLY_END_MARKERS
    : TRANSCRIPT_END_MARKERS;
}

/**
 * Collects content lines until an end marker, excluding known boilerplate.
 * The original lines preserve output casing while lowercase lines enable matching.
 *
 * @param {string[]} lines - Normalized page lines.
 * @param {string[]} lowerLines - The same lines converted to lowercase.
 * @param {number} startIndex - Index of the content-start marker, or -1.
 * @param {string[]} endMarkers - Case-normalized markers that stop extraction.
 * @returns {string[]} Extracted content lines.
 */
function extractBodyLines(lines, lowerLines, startIndex, endMarkers) {
  const bodyLines = [];
  const bodyStartIndex = startIndex >= 0 ? startIndex + 1 : 0;

  for (let index = bodyStartIndex; index < lines.length; index += 1) {
    const lowerLine = lowerLines[index];
    if (endMarkers.some((marker) => lowerLine.includes(marker))) {
      break;
    }
    if (
      !BOILERPLATE_LINE_MARKERS.some((marker) => lowerLine.includes(marker))
    ) {
      bodyLines.push(lines[index]);
    }
  }

  return bodyLines;
}

/**
 * Extracts transcript or instructional body text from visible page text for Khan Academy pages.
 *
 * @param {string} text - Raw rendered visible page text.
 * @param {string} url - Page URL used to identify article pages.
 * @returns {{body: string, transcriptUsed: boolean}} Extracted body and source flag.
 */
function extractKhanAcademyTranscriptOrBody(text, url) {
  const lines = getNormalizedLines(text);
  const lowerLines = lines.map((line) => line.toLowerCase());
  const startIndex = findContentStartIndex(lowerLines);
  const transcriptUsed = startIndex >= 0;
  const bodyLines = extractBodyLines(
    lines,
    lowerLines,
    startIndex,
    getEndMarkers(url),
  );

  const body = bodyLines.join("\n").trim();
  return body ? { body, transcriptUsed } : { body: "", transcriptUsed: false };
}

/**
 * Checks whether a Khan Academy URL points at a supported video or article page.
 *
 * @param {string} url - Page URL to inspect.
 * @returns {boolean} True when the path contains a video ("/v/") or article ("/a/") segment.
 */
function isSupportedKhanContentUrl(url) {
  return (
    typeof url === "string" && (url.includes("/v/") || url.includes("/a/"))
  );
}

/**
 * Identifies whether a URL belongs to Khan Academy.
 *
 * @param {string | URL} url - URL to inspect.
 * @returns {boolean} True when the URL hostname is Khan Academy-owned.
 */
function isKhanAcademyUrl(url) {
  if (!(typeof url === "string" || url instanceof URL)) {
    return false;
  }

  let hostname;
  try {
    const normalizedUrl = url instanceof URL ? url : new URL(url);
    hostname = normalizedUrl.hostname;
  } catch {
    return false;
  }

  return (
    hostname === "khanacademy.org" || hostname.endsWith(".khanacademy.org")
  );
}

/**
 * Extracts rendered visible text from a Khan Academy page.
 *
 * @param {object} page - Already-navigated Playwright page.
 * @param {string} url - Page URL used by the content extractor.
 * @returns {Promise<{content: string, title: string, transcriptUsed: boolean}>} Extracted page data.
 */
async function extractKhanAcademyPage(page) {
  await dismissCookieBanner(page);
  await selectTranscriptTab(page);

  let title = "";
  try {
    title = await page.locator("h1").first().innerText({ timeout: 3000 });
  } catch {
    title = await page.title().catch(() => "");
  }

  let rawText = "";
  try {
    rawText = await page.locator("main").innerText();
  } catch {
    rawText = await page
      .locator("body")
      .innerText()
      .catch(() => "");
  }

  return {
    content: rawText,
    title: cleanLine(title),
  };
}

/**
 * Best-effort dismissal of Khan Academy cookie banners.
 *
 * @param {object} page - Playwright page containing the rendered Khan Academy page.
 * @returns {Promise<void>} Resolves after the available cookie action is attempted.
 */
async function dismissCookieBanner(page) {
  if (!page || typeof page.getByRole !== "function") {
    return;
  }

  // Try the broad consent action first, then use the necessary-only option.
  const cookieButtons = [/Accept All Cookies/i, /Strictly Necessary Only/i];

  for (const buttonName of cookieButtons) {
    try {
      await page.getByRole("button", { name: buttonName }).click({
        timeout: 3000,
      });
      // A successful click means the banner is handled; no second click is needed.
      return;
    } catch {
      // The banner may be absent or the button may no longer be interactive.
    }
  }
}

/**
 * Best-effort switch to the "Transcript" tab on Khan Academy video pages.
 *
 * @param {object} page - Playwright page containing the rendered Khan Academy page.
 * @returns {Promise<void>} Resolves after the tab switch is attempted.
 */
async function selectTranscriptTab(page) {
  if (!page || typeof page.getByRole !== "function") {
    return;
  }

  try {
    // The page defaults to the "About" tab; the transcript only renders after this click.
    await page.getByRole("tab", { name: /transcript/i }).click({
      timeout: 3000,
    });
  } catch {
    // The tab may be absent on non-video pages (e.g. articles).
  }
}

module.exports = {
  dismissCookieBanner,
  extractKhanAcademyPage,
  extractKhanAcademyTranscriptOrBody,
  isKhanAcademyUrl,
  isSupportedKhanContentUrl,
  selectTranscriptTab,
};
