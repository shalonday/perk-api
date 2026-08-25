const { normalizeHostname } = require("../scraperConfig");

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

module.exports = {
  isKhanAcademyUrl,
};
