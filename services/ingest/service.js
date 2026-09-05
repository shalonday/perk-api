const { isAllowedDomain } = require("./scraperConfig");
const { scrapeContent } = require("./scraper");

/**
 * Validates an ingest URL and returns parsed URL or error response.
 *
 * @param {string} url - The URL to validate.
 * @param {import("express").Response} res - Express response.
 * @returns {{ url: URL } | null} Parsed URL if valid, null if validation failed and response sent.
 */
function validateIngestUrl(url, res) {
  if (!url || typeof url !== "string" || !url.trim()) {
    res.status(400).json({ error: "Please provide a valid URL." });
    return null;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    res.status(400).json({ error: "Please provide a valid URL." });
    return null;
  }

  if (
    !parsedUrl.protocol ||
    parsedUrl.protocol !== "https:" ||
    !parsedUrl.hostname
  ) {
    res.status(400).json({ error: "Please provide a valid HTTPS URL." });
    return null;
  }

  if (!isAllowedDomain(parsedUrl.hostname)) {
    res.status(400).json({
      error:
        "URL domain is not allowed for ingestion. Please use one of the approved learning sites.",
    });
    return null;
  }

  return { url: parsedUrl };
}

/**
 * Analyzes an allowed learning URL and returns its scraped content.
 *
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} Express response.
 */
async function analyzeIngest(req, res) {
  const { url } = req.body ?? {};

  const validation = validateIngestUrl(url, res);
  if (!validation) return;

  const { url: parsedUrl } = validation;

  try {
    const pageData = await scrapeContent(parsedUrl.toString());
    console.log("Scraped page data:", pageData);
    return res.status(200).json({
      url: parsedUrl.toString(),
      title: pageData.title,
      content: pageData.content,
      prerequisites: [],
      objectives: [],
    });
  } catch (error) {
    return res.status(400).json({
      error:
        error instanceof Error
          ? error.message
          : "Unable to load the page for ingestion.",
    });
  }
}

module.exports = {
  analyzeIngest,
};
