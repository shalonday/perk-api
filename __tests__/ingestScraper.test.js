jest.mock("playwright", () => ({
  chromium: {
    launch: jest.fn(),
  },
}));

const { chromium } = require("playwright");
const { scrapeContent } = require("../services/ingest/scraper");

describe("scrapeContent", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("loads the page and returns readable text and title", async () => {
    const page = {
      goto: jest.fn().mockResolvedValue({ status: () => 200 }),
      title: jest.fn().mockResolvedValue("JavaScript Guide"),
      on: jest.fn(),
      evaluate: jest
        .fn()
        .mockResolvedValue("JavaScript is a programming language for the web."),
    };

    chromium.launch.mockResolvedValue({
      newPage: jest.fn().mockResolvedValue(page),
      close: jest.fn().mockResolvedValue(undefined),
    });

    const result = await scrapeContent(
      "https://developer.mozilla.org/en-US/docs/Web/JavaScript",
    );

    expect(chromium.launch).toHaveBeenCalledTimes(1);
    expect(page.goto).toHaveBeenCalledWith(
      "https://developer.mozilla.org/en-US/docs/Web/JavaScript",
      expect.objectContaining({ waitUntil: "domcontentloaded" }),
    );
    expect(result).toEqual({
      content: "JavaScript is a programming language for the web.",
      title: "JavaScript Guide",
    });
  });

  test("throws a readable error when the page is not parseable", async () => {
    const page = {
      goto: jest.fn().mockResolvedValue({ status: () => 403 }),
      title: jest.fn().mockResolvedValue("Access denied"),
      on: jest.fn(),
      evaluate: jest.fn().mockResolvedValue("   "),
    };

    chromium.launch.mockResolvedValue({
      newPage: jest.fn().mockResolvedValue(page),
      close: jest.fn().mockResolvedValue(undefined),
    });

    await expect(
      scrapeContent("https://example.com/blocked-page"),
    ).rejects.toThrow("Unable to load the page");
  });
});
