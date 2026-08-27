const { isAllowedDomain } = require("./scraperConfig");
const { scrapeContent } = require("./scraper");

/**
 * Analyzes an allowed learning URL and returns its scraped content.
 *
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} Express response.
 */
async function analyzeIngest(req, res) {
  const { url } = req.body ?? {};

  if (!url || typeof url !== "string" || !url.trim()) {
    return res.status(400).json({ error: "Please provide a valid URL." });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: "Please provide a valid URL." });
  }

  if (
    !parsedUrl.protocol ||
    parsedUrl.protocol !== "https:" ||
    !parsedUrl.hostname
  ) {
    return res.status(400).json({ error: "Please provide a valid HTTPS URL." });
  }

  if (!isAllowedDomain(parsedUrl.hostname)) {
    return res.status(400).json({
      error:
        "URL domain is not allowed for ingestion. Please use one of the approved learning sites.",
    });
  }

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
