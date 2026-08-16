const DEFAULT_ALLOWED_DOMAINS = [
  "developer.mozilla.org",
  "www.w3schools.com",
  "en.wikipedia.org",
  "archive.org",
  "www.freecodecamp.org",
  "www.khanacademy.org",
  "www.codecademy.com",
  "www.coursera.org",
  "www.edx.org",
  "www.udemy.com",
  "www.youtube.com",
];

/**
 * Normalizes a domain into a canonical hostname without port, protocol, or www.
 *
 * @param {string} value - Raw domain or URL to normalize.
 * @returns {string} Canonical hostname.
 */
function normalizeHostname(value) {
  if (!value || typeof value !== "string") {
    return "";
  }

  try {
    const url = new URL(value);
    return url.hostname.toLowerCase();
  } catch {
    return value
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//i, "");
  }
}

/**
 * Checks whether a hostname is allowed by the configured whitelist.
 *
 * @param {string} hostname - Hostname to validate.
 * @param {string[] | undefined} allowedDomains - Optional override list.
 * @returns {boolean} True when the hostname matches the whitelist.
 */
function isAllowedDomain(hostname, allowedDomains = DEFAULT_ALLOWED_DOMAINS) {
  if (!hostname || typeof hostname !== "string") {
    return false;
  }

  const canonicalHostname = normalizeHostname(hostname);
  if (!canonicalHostname) {
    return false;
  }

  const normalizedAllowed = (allowedDomains ?? []).map((domain) =>
    normalizeHostname(domain),
  );

  return normalizedAllowed.some(
    (allowed) =>
      canonicalHostname === allowed ||
      canonicalHostname.endsWith(`.${allowed}`) ||
      canonicalHostname === allowed.replace(/^www\./i, ""),
  );
}

module.exports = {
  DEFAULT_ALLOWED_DOMAINS,
  normalizeHostname,
  isAllowedDomain,
};
