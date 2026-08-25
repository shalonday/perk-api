const {
  dismissCookieBanner,
  isKhanAcademyUrl,
} = require("../services/ingest/extractors/khanAcademyExtractor");

describe("isKhanAcademyUrl", () => {
  test("accepts Khan Academy hosts and subdomains", () => {
    expect(isKhanAcademyUrl("https://www.khanacademy.org/math")).toBe(true);
    expect(
      isKhanAcademyUrl("https://khan-cdn.khanacademy.org/assets/app.js"),
    ).toBe(true);
    expect(
      isKhanAcademyUrl(new URL("https://khanacademy.org/profile/me")),
    ).toBe(true);
  });

  test("rejects non-Khan and malformed values", () => {
    expect(isKhanAcademyUrl("https://example.com/lesson")).toBe(false);
    expect(isKhanAcademyUrl("malformed")).toBe(false);
    expect(isKhanAcademyUrl(42)).toBe(false);
    expect(isKhanAcademyUrl(null)).toBe(false);
  });
});

describe("dismissCookieBanner", () => {
  test("tries Accept All Cookies before Strictly Necessary Only", async () => {
    // Model the preferred button being unavailable so the fallback is exercised.
    const click = jest
      .fn()
      .mockRejectedValueOnce(new Error("Accept button unavailable"))
      .mockResolvedValueOnce(undefined);
    const page = {
      getByRole: jest.fn().mockReturnValue({ click }),
    };

    await dismissCookieBanner(page);

    expect(page.getByRole).toHaveBeenNthCalledWith(1, "button", {
      name: /Accept All Cookies/i,
    });
    expect(page.getByRole).toHaveBeenNthCalledWith(2, "button", {
      name: /Strictly Necessary Only/i,
    });
    expect(click).toHaveBeenNthCalledWith(1, { timeout: 3000 });
    expect(click).toHaveBeenNthCalledWith(2, { timeout: 3000 });
  });

  test("swallows failures when no cookie button is interactive", async () => {
    const page = {
      getByRole: jest.fn().mockReturnValue({
        click: jest.fn().mockRejectedValue(new Error("Banner unavailable")),
      }),
    };

    await expect(dismissCookieBanner(page)).resolves.toBeUndefined();
  });

  test("does nothing when the page has no role locator", async () => {
    await expect(dismissCookieBanner({})).resolves.toBeUndefined();
  });
});
