const {
  validateIngestUrl,
  getWhitelistedSite,
  WhitelistedSite,
} = require("../services/ingest/service");
const { DEFAULT_ALLOWED_DOMAINS } = require("../services/ingest/scraperConfig");

describe("analyzeIngest", () => {
  test("analyzeIngest(req,res) works correctly", () => {
    // sample request with sample content with educational content
    // that would return prerequisites [] and objectives [].
  });
});

describe("validateIngestUrl", () => {
  // Create a mock response object
  const createMockRes = () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  });

  test.each(DEFAULT_ALLOWED_DOMAINS)(
    "allowed domain %s passes validation",
    (allowedDomain) => {
      const mockRes = createMockRes();
      const result = validateIngestUrl(
        `https://${allowedDomain}/learn`,
        mockRes,
      );

      expect(result).toEqual({
        url: new URL(`https://${allowedDomain}/learn`),
      });
      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockRes.json).not.toHaveBeenCalled();
    },
  );

  test("validateIngestUrl('', mockRes) => 400 error", () => {
    const mockRes = createMockRes();
    validateIngestUrl("", mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: "Please provide a valid URL.",
    });
  });

  test("validateIngestUrl(null, mockRes) => 400 error", () => {
    const mockRes = createMockRes();
    validateIngestUrl(null, mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: "Please provide a valid URL.",
    });
  });

  test("validateIngestUrl(123, mockRes) => 400 error", () => {
    const mockRes = createMockRes();
    validateIngestUrl(123, mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: "Please provide a valid URL.",
    });
  });

  test("validateIngestUrl('not a valid url', mockRes) => 400 error", () => {
    const mockRes = createMockRes();
    validateIngestUrl("not a valid url", mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: "Please provide a valid URL.",
    });
  });

  test("validateIngestUrl('http://example.com', mockRes) => 400 error", () => {
    const mockRes = createMockRes();
    validateIngestUrl("http://example.com", mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: "Please provide a valid HTTPS URL.",
    });
  });

  test("validateIngestUrl('https://', mockRes) => 400 error", () => {
    const mockRes = createMockRes();
    validateIngestUrl("https://", mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: "Please provide a valid URL.",
    });
  });
});

describe("isAllowedDomain", () => {});

describe("normalizeHostname", () => {});

describe("scrapeContent(url)", () => {
  // Test implementation goes here, I think only integration tests would fully cover this since it involves network requests.
});

test("getWhiteListed(url) works correctly", () => {
  expect(getWhitelistedSite("https://www.khanacademy.org/v/sample-video")).toBe(
    WhitelistedSite.KHAN_ACADEMY,
  );
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
