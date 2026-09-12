const { validateIngestUrl } = require("../services/ingest/service");

describe("analyzeIngest", () => {
  test("analyzeIngest(req,res) works correctly", () => {
    // sample request with sample content with educational content
    // that would return prerequisites [] and objectives [].
  });

  test("validateIngestUrl(url, res) works correctly", () => {
    // Create a mock response object
    const createMockRes = () => ({
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    });

    // empty url causes 400 error
    let mockRes = createMockRes();
    validateIngestUrl("", mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: "Please provide a valid URL.",
    });

    // non-string url causes 400 error
    mockRes = createMockRes();
    validateIngestUrl(null, mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: "Please provide a valid URL.",
    });

    mockRes = createMockRes();
    validateIngestUrl(123, mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: "Please provide a valid URL.",
    });

    // incorrectly formed url (ie doesn't pass new URL(url)) causes 400 error
    mockRes = createMockRes();
    validateIngestUrl("not a valid url", mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: "Please provide a valid URL.",
    });

    // empty protocol (covered by new URL() parsing) and non-https protocol causes error
    mockRes = createMockRes();
    validateIngestUrl("http://example.com", mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: "Please provide a valid HTTPS URL.",
    });

    // no hostname causes error (covered by the protocol validation check)
    mockRes = createMockRes();
    validateIngestUrl("https://", mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: "Please provide a valid HTTPS URL.",
    });
  });

  test("scrapeContent(url) works correctly", () => {
    // Test implementation goes here, I think only integration tests would fully cover this since it involves network requests.
  });

  test("getWhiteListed(url) works correctly", () => {
    expect(
      getWhitelistedSite("https://www.khanacademy.org/v/sample-video"),
    ).toBe(WhitelistedSite.KHAN_ACADEMY);
    expect(
      getWhitelistedSite(
        "https://developer.mozilla.org/en-US/docs/Web/JavaScript",
      ),
    ).toBeNull();
  });

  test("extractEducationalContent(rawContent, site, url) works correctly", () => {
    // KhanAcademy site extraction works
  });

  test("extractKhanAcademyTranscriptOrBody(content, url) works correctly", () => {
    // Test implementation goes here
  });

  test("getNormalizedLines(rawContent) works correctly", () => {
    // Test implementation goes here
  });

  test("cleanLine(rawContent) works correctly", () => {
    // Test implementation goes here
  });

  test("findContentStartIndex(rawContent) works correctly", () => {
    // Test implementation goes here
  });

  test("getEndMarkers(rawContent) works correctly", () => {
    // Test implementation goes here
  });

  test("extractBodyLines(rawContent) works correctly", () => {
    // Test implementation goes here
  });

  test("extractPrereqsAndObjectives(educContent) works correctly", () => {
    // Test implementation goes here
  });

  test("canonicalizePrereqsAndObjectives([...prereqs, ...objectives]) works correctly", () => {
    // Test implementation goes here
  });
});
