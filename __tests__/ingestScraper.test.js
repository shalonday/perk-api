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

  test("uses networkidle for Khan Academy pages", async () => {
    const page = {
      goto: jest.fn().mockResolvedValue({ status: () => 200 }),
      title: jest.fn().mockResolvedValue("Khan Academy"),
      evaluate: jest.fn().mockResolvedValue("Rendered Khan content"),
    };

    chromium.launch.mockResolvedValue({
      newPage: jest.fn().mockResolvedValue(page),
      close: jest.fn().mockResolvedValue(undefined),
    });

    await scrapeContent("https://www.khanacademy.org/math");

    expect(page.goto).toHaveBeenCalledTimes(1);
    expect(page.goto).toHaveBeenCalledWith("https://www.khanacademy.org/math", {
      waitUntil: "networkidle",
      timeout: 45000,
    });
  });

  test("falls back to domcontentloaded when Khan navigation times out", async () => {
    const page = {
      goto: jest
        .fn()
        .mockRejectedValueOnce(
          Object.assign(new Error("timed out"), {
            name: "TimeoutError",
          }),
        )
        .mockResolvedValueOnce({ status: () => 200 }),
      title: jest.fn().mockResolvedValue("Khan Academy"),
      evaluate: jest.fn().mockResolvedValue("Rendered Khan content"),
    };

    chromium.launch.mockResolvedValue({
      newPage: jest.fn().mockResolvedValue(page),
      close: jest.fn().mockResolvedValue(undefined),
    });

    await scrapeContent("https://www.khanacademy.org/math");

    expect(page.goto).toHaveBeenNthCalledWith(
      1,
      "https://www.khanacademy.org/math",
      { waitUntil: "networkidle", timeout: 45000 },
    );
    expect(page.goto).toHaveBeenNthCalledWith(
      2,
      "https://www.khanacademy.org/math",
      { waitUntil: "domcontentloaded", timeout: 45000 },
    );
  });

  test("uses one domcontentloaded navigation for non-Khan pages", async () => {
    const page = {
      goto: jest.fn().mockResolvedValue({ status: () => 200 }),
      title: jest.fn().mockResolvedValue("Example"),
      evaluate: jest.fn().mockResolvedValue("Example content"),
    };

    chromium.launch.mockResolvedValue({
      newPage: jest.fn().mockResolvedValue(page),
      close: jest.fn().mockResolvedValue(undefined),
    });

    await scrapeContent("https://example.com/lesson");

    expect(page.goto).toHaveBeenCalledTimes(1);
    expect(page.goto).toHaveBeenCalledWith("https://example.com/lesson", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
  });
});
