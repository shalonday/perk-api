const DEFAULT_ALLOWED_HOSTNAMES = [
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
 * Checks whether a hostname is allowed by the configured whitelist.
 *
 * @param {string} hostname - nonempty string hostname to validate.
 * @param {string[] | undefined} allowedDomains - Optional override list.
 * @returns {boolean} True when the hostname matches the whitelist.
 */
function isAllowedHostname(
  hostname,
  allowedHostnames = DEFAULT_ALLOWED_HOSTNAMES,
) {
  return allowedHostnames.some(
    (allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`),
  );
}

module.exports = {
  DEFAULT_ALLOWED_HOSTNAMES,
  isAllowedHostname,
};
