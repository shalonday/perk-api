const { normalizeHostname } = require("../scraperConfig");

const TRANSCRIPT_START_MARKERS = ["transcript"];
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
 * Extracts transcript or instructional body text from visible page text.
 *
 * @param {string} text - Raw rendered visible page text.
 * @param {string} url - Page URL used to identify article pages.
 * @returns {{body: string, transcriptUsed: boolean}} Extracted body and source flag.
 */
function extractTranscriptOrBody(text, url) {
  const lines = [];
  for (const line of typeof text === "string" ? text.split(/\r?\n/) : []) {
    const cleaned = cleanLine(line);
    if (cleaned && lines.at(-1) !== cleaned) {
      lines.push(cleaned);
    }
  }

  const lowerLines = lines.map((line) => line.toLowerCase());
  const exactTranscriptIndex = lowerLines.findIndex(
    (line) => line === "transcript",
  );
  const transcriptIndex =
    exactTranscriptIndex >= 0
      ? exactTranscriptIndex
      : lowerLines.findIndex((line) =>
          TRANSCRIPT_START_MARKERS.some((marker) => line.includes(marker)),
        );
  const summaryIndex = lowerLines.findIndex((line) =>
    SUMMARY_START_MARKERS.some((marker) => line.includes(marker)),
  );
  const startIndex = transcriptIndex >= 0 ? transcriptIndex : summaryIndex;
  const transcriptUsed = startIndex >= 0;
  const bodyStartIndex = transcriptUsed ? startIndex + 1 : 0;
  const endMarkers =
    typeof url === "string" && url.includes("/a/")
      ? ARTICLE_ONLY_END_MARKERS
      : TRANSCRIPT_END_MARKERS;
  const bodyLines = [];

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
    const normalizedUrl = url instanceof URL ? url.toString() : url;
    hostname = normalizeHostname(normalizedUrl).replace(/^www\./i, "");
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
async function extractKhanAcademyPage(page, url) {
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

  const { body, transcriptUsed } = extractTranscriptOrBody(rawText, url);
  return {
    content: body,
    title: cleanLine(title),
    transcriptUsed,
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
  extractTranscriptOrBody,
  isKhanAcademyUrl,
  isSupportedKhanContentUrl,
  selectTranscriptTab,
};
