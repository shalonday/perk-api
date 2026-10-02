const { chromium } = require("playwright");
const {
  extractKhanAcademyPage,
  isKhanAcademyUrl,
  isSupportedKhanContentUrl,
} = require("./extractors/khanAcademyExtractor");

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

  const isKhanPage = isKhanAcademyUrl(parsedUrl);
  if (isKhanPage && !isSupportedKhanContentUrl(parsedUrl.toString())) {
    throw new Error(
      "Only Khan Academy video and article pages are supported. Please submit a lesson video or article URL.",
    );
  }

  const browser = await chromium.launch({
    headless: true,
  });

  try {
    const page = await browser.newPage();

    let content;
    let title;

    if (isKhanPage) {
      let response;
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

      if (!response || response.status() >= 400) {
        throw new Error("Unable to load the page for ingestion.");
      }

      const extractedPage = await extractKhanAcademyPage(
        page,
        parsedUrl.toString(),
      );
      content = extractedPage.content;
      title = extractedPage.title;
    } else {
      const response = await page.goto(parsedUrl.toString(), {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      if (!response || response.status() >= 400) {
        throw new Error("Unable to load the page for ingestion.");
      }

      title = await page.title().catch(() => "");

      content = await page
        .evaluate(() => {
          const articleRoot =
            document.querySelector("main") ??
            document.querySelector("article") ??
            document.body;

          const text = articleRoot?.innerHTML ?? "";
          return text.replace(/\s+/g, " ").trim();
        })
        .catch(() => "");
    }

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
