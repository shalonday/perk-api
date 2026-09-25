const {
  isAllowedHostname,
  DEFAULT_ALLOWED_HOSTNAMES,
} = require("./scraperConfig");
const { scrapeContent } = require("./scraper");
const {
  extractKhanAcademyTranscriptOrBody,
  isKhanAcademyUrl,
} = require("./extractors/khanAcademyExtractor");

/**
 * Enum for names of supported whitelisted (ie scraping is already enabled) sites.
 */
const WhitelistedSite = Object.freeze({
  KHAN_ACADEMY: "KHAN_ACADEMY",
});

/**
 * Determines the WhitelistedSite enum value for a given URL.
 *
 * @param {string | URL} url - URL to inspect.
 * @returns {string | null} WhitelistedSite value, or null if unmapped.
 */
function getWhitelistedSite(url) {
  if (isKhanAcademyUrl(url)) {
    return WhitelistedSite.KHAN_ACADEMY;
  }
  return null;
}

/**
 * Given all visible text in the page, and the website name, extracts the main educational content using
 * keywords/signifiers specific to the given whitelisted site.
 *
 * @param {string} content - Raw visible page text.
 * @param {string} site - The WhitelistedSite enum value (ie the website name).
 * @param {string} [url] - Page URL used for site-specific extraction rules.
 * @returns {string} Extracted main educational content text.
 */
function extractEducationalContent(content, site, url) {
  switch (site) {
    case WhitelistedSite.KHAN_ACADEMY: {
      const body = extractKhanAcademyTranscriptOrBody(content, url);
      return body || content;
    }
    default:
      return content;
  }
}

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

  if (!isAllowedHostname(parsedUrl.hostname, DEFAULT_ALLOWED_HOSTNAMES)) {
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
    // extract visible text content
    const pageData = await scrapeContent(parsedUrl.toString());
    console.log("Scraped page data:", pageData);

    // extract educational content from visible text
    const site = getWhitelistedSite(parsedUrl.toString());
    const educContent = extractEducationalContent(
      pageData.content,
      site,
      parsedUrl.toString(),
    );

    console.log("Extracted educational content:", educContent);

    // extractPrereqsAndObjectives(educContent)
    // given the main educational content, extract the prerequisites and learning objectives by querying an LLM

    // canonicalizePrereqsAndObjectives([...prereqs, ...objectives])
    // for each item in the given combined prereqs and objectives skill list, conduct fuzzy search on the neo4j database.
    // If there is a result sufficiently similar enough to call a duplicate, consider the item in the db as the canonical version and replace the original item with it.
    // Return the canonicalized list of prerequisites and objectives, including those that were not found in the database.
    return res.status(200).json({
      url: parsedUrl.toString(),
      title: pageData.title,
      content: educContent,
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
  WhitelistedSite,
  getWhitelistedSite,
  extractEducationalContent,
  analyzeIngest,
  validateIngestUrl,
};
