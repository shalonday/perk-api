jest.mock("../services/ingest/scraper", () => ({
  scrapeContent: jest.fn(),
}));

jest.mock("../services/ingest/llmClient", () => ({
  extractPrereqsAndObjectivesFromContent: jest.fn().mockReturnValue({
    prerequisites: [],
    objectives: [],
  }),
}));

const { scrapeContent } = require("../services/ingest/scraper");
const {
  extractPrereqsAndObjectivesFromContent,
} = require("../services/ingest/llmClient");

const {
  analyzeIngest,
  validateIngestUrl,
  getWhitelistedSite,
  WhitelistedSite,
  extractEducationalContent,
  canonicalizePrereqsAndObjectives,
} = require("../services/ingest/service");
const {
  isAllowedHostname,
  DEFAULT_ALLOWED_HOSTNAMES,
} = require("../services/ingest/scraperConfig");
const {
  extractKhanAcademyTranscriptOrBody,
  __testOnly: {
    getNormalizedLines,
    cleanLine,
    findContentStartIndex,
    extractBodyLines,
  },
} = require("../services/ingest/extractors/khanAcademyExtractor");
describe("analyzeIngest(req,res)", () => {
  const createMockRes = () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  });

  beforeEach(() => {
    scrapeContent.mockReset();
    extractPrereqsAndObjectivesFromContent.mockReset();
    extractPrereqsAndObjectivesFromContent.mockReturnValue({
      prerequisites: [],
      objectives: [],
    });
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

  test("extractEducationalContent('Page title\nShare Link\nFirst line\nSecond line\nSkip to end of discussions:\nUnrelated text', WhitelistedSite.KHAN_ACADEMY, 'https://www.khanacademy.org/a/sample-article') => 'First line\nSecond line'", () => {
    const rawContent =
      "Page title\nShare Link\nFirst line\nSecond line\nSkip to end of discussions:\nUnrelated text";
    const site = WhitelistedSite.KHAN_ACADEMY;
    const url = "https://www.khanacademy.org/a/sample-article";
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

describe("extractKhanAcademyTranscriptOrBody(content, url)", () => {
  test("(/v/ url) extractKhanAcademyTranscriptOrBody('Page title\nVideo transcript\nFirst line\nSecond line\nUp next:\nUnrelated text', 'https://www.khanacademy.org/v/sample-video') => 'First line\nSecond line'", () => {
    const content =
      "Page title\nVideo transcript\nFirst line\nSecond line\nUp next:\nUnrelated text";
    const url = "https://www.khanacademy.org/v/sample-video";
    const extractedContent = extractKhanAcademyTranscriptOrBody(content, url);
    expect(extractedContent).toBe("First line\nSecond line");
  });

  test("(/a/ url) extractKhanAcademyTranscriptOrBody('Page title\nVideo transcript\nFirst line\nSecond line\nUp next:\nUnrelated text', 'https://www.khanacademy.org/a/sample-article') => 'First line\nSecond line'", () => {
    const content =
      "Page title\nShare Link\nFirst line\nSecond line\nSkip to end of discussions:\nUnrelated text";
    const url = "https://www.khanacademy.org/a/sample-article";
    const extractedContent = extractKhanAcademyTranscriptOrBody(content, url);
    expect(extractedContent).toBe("First line\nSecond line");
  });

  test("(neither /v/ nor /a/ url) extractKhanAcademyTranscriptOrBody('Page title\nrandom text\nFirst line\nSecond line\nrandom:\nUnrelated text', 'https://www.khanacademy.org/sample-page') => '<full content>'", () => {
    const content =
      "Page title\nrandom text\nFirst line\nSecond line\nrandom:\nUnrelated text";
    const url = "https://www.khanacademy.org/sample-page";
    const extractedContent = extractKhanAcademyTranscriptOrBody(content, url);
    expect(extractedContent).toBe(content);
  });
});

describe("getNormalizedLines(rawContent)", () => {
  test("getNormalizedLines('Page title\nVideo transcript\nFirst line\nSecond line\nUp next:\nUnrelated text') => ['Page title', 'Video transcript', 'First line', 'Second line', 'Up next:', 'Unrelated text']", () => {
    const rawContent =
      "Page title\nVideo transcript\nFirst line\nSecond line\nUp next:\nUnrelated text";
    expect(getNormalizedLines(rawContent)).toEqual([
      "Page title",
      "Video transcript",
      "First line",
      "Second line",
      "Up next:",
      "Unrelated text",
    ]);
  });

  test("getNormalizedLines('  line 1  \n\n  line 2  ') => ['line 1', 'line 2']", () => {
    const rawContent = "  line 1  \n\n  line 2  ";

    expect(getNormalizedLines(rawContent)).toEqual(["line 1", "line 2"]);
  });

  test("(collapses duplicate neighboring lines) getNormalizedLines('line 1\nline 1\n\nline 2') => ['line 1', 'line 2']", () => {
    expect(getNormalizedLines("line 1\nline 1\n\nline 2")).toEqual([
      "line 1",
      "line 2",
    ]);
  });
});

describe("cleanLine(rawContent)", () => {
  test("cleanLine('  line 1  ') => 'line 1'", () => {
    const rawContent = "  line 1  ";
    expect(cleanLine(rawContent)).toBe("line 1");
  });
});

describe("findContentStartIndex(rawContentLowerLines[])", () => {
  test("(video; markers are 'Video transcript' and 'Up next') findContentStartIndex(['page title', 'video transcript', 'first line', 'second line', 'up next:', 'unrelated text']) => 1", () => {
    const rawContentLines = [
      "page title",
      "video transcript",
      "first line",
      "second line",
      "up next:",
      "unrelated text",
    ];
    expect(findContentStartIndex(rawContentLines)).toBe(1);
  });

  test("(article; markers are 'Share Link' and 'Skip to end of discussions') findContentStartIndex(['page', 'title', 'share link', 'first line', 'second line', 'skip to end of discussions:', 'unrelated text']) => 2", () => {
    const rawContentLines = [
      "page",
      "title",
      "share link",
      "first line",
      "second line",
      "skip to end of discussions:",
      "unrelated text",
    ];
    expect(findContentStartIndex(rawContentLines)).toBe(2);
  });

  test("(neither video nor article; no recognizable markers) findContentStartIndex(['page title', 'randomtranscript', 'first line', 'second line', 'randomtext', 'unrelated text']) => -1", () => {
    const rawContentLines = [
      "page title",
      "randomtranscript",
      "first line",
      "second line",
      "randomtext",
      "unrelated text",
    ];
    expect(findContentStartIndex(rawContentLines)).toBe(-1);
  });
});

describe("extractBodyLines(lines, lowerLines, startIndex, endMarkers)", () => {
  test("extractBodyLines(lines, ['page title', 'video transcript', 'first line', 'second line', 'up next:', 'unrelated text'], 1, ['up next:']) => ['first line', 'second line']", () => {
    const lines = [
      "Page title",
      "Video transcript",
      "First line",
      "Second line",
      "Up next:",
      "Unrelated text",
    ];
    const lowerLines = lines.map((line) => line.toLowerCase());
    const startIndex = 1;
    const endMarkers = ["up next:"];

    expect(extractBodyLines(lines, lowerLines, startIndex, endMarkers)).toEqual(
      ["First line", "Second line"],
    );
  });
});

describe("extractPrereqsAndObjectives(educContent)", () => {
  test("(no API calls in this test) extractPrereqsAndObjectives(<sample educ content about negative fractions>) => {prerequisites: string[], objectives: string[]}", () => {
    const sampleEducContent =
      "- We already know a good bit about negative numbers. And we know a good bit of fractions. So you can imagine we're going to start seeing negatives and fractions together a lot. What I want to do in this video is just make sure we have a decent understanding how to manipulate negative signs when we see them in fractions. For example, if I have the fraction negative 1/2. Here I have the negative out in front of the entire 1/2. This is the same thing as negative one over two. And it's going to be the same thing as one over negative two. Now I could also think about something like negative one over negative two. Now it's important to realize one way to think about this as a fraction is you could view this as negative one divided by negative two. And we already know, if you divide a negative by a negative it would be a positive. So this right over here is going to be the same thing as 1/2. This is going to be the same thing as positive 1/2. Now with that out of the way, let's think a little bit. Let's do some example problems that might push our thinking on this a little bit more. So this first question. Which of the following expressions are equivalent to negative g over h? Negative G over H. Select all that apply. All right, so this has all sorts of negatives here. So at first it looks a little bit unusual. But then we need to just realize that this part. Actually, let me just square this off in blue right over here. Negative g over negative h. We've already figured that out. We actually looked at that right over here. If you have a negative divided by a negative, that's the same thing as a positive value divided by the positive value. So negative g over negative h, is the same thing as g over h. And then you still have this negative out front. You still have that negative out front. So this one right over here is actually equal to negative g over h. When we think about it, negative divided by a negative is a positive and you still have this negative out here. So that's the same thing. And this right over here, negative in front. And then you have g over negative h. This is going to be the same thing. You could rewrite this, you could put the negative on top as negative g over negative h. And then this would be equal to g over h, which is different. This is positive g over h. This is negative g over h. So we wouldn't select that. And of course we wouldn't select \"None of the above.\" Cause we found a choice that we liked. All right. Which of the following expressions are equivalent to five over b. Select all that apply. All right, so this one over here. Negative five over negative b. Well we could remember that this negative, we could write this is the same thing as negative five over negative b. And I just want to make it clear we're that negative. So this is negative Instead of writing it negative in front of the entire fraction, I could essentially multiply the negative one times just the numerator. So you could write this as negative five over negative b. And negative divided by a negative is going to be a positive. So this actually is going to be equal to positive five over b, which is what we're looking for. So this is going to be right. Now this one, negative divided by a negative, well that's just going to be positive. So that's the same thing as five over b. One way to think about it is that well the negatives kind of cancel each other out. So five over b, that looks good too. And of course I won't select none of the above because I found two choices that worked. All right, let's do one more. Which of the following expressions are equal to negative e over negative f? And remember we just have to take this step by step here. Actually let's try to just simplify this directly. So negative e over negative f. Well we just need to remind ourselves that this part right over here. Negative e over negative f. Let me write an equal sign. Negative e over, and I'm gonna put this negative. Let me do this in a different color. Let me do this in purple. So we have this purple. So we have that purple negative right over there. And negative e over negative f. We've already talked about this multiple times. That's the same thing as negative's divided by a negative is a positive. That's the same thing as e over f, as positive e over f. So this whole thing will simplify to negative e over f. So let's see which of these choices are that. Well this right here is positive e over f. So that's not the choice. This one over here. This one we could write it several ways actually. We could write it negative negative e over f. Which of course is equal to positive e over f. We could also write this. We could put the negative in the denominator. We could say that this thing. Actually let me write it over here as negative e over negative f. This is also a legitimate thing to do. You could take this negative and multiply it times the denominator. Right over here. But either way it's going to be equal to positive e over f. These two are actually evaluate to the same expression. So here, I would select. Finally, I would select. I've been waiting to select \"None of the above.\" All right, hopefully that helps.";
    extractPrereqsAndObjectivesFromContent.mockReturnValueOnce({
      prerequisites: [
        "Interpret negative numbers",
        "Interpret a fraction as a numerator divided by the denominator",
        "Divide a negative number by another negative number",
        "Multiply a negative number by another negative number",
      ],
      objectives: [
        "Manipulate negative signs in fractions",
        "Recognize equivalence of fractions with negatives in numerator or denominator",
        "Simplify expressions involving negative fractions",
        "Identify equivalent expressions involving negative fractions",
      ],
    });

    expect(extractPrereqsAndObjectivesFromContent(sampleEducContent)).toEqual({
      prerequisites: [
        "Interpret negative numbers",
        "Interpret a fraction as a numerator divided by the denominator",
        "Divide a negative number by another negative number",
        "Multiply a negative number by another negative number",
      ],
      objectives: [
        "Manipulate negative signs in fractions",
        "Recognize equivalence of fractions with negatives in numerator or denominator",
        "Simplify expressions involving negative fractions",
        "Identify equivalent expressions involving negative fractions",
      ],
    });

    expect(extractPrereqsAndObjectivesFromContent).toHaveBeenCalledWith(
      sampleEducContent,
    );
  });
});

describe("canonicalizePrereqsAndObjectives([...prereqs, ...objectives])", () => {
  test("canonicalizePrereqsAndObjectives({nonempty-prereqs[<length 4>], nonempty-objectives[<length 4>]}) => {canonicalized-prereqs[<length 4>], canonicalized-objectives[<length 4>]}", () => {
    const input = {
      prerequisites: [
        "Interpret negative numbers",
        "Interpret a fraction as a numerator divided by the denominator",
        "Divide a negative number by another negative number",
        "Multiply a negative number by another negative number",
      ],
      objectives: [
        "Manipulate negative signs in fractions",
        "Recognize equivalence of fractions with negatives in numerator or denominator",
        "Simplify expressions involving negative fractions",
        "Identify equivalent expressions involving negative fractions",
      ],
    };

    const canonicalized = canonicalizePrereqsAndObjectives(
      input.prerequisites,
      input.objectives,
    );

    expect(canonicalized).toEqual({
      prerequisites: [
        "Identify positive and negative numbers on a number line",
        "Interpret fractions as parts of a whole",
        "Divide a negative number by another negative number",
        "Multiply a negative number by another negative number",
      ],
      objectives: [
        "Manipulate negative signs in fractions",
        "Recognize equivalence of fractions with negatives in numerator or denominator",
        "Simplify expressions involving negative fractions",
        "Identify equivalent expressions involving negative fractions",
      ],
    });
  });
});
