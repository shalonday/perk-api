jest.mock("../services/ingest/scraper", () => ({
  scrapeContent: jest.fn(),
}));

const { scrapeContent } = require("../services/ingest/scraper");

const {
  analyzeIngest,
  validateIngestUrl,
  getWhitelistedSite,
  WhitelistedSite,
  extractEducationalContent,
} = require("../services/ingest/service");
const {
  isAllowedHostname,
  DEFAULT_ALLOWED_HOSTNAMES,
} = require("../services/ingest/scraperConfig");

describe("analyzeIngest(req,res)", () => {
  const createMockRes = () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  });

  beforeEach(() => {
    scrapeContent.mockReset();
  });

  test("analyzeIngest(<request with Khan Academy link>,res) => { prerequisites: [], objectives: [] }", async () => {
    const req = {
      body: {
        url: "https://www.khanacademy.org/v/sample-video",
      },
    };
    const res = createMockRes();

    scrapeContent.mockResolvedValueOnce({
      title: "Sample lesson",
      content: "Page title\nVideo transcript\nFirst line\nSecond line",
    });

    await analyzeIngest(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      url: "https://www.khanacademy.org/v/sample-video",
      title: "Sample lesson",
      content: "First line\nSecond line",
      prerequisites: [], // TODO: mock these too
      objectives: [], // TODO: mock these too
    });
  });

  test("analyzeIngest(<request with non-Khan Academy link>,res) => { prerequisites: [], objectives: [] }", async () => {
    const req = {
      body: {
        url: "https://www.freecodecamp.org/news/sample-article",
      },
    };
    const res = createMockRes();

    scrapeContent.mockResolvedValueOnce({
      title: "Sample article",
      content: "Some content from the article",
    });

    await analyzeIngest(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      url: "https://www.freecodecamp.org/news/sample-article",
      title: "Sample article",
      content: "Some content from the article",
      prerequisites: [], // TODO: mock these too
      objectives: [], // TODO: mock these too
    });
  });

  test("analyzeIngest(<request with invalid body>,res) => res.status(400).json({ error })", async () => {
    const req = {
      body: {},
    };
    const res = createMockRes();

    await analyzeIngest(req, res);

    expect(scrapeContent).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("validateIngestUrl(string, object): { url: URL } | null", () => {
  // Create a mock response object
  const createMockRes = () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  });

  test.each(DEFAULT_ALLOWED_HOSTNAMES)(
    "allowed hostname %s passes validation",
    (allowedHostname) => {
      const mockRes = createMockRes();
      const result = validateIngestUrl(
        `https://${allowedHostname}/learn`,
        mockRes,
      );

      expect(result).toEqual({
        url: new URL(`https://${allowedHostname}/learn`),
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

describe("isAllowedHostname(string, string[]): boolean", () => {
  test("isAllowedHostname('example.com', DEFAULT_ALLOWED_HOSTNAMES) => false", () => {
    expect(isAllowedHostname("example.com", DEFAULT_ALLOWED_HOSTNAMES)).toBe(
      false,
    );
  });

  test("isAllowedHostname('example.com', ['example.com']) => true", () => {
    expect(isAllowedHostname("example.com", ["example.com"])).toBe(true);
  });

  test("isAllowedHostname('docs.example.com', ['example.com']) => true", () => {
    expect(isAllowedHostname("docs.example.com", ["example.com"])).toBe(true);
  });

  test("isAllowedHostname('www.example.com', ['www.example.com']) => true", () => {
    expect(isAllowedHostname("www.example.com", ["www.example.com"])).toBe(
      true,
    );
  });

  test("isAllowedHostname('example.com', ['www.example.com']) => false (allowed hostname is more specific than the input hostname)", () => {
    expect(isAllowedHostname("example.com", ["www.example.com"])).toBe(false);
  });

  test("isAllowedHostname('data.example.com', ['www.example.com']) => false", () => {
    expect(isAllowedHostname("data.example.com", ["www.example.com"])).toBe(
      false,
    );
  });
});

describe("scrapeContent(url)", () => {
  // Test implementation goes here, I think only integration tests would fully cover this since it involves network requests.
});

// add to this as we get more whitelisted sites
describe("getWhiteListedSite(url)", () => {
  test("getWhitelistedSite('https://www.khanacademy.org/v/sample-video') => WhitelistedSite.KHAN_ACADEMY", () => {
    expect(
      getWhitelistedSite("https://www.khanacademy.org/v/sample-video"),
    ).toBe(WhitelistedSite.KHAN_ACADEMY);
  });

  test("getWhitelistedSite('https://developer.mozilla.org/en-US/docs/Web/JavaScript') => null", () => {
    expect(
      getWhitelistedSite(
        "https://developer.mozilla.org/en-US/docs/Web/JavaScript",
      ),
    ).toBeNull();
  });
});

// TODO: add to this as we get more whitelisted sites
describe("extractEducationalContent(rawContent, site, url)", () => {
  // KhanAcademy site extraction works
  test("extractEducationalContent('Page title\nVideo transcript\nFirst line\nSecond   line\nUp next:\nUnrelated text', WhitelistedSite.KHAN_ACADEMY, 'https://www.khanacademy.org/v/sample-video') => 'First line\nSecond line'", () => {
    const rawContent =
      "Page title\nVideo transcript\nFirst line\nSecond   line\nUp next:\nUnrelated text";
    const site = WhitelistedSite.KHAN_ACADEMY;
    const url = "https://www.khanacademy.org/v/sample-video";
    const extractedContent = extractEducationalContent(rawContent, site, url);
    expect(extractedContent).toBe("First line\nSecond line");
  });

  // unwhitelisted site extraction returns the raw content
  test("extractEducationalContent('Some content', null, 'https://www.example.com') => 'Some content'", () => {
    const rawContent = "Some content";
    const site = null;
    const url = "https://www.example.com";
    const extractedContent = extractEducationalContent(rawContent, site, url);
    expect(extractedContent).toBe("Some content");
  });
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
