const {
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
