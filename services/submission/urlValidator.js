/**
 * URL Validator Utility
 *
 * Validates URLs for safety using a hybrid approach:
 * - Fast-path: Check against trusted domain whitelist
 * - Slow-path: Query external safety API for unknown domains (with caching)
 */

require("dotenv").config();

// --------------------------------------------------------------------------
// Domain Whitelist
// --------------------------------------------------------------------------

/**
 * Default list of trusted educational domains.
 * These domains skip external safety checks.
 */
const DEFAULT_TRUSTED_DOMAINS = [
  // Documentation & References
  "developer.mozilla.org",
  "docs.microsoft.com",
  "learn.microsoft.com",
  "docs.oracle.com",
  "docs.python.org",
  "docs.rs",
  "doc.rust-lang.org",
  "golang.org",
  "go.dev",
  "ruby-doc.org",
  "php.net",
  "kotlinlang.org",
  "typescriptlang.org",
  "reactjs.org",
  "react.dev",
  "vuejs.org",
  "angular.io",
  "svelte.dev",
  "nextjs.org",
  "nodejs.org",
  "deno.land",

  // Learning Platforms
  "coursera.org",
  "udemy.com",
  "udacity.com",
  "edx.org",
  "khanacademy.org",
  "codecademy.com",
  "freecodecamp.org",
  "pluralsight.com",
  "linkedin.com", // LinkedIn Learning
  "skillshare.com",
  "egghead.io",
  "frontendmasters.com",
  "scrimba.com",
  "exercism.org",
  "leetcode.com",
  "hackerrank.com",
  "codewars.com",

  // Developer Communities & Q&A
  "stackoverflow.com",
  "stackexchange.com",
  "dev.to",
  "hashnode.com",
  "medium.com",
  "css-tricks.com",
  "smashingmagazine.com",
  "digitalocean.com", // DigitalOcean tutorials
  "scotch.io",
  "hackernoon.com",

  // Code Hosting & Collaboration
  "github.com",
  "gitlab.com",
  "bitbucket.org",
  "gist.github.com",
  "codepen.io",
  "codesandbox.io",
  "replit.com",
  "jsfiddle.net",
  "stackblitz.com",

  // Video Platforms
  "youtube.com",
  "youtu.be",
  "vimeo.com",
  "twitch.tv",

  // Academic & Research
  "arxiv.org",
  "scholar.google.com",
  "researchgate.net",
  "acm.org",
  "ieee.org",
  "mit.edu",
  "stanford.edu",
  "berkeley.edu",
  "harvard.edu",
  "ox.ac.uk",
  "cam.ac.uk",

  // Cloud Provider Docs
  "aws.amazon.com",
  "cloud.google.com",
  "azure.microsoft.com",
  "firebase.google.com",
  "vercel.com",
  "netlify.com",
  "heroku.com",

  // Other Trusted Sources
  "w3schools.com",
  "tutorialspoint.com",
  "geeksforgeeks.org",
  "baeldung.com",
  "javatpoint.com",
  "programiz.com",
  "realpython.com",
  "learnpython.org",
];

/**
 * Get the full list of trusted domains, including environment overrides.
 * @returns {string[]} Array of trusted domain names
 */
function getTrustedDomains() {
  const envDomains = process.env.TRUSTED_DOMAINS;
  if (envDomains) {
    const additionalDomains = envDomains
      .split(",")
      .map((d) => d.trim().toLowerCase());
    return [...DEFAULT_TRUSTED_DOMAINS, ...additionalDomains];
  }
  return DEFAULT_TRUSTED_DOMAINS;
}

// --------------------------------------------------------------------------
// Safety Check Cache
// --------------------------------------------------------------------------

/**
 * In-memory cache for external safety check results.
 * Key: domain, Value: { safe: boolean, timestamp: number }
 */
const safetyCache = new Map();

/** Cache TTL: 24 hours in milliseconds */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Get cached safety result for a domain.
 * @param {string} domain - The domain to check
 * @returns {{ safe: boolean } | null} Cached result or null if expired/missing
 */
function getCachedResult(domain) {
  const cached = safetyCache.get(domain);
  if (!cached) return null;

  const isExpired = Date.now() - cached.timestamp > CACHE_TTL_MS;
  if (isExpired) {
    safetyCache.delete(domain);
    return null;
  }

  return { safe: cached.safe };
}

/**
 * Store safety result in cache.
 * @param {string} domain - The domain
 * @param {boolean} safe - Whether the domain is safe
 */
function setCachedResult(domain, safe) {
  safetyCache.set(domain, { safe, timestamp: Date.now() });
}

// --------------------------------------------------------------------------
// URL Validation
// --------------------------------------------------------------------------

/**
 * Check if an IP address is in a private range.
 * Private ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8
 * @param {string} domain - The domain/IP to check
 * @returns {boolean} True if domain is a private IP
 */
function isPrivateIPRange(domain) {
  // Check for localhost/loopback range (127.x.x.x)
  if (domain.startsWith("127.")) {
    return true;
  }

  // Check for 10.x.x.x range
  if (domain.startsWith("10.")) {
    return true;
  }

  // Check for 192.168.x.x range
  if (domain.startsWith("192.168.")) {
    return true;
  }

  // Check for 172.16.0.0/12 range (172.16.x.x to 172.31.x.x)
  if (domain.startsWith("172.")) {
    const parts = domain.split(".");
    if (parts.length >= 2) {
      const secondOctet = parseInt(parts[1], 10);
      // Range is 172.16.0.0 to 172.31.255.255
      if (secondOctet >= 16 && secondOctet <= 31) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Validate URL format and extract domain.
 * @param {string} url - The URL to validate
 * @returns {{ valid: boolean, domain?: string, reason?: string }}
 */
function validateUrlFormat(url) {
  if (url === null || url === undefined) {
    return { valid: false, reason: "URL is required" };
  }

  if (typeof url !== "string") {
    return { valid: false, reason: "URL must be a string" };
  }

  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    return { valid: false, reason: "URL cannot be empty" };
  }

  // Check for valid protocol
  if (!trimmedUrl.startsWith("http://") && !trimmedUrl.startsWith("https://")) {
    return { valid: false, reason: "URL must start with http:// or https://" };
  }

  // Reject URLs with consecutive slashes (malformed)
  if (
    trimmedUrl.includes("//") &&
    !trimmedUrl.startsWith("https://") &&
    !trimmedUrl.startsWith("http://")
  ) {
    return {
      valid: false,
      reason: "URL contains consecutive slashes — please verify the URL format",
    };
  }
  // More specific check for consecutive slashes after protocol
  const afterProtocol = trimmedUrl.replace(/^https?:\/\//, "");
  if (afterProtocol.includes("//")) {
    return {
      valid: false,
      reason: "URL contains consecutive slashes — please verify the URL format",
    };
  }

  try {
    const parsed = new URL(trimmedUrl);

    // Reject non-http(s) protocols
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { valid: false, reason: "Only HTTP and HTTPS URLs are allowed" };
    }

    // Extract domain (without port)
    const domain = parsed.hostname.toLowerCase();

    // Basic domain validation
    if (!domain || domain.length < 3) {
      return { valid: false, reason: "Invalid domain" };
    }

    // Reject localhost and private IPs
    if (domain === "localhost" || domain === "0.0.0.0") {
      return { valid: false, reason: "Local and private URLs are not allowed" };
    }

    // Check for private IP ranges
    const isPrivateIP = isPrivateIPRange(domain);
    if (isPrivateIP) {
      return { valid: false, reason: "Local and private URLs are not allowed" };
    }

    return { valid: true, domain };
  } catch {
    return { valid: false, reason: "Invalid URL format" };
  }
}

/**
 * Check if a domain is in the trusted whitelist.
 * Matches exact domain or subdomain of trusted domain.
 * @param {string} domain - The domain to check
 * @returns {boolean} True if domain is trusted
 */
function isDomainTrusted(domain) {
  const trustedDomains = getTrustedDomains();
  const lowerDomain = domain.toLowerCase();

  for (const trusted of trustedDomains) {
    // Exact match
    if (lowerDomain === trusted) {
      return true;
    }
    // Subdomain match (e.g., "www.github.com" matches "github.com")
    if (lowerDomain.endsWith("." + trusted)) {
      return true;
    }
  }

  return false;
}

// --------------------------------------------------------------------------
// External Safety API
// --------------------------------------------------------------------------

/**
 * Check URL safety using URLhaus API.
 * This is the slow-path for domains not on the whitelist.
 *
 * @param {string} url - The URL to check
 * @returns {Promise<{ safe: boolean, reason?: string, failedCheck?: boolean }>}
 */
async function checkExternalSafety(url) {
  const endpoint =
    process.env.URLHAUS_API_URL || "https://urlhaus-api.abuse.ch/v1/url/";
  const requestBody = new URLSearchParams({ url }).toString();

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: requestBody,
    });

    if (!response.ok) {
      console.error(
        `[urlValidator] URLhaus API error: ${response.status} ${response.statusText}`,
      );
      // Fail open on API errors - allow URL but flag as failed check
      return { safe: true, failedCheck: true };
    }

    const data = await response.json();
    const queryStatus = String(data.query_status || "").toLowerCase();
    const threat = String(data.threat || "").toLowerCase();

    if (queryStatus === "ok" && threat && threat !== "clean") {
      console.warn(`[urlValidator] URL flagged as unsafe: ${url} (${threat})`);
      return { safe: false, reason: "URL flagged by security service" };
    }

    return { safe: true };
  } catch (error) {
    console.error(
      `[urlValidator] External safety check failed: ${error.message}`,
    );
    // Fail open on network errors - flag as failed check
    return { safe: true, failedCheck: true };
  }
}

// --------------------------------------------------------------------------
// Main Validation Function
// --------------------------------------------------------------------------

/**
 * Validate a URL for safety using hybrid approach.
 *
 * 1. Validate URL format
 * 2. Fast-path: Check domain against whitelist
 * 3. Slow-path: Check cache, then query external API
 *
 * @param {string} url - The URL to validate
 * @returns {Promise<{ safe: boolean, reason?: string, warnings?: string[] }>}
 */
async function validateUrlSafety(url) {
  const warnings = [];

  // Step 1: Validate URL format
  const formatResult = validateUrlFormat(url);
  if (!formatResult.valid) {
    return { safe: false, reason: formatResult.reason };
  }

  const { domain } = formatResult;

  // Step 2: Fast-path - check whitelist
  if (isDomainTrusted(domain)) {
    return { safe: true };
  }

  // Step 3: Check cache
  const cached = getCachedResult(domain);
  if (cached !== null) {
    return cached.safe
      ? { safe: true }
      : { safe: false, reason: "Domain previously flagged as unsafe" };
  }

  // Step 4: Slow-path - external API check
  const externalResult = await checkExternalSafety(url);

  // Add warning if external check failed
  if (externalResult.failedCheck) {
    warnings.push(
      "Safety verification unavailable — admin will review this URL",
    );
  }

  // Cache the result
  setCachedResult(domain, externalResult.safe);

  // Build response with warnings if present
  const response = { safe: externalResult.safe };
  if (externalResult.reason) {
    response.reason = externalResult.reason;
  }
  if (warnings.length > 0) {
    response.warnings = warnings;
  }

  return response;
}

/**
 * Validate multiple URLs for safety.
 *
 * @param {string[]} urls - Array of URLs to validate
 * @returns {Promise<{ allSafe: boolean, results: Array<{ url: string, safe: boolean, reason?: string }> }>}
 */
async function validateMultipleUrls(urls) {
  if (!Array.isArray(urls) || urls.length === 0) {
    return {
      allSafe: false,
      results: [{ url: "", safe: false, reason: "URLs array is required" }],
    };
  }

  const results = await Promise.all(
    urls.map(async (url) => {
      const result = await validateUrlSafety(url);
      return { url, ...result };
    }),
  );

  const allSafe = results.every((r) => r.safe);

  return { allSafe, results };
}

/**
 * Clear the safety cache (useful for testing).
 */
function clearCache() {
  safetyCache.clear();
}

/**
 * Get cache size (useful for monitoring).
 * @returns {number} Number of cached entries
 */
function getCacheSize() {
  return safetyCache.size;
}

module.exports = {
  validateUrlSafety,
  validateMultipleUrls,
  validateUrlFormat,
  isDomainTrusted,
  clearCache,
  getCacheSize,
  // Exported for testing
  DEFAULT_TRUSTED_DOMAINS,
};
