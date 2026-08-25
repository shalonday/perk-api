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
    console.log(`Attempting to click cookie banner button: ${buttonName}`);
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

module.exports = {
  dismissCookieBanner,
  isKhanAcademyUrl,
};
