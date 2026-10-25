const {
  isAllowedHostname,
  DEFAULT_ALLOWED_HOSTNAMES,
} = require("./scraperConfig");
const { scrapeContent } = require("./scraper");
const {
  extractKhanAcademyTranscriptOrBody,
  isKhanAcademyUrl,
} = require("./extractors/khanAcademyExtractor");
const { extractPrereqsAndObjectivesFromContent } = require("./llmClient");
const {
  embedText,
  fetchNodesWithEmbeddings,
  rankNodesBySimilarity,
} = require("../embeddings/searchService");

const CANONICAL_SKILL_SIMILARITY_THRESHOLD = 0.8;

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
 * Finds an existing skill that is sufficiently similar to an extracted term.
 *
 * @param {string} term - Skill term to look up.
 * @param {{ node: object, embedding: number[] }[]} embeddedSkills - Candidate skills.
 * @returns {Promise<string | null>} Canonical term when found, otherwise null.
 */
async function lookupCanonicalPrereqOrObjective(term, embeddedSkills) {
  if (embeddedSkills.length === 0) return null;

  const queryEmbedding = await embedText(term);
  const [bestMatch] = rankNodesBySimilarity(embeddedSkills, queryEmbedding, 1);

  if (
    bestMatch &&
    bestMatch.similarity >= CANONICAL_SKILL_SIMILARITY_THRESHOLD
  ) {
    return bestMatch.node.name;
  }

  return null;
}

/**
 * Canonicalizes a list of prerequisite and objective terms by looking up each term in the database.
 * For each item in the given prereqs and objectives skill list, conduct fuzzy search on the neo4j database.
 * If there is a result sufficiently similar enough to call a duplicate, consider the item in the db as the canonical version and replace the original item with it.
 * Return the canonicalized list of prerequisites and objectives, including those that were not found in the database.
 * @param {string[]} prerequisites - Prerequisite terms.
 * @param {string[]} objectives - Objective terms.
 * @param {object} driver - Neo4j driver.
 * @returns {Promise<{ prerequisites: string[], objectives: string[] }>} Canonicalized terms.
 */
async function canonicalizePrereqsAndObjectives(
  prerequisites,
  objectives,
  driver,
) {
  const terms = [...new Set([...prerequisites, ...objectives])];

  const embeddedSkills = await fetchNodesWithEmbeddings(driver, ["Skill"]);
  // Resolve unique terms concurrently and store each result as [original, canonical-or-null].
  // The map lets both lists reuse those lookups without embedding duplicate terms again.
  const canonicalTerms = new Map(
    await Promise.all(
      terms.map(async (term) => [
        term,
        await lookupCanonicalPrereqOrObjective(term, embeddedSkills),
      ]),
    ),
  );

  return {
    prerequisites: prerequisites.map(
      (term) => canonicalTerms.get(term) ?? term,
    ),
    objectives: objectives.map((term) => canonicalTerms.get(term) ?? term),
  };
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
 * @param {() => Promise<object>} getDriver - Resolves the shared Neo4j driver.
 * @returns {Promise<import("express").Response>} Express response.
 */
async function analyzeIngest(req, res, getDriver) {
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

    // extract prerequisites and objectives using LLM-backed extraction
    const { prerequisites, objectives } =
      await extractPrereqsAndObjectivesFromContent(educContent, pageData.title);

    console.log("Extracted prerequisites:", prerequisites);
    console.log("Extracted objectives:", objectives);

    if (typeof getDriver !== "function") {
      throw new Error("Neo4j driver provider is unavailable.");
    }
    const driver = await getDriver();

    const canonicalized = await canonicalizePrereqsAndObjectives(
      prerequisites,
      objectives,
      driver,
    );

    return res.status(200).json({
      url: parsedUrl.toString(),
      title: pageData.title,
      content: educContent,
      prerequisites: canonicalized.prerequisites,
      objectives: canonicalized.objectives,
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
  lookupCanonicalPrereqOrObjective,
  canonicalizePrereqsAndObjectives,
  analyzeIngest,
  validateIngestUrl,
};
