const {
  dismissCookieBanner,
  extractKhanAcademyPage,
  extractTranscriptOrBody,
  isKhanAcademyUrl,
  isSupportedKhanContentUrl,
  selectTranscriptTab,
} = require("../services/ingest/extractors/khanAcademyExtractor");

describe("extractTranscriptOrBody", () => {
  test("extracts visible transcript text until an end marker", () => {
    const result = extractTranscriptOrBody(
      "Page title\nTranscript\nFirst line\nSecond   line\nUp next:\nUnrelated text",
      "https://www.khanacademy.org/v/lesson",
    );

    expect(result).toEqual({
      body: "First line\nSecond line",
      transcriptUsed: true,
    });
  });

  test("falls back to the main body for a video-like page", () => {
    const result = extractTranscriptOrBody(
      "Lesson heading\nMain concept\nWant to join the conversation?\nDiscussion tail",
      "https://www.khanacademy.org/v/lesson",
    );

    expect(result).toEqual({
      body: "Lesson heading\nMain concept",
      transcriptUsed: false,
    });
  });

  test("uses the article-only cutoff for article URLs", () => {
    const result = extractTranscriptOrBody(
      "Article heading\nInstructional paragraph\nQuestions\nSkip to end of discussions\nForum tail",
      "https://www.khanacademy.org/a/article",
    );

    expect(result).toEqual({
      body: "Article heading\nInstructional paragraph\nQuestions",
      transcriptUsed: false,
    });
  });

  test("filters boilerplate and deduplicates consecutive lines", () => {
    const result = extractTranscriptOrBody(
      "Transcript\nSign up\nUseful line\nUseful line\nLog in\nAccept All Cookies\nAnother line\nUp next:",
      "https://www.khanacademy.org/v/lesson",
    );

    expect(result).toEqual({
      body: "Useful line\nAnother line",
      transcriptUsed: true,
    });
  });

  test("returns an empty result for empty input", () => {
    expect(
      extractTranscriptOrBody("  \n\t", "https://www.khanacademy.org/v/lesson"),
    ).toEqual({ body: "", transcriptUsed: false });
  });
});

describe("extractKhanAcademyPage", () => {
  test("dismisses UI, reads visible title and main text, and extracts it", async () => {
    const h1 = {
      first: () => ({
        innerText: jest.fn().mockResolvedValue("  Lesson   title  "),
      }),
    };
    const main = {
      innerText: jest
        .fn()
        .mockResolvedValue("Transcript\nVisible lesson text\nUp next:"),
    };
    const page = {
      getByRole: jest.fn().mockReturnValue({
        click: jest.fn().mockResolvedValue(undefined),
      }),
      locator: jest.fn((selector) =>
        selector === "h1" ? h1 : selector === "main" ? main : undefined,
      ),
      title: jest.fn(),
    };

    const result = await extractKhanAcademyPage(
      page,
      "https://www.khanacademy.org/v/lesson",
    );

    expect(result).toEqual({
      content: "Visible lesson text",
      title: "Lesson title",
      transcriptUsed: true,
    });
    expect(page.locator).toHaveBeenCalledWith("main");
  });
});

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

describe("isSupportedKhanContentUrl", () => {
  test("accepts video and article paths", () => {
    expect(
      isSupportedKhanContentUrl("https://www.khanacademy.org/v/some-video"),
    ).toBe(true);
    expect(
      isSupportedKhanContentUrl("https://www.khanacademy.org/a/some-article"),
    ).toBe(true);
  });

  test("rejects other page types and invalid input", () => {
    expect(
      isSupportedKhanContentUrl("https://www.khanacademy.org/profile/me"),
    ).toBe(false);
    expect(
      isSupportedKhanContentUrl("https://www.khanacademy.org/e/math"),
    ).toBe(false);
    expect(isSupportedKhanContentUrl(null)).toBe(false);
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

describe("selectTranscriptTab", () => {
  test("clicks the Transcript tab when present", async () => {
    const click = jest.fn().mockResolvedValue(undefined);
    const page = {
      getByRole: jest.fn().mockReturnValue({ click }),
    };

    await selectTranscriptTab(page);

    expect(page.getByRole).toHaveBeenCalledWith("tab", {
      name: /transcript/i,
    });
    expect(click).toHaveBeenCalledWith({ timeout: 3000 });
  });

  test("swallows failures when no Transcript tab is present", async () => {
    const page = {
      getByRole: jest.fn().mockReturnValue({
        click: jest.fn().mockRejectedValue(new Error("Tab unavailable")),
      }),
    };

    await expect(selectTranscriptTab(page)).resolves.toBeUndefined();
  });

  test("does nothing when the page has no role locator", async () => {
    await expect(selectTranscriptTab({})).resolves.toBeUndefined();
  });
});
