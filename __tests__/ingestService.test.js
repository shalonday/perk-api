const {
  WhitelistedSite,
  getWhitelistedSite,
  extractEducationalContent,
} = require("../services/ingest/service");

describe("WhitelistedSite & extractEducationalContent", () => {
  test("identifies Khan Academy URLs", () => {
    expect(
      getWhitelistedSite("https://www.khanacademy.org/v/sample-video"),
    ).toBe(WhitelistedSite.KHAN_ACADEMY);
    expect(
      getWhitelistedSite(
        "https://developer.mozilla.org/en-US/docs/Web/JavaScript",
      ),
    ).toBeNull();
  });

  test("extracts educational content for Khan Academy using transcript extraction", () => {
    const rawContent =
      "Welcome\nTranscript\nImportant lesson content\nUp next:\nFooters";
    const result = extractEducationalContent(
      rawContent,
      WhitelistedSite.KHAN_ACADEMY,
      "https://www.khanacademy.org/v/sample-video",
    );

    expect(result).toBe("Important lesson content");
  });

  test("returns raw content for unhandled or unknown sites", () => {
    const rawContent = "Some raw text content";
    const result = extractEducationalContent(
      rawContent,
      null,
      "https://example.com",
    );

    expect(result).toBe("Some raw text content");
  });
});
