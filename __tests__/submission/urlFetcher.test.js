/**
 * Tests for URL Fetcher Utility (Puppeteer Wrapper)
 * Tests browser management, content extraction, error handling, and retry logic.
 */

const {
  fetchUrlContent,
  fetchMultipleUrls,
  closeBrowser,
  getBrowser,
  MAX_TEXT_LENGTH,
  DEFAULT_TIMEOUT_MS,
  NULL_STATUS_CODES,
} = require("../../services/submission/urlFetcher");

// --------------------------------------------------------------------------
// Mock Puppeteer
// --------------------------------------------------------------------------

/** Creates a mock Puppeteer page with sensible defaults. */
function createMockPage(overrides = {}) {
  const eventHandlers = {};
  const mockPage = {
    setRequestInterception: jest.fn().mockResolvedValue(undefined),
    on: jest.fn((event, handler) => {
      eventHandlers[event] = handler;
    }),
    goto: jest.fn().mockResolvedValue({
      status: () => 200,
    }),
    evaluate: jest.fn().mockResolvedValue({
      title: "Test Page Title",
      description: "A test page description",
      headings: ["Main Heading", "Sub Heading"],
      text: "This is the body text of the test page.",
    }),
    close: jest.fn().mockResolvedValue(undefined),
    _eventHandlers: eventHandlers,
    _triggerEvent: (event, ...args) => {
      if (eventHandlers[event]) {
        eventHandlers[event](...args);
      }
    },
  };
  return { ...mockPage, ...overrides };
}

/** Creates a mock Puppeteer browser. */
function createMockBrowser(mockPage) {
  return {
    newPage: jest.fn().mockResolvedValue(mockPage),
    close: jest.fn().mockResolvedValue(undefined),
    connected: true,
  };
}

// Mock puppeteer module
jest.mock("puppeteer", () => ({
  launch: jest.fn(),
}));

const puppeteer = require("puppeteer");

describe("URL Fetcher", () => {
  let mockPage;
  let mockBrowser;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Close any existing browser instance between tests
    await closeBrowser();

    mockPage = createMockPage();
    mockBrowser = createMockBrowser(mockPage);
    puppeteer.launch.mockResolvedValue(mockBrowser);
  });

  afterAll(async () => {
    await closeBrowser();
  });

  // --------------------------------------------------------------------------
  // Constants
  // --------------------------------------------------------------------------

  describe("Constants", () => {
    it("should define MAX_TEXT_LENGTH as 5000", () => {
      expect(MAX_TEXT_LENGTH).toBe(5000);
    });

    it("should define DEFAULT_TIMEOUT_MS as 15000", () => {
      expect(DEFAULT_TIMEOUT_MS).toBe(15000);
    });

    it("should define NULL_STATUS_CODES with 403, 404, 410, 451", () => {
      expect(NULL_STATUS_CODES.has(403)).toBe(true);
      expect(NULL_STATUS_CODES.has(404)).toBe(true);
      expect(NULL_STATUS_CODES.has(410)).toBe(true);
      expect(NULL_STATUS_CODES.has(451)).toBe(true);
      expect(NULL_STATUS_CODES.has(200)).toBe(false);
      expect(NULL_STATUS_CODES.has(500)).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Browser Management
  // --------------------------------------------------------------------------

  describe("Browser management", () => {
    it("should lazily initialize browser on first call", async () => {
      await getBrowser();
      expect(puppeteer.launch).toHaveBeenCalledTimes(1);
      expect(puppeteer.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          headless: true,
          args: expect.arrayContaining(["--no-sandbox"]),
        }),
      );
    });

    it("should reuse browser on subsequent calls", async () => {
      await getBrowser();
      await getBrowser();
      expect(puppeteer.launch).toHaveBeenCalledTimes(1);
    });

    it("should relaunch browser if disconnected", async () => {
      const browser1 = await getBrowser();
      // Simulate disconnection
      browser1.connected = false;

      const newMockBrowser = createMockBrowser(mockPage);
      puppeteer.launch.mockResolvedValue(newMockBrowser);

      await getBrowser();
      expect(puppeteer.launch).toHaveBeenCalledTimes(2);
    });

    it("should close browser gracefully", async () => {
      await getBrowser();
      await closeBrowser();
      expect(mockBrowser.close).toHaveBeenCalledTimes(1);
    });

    it("should handle close when no browser exists", async () => {
      // Should not throw
      await closeBrowser();
    });

    it("should handle close when browser is already disconnected", async () => {
      await getBrowser();
      mockBrowser.close.mockRejectedValueOnce(new Error("Already closed"));
      // Should not throw
      await closeBrowser();
    });
  });

  // --------------------------------------------------------------------------
  // Content Extraction — Successful fetches
  // --------------------------------------------------------------------------

  describe("fetchUrlContent — successful fetches", () => {
    it("should extract title, description, headings, and text", async () => {
      const result = await fetchUrlContent("https://example.com/page");

      expect(result).toEqual({
        title: "Test Page Title",
        description: "A test page description",
        headings: ["Main Heading", "Sub Heading"],
        text: "This is the body text of the test page.",
      });
    });

    it("should open a new page and navigate to the URL", async () => {
      await fetchUrlContent("https://example.com/page");

      expect(mockBrowser.newPage).toHaveBeenCalledTimes(1);
      expect(mockPage.goto).toHaveBeenCalledWith("https://example.com/page", {
        waitUntil: "domcontentloaded",
        timeout: DEFAULT_TIMEOUT_MS,
      });
    });

    it("should set up request interception to block heavy resources", async () => {
      await fetchUrlContent("https://example.com/page");

      expect(mockPage.setRequestInterception).toHaveBeenCalledWith(true);
      expect(mockPage.on).toHaveBeenCalledWith("request", expect.any(Function));
    });

    it("should block image, media, font, and stylesheet requests", async () => {
      await fetchUrlContent("https://example.com/page");

      // Get the request handler
      const requestHandler = mockPage.on.mock.calls.find(
        (call) => call[0] === "request",
      )[1];

      // Test blocked types
      for (const type of ["image", "media", "font", "stylesheet"]) {
        const mockRequest = {
          resourceType: () => type,
          abort: jest.fn(),
          continue: jest.fn(),
        };
        requestHandler(mockRequest);
        expect(mockRequest.abort).toHaveBeenCalled();
        expect(mockRequest.continue).not.toHaveBeenCalled();
      }
    });

    it("should allow document, script, and xhr requests", async () => {
      await fetchUrlContent("https://example.com/page");

      const requestHandler = mockPage.on.mock.calls.find(
        (call) => call[0] === "request",
      )[1];

      for (const type of ["document", "script", "xhr", "fetch"]) {
        const mockRequest = {
          resourceType: () => type,
          abort: jest.fn(),
          continue: jest.fn(),
        };
        requestHandler(mockRequest);
        expect(mockRequest.continue).toHaveBeenCalled();
        expect(mockRequest.abort).not.toHaveBeenCalled();
      }
    });

    it("should close the page after fetching", async () => {
      await fetchUrlContent("https://example.com/page");
      expect(mockPage.close).toHaveBeenCalledTimes(1);
    });

    it("should handle empty content fields gracefully", async () => {
      mockPage.evaluate.mockResolvedValueOnce({
        title: "",
        description: "",
        headings: [],
        text: "",
      });

      const result = await fetchUrlContent("https://example.com/empty");

      expect(result).toEqual({
        title: "",
        description: "",
        headings: [],
        text: "",
      });
    });

    it("should handle null content fields from evaluate", async () => {
      mockPage.evaluate.mockResolvedValueOnce({
        title: null,
        description: null,
        headings: null,
        text: null,
      });

      const result = await fetchUrlContent("https://example.com/null-fields");

      expect(result).toEqual({
        title: "",
        description: "",
        headings: [],
        text: "",
      });
    });
  });

  // --------------------------------------------------------------------------
  // Input Validation
  // --------------------------------------------------------------------------

  describe("fetchUrlContent — input validation", () => {
    it("should return null for null URL", async () => {
      const result = await fetchUrlContent(null);
      expect(result).toBeNull();
    });

    it("should return null for undefined URL", async () => {
      const result = await fetchUrlContent(undefined);
      expect(result).toBeNull();
    });

    it("should return null for empty string URL", async () => {
      const result = await fetchUrlContent("");
      expect(result).toBeNull();
    });

    it("should return null for non-string URL", async () => {
      const result = await fetchUrlContent(123);
      expect(result).toBeNull();
    });

    it("should not launch browser for invalid URLs", async () => {
      await fetchUrlContent(null);
      expect(puppeteer.launch).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // HTTP Error Status Codes
  // --------------------------------------------------------------------------

  describe("fetchUrlContent — HTTP status codes", () => {
    it("should return null for 404 Not Found", async () => {
      mockPage.goto.mockResolvedValueOnce({ status: () => 404 });
      const result = await fetchUrlContent("https://example.com/missing");
      expect(result).toBeNull();
    });

    it("should return null for 403 Forbidden", async () => {
      mockPage.goto.mockResolvedValueOnce({ status: () => 403 });
      const result = await fetchUrlContent("https://example.com/forbidden");
      expect(result).toBeNull();
    });

    it("should return null for 410 Gone", async () => {
      mockPage.goto.mockResolvedValueOnce({ status: () => 410 });
      const result = await fetchUrlContent("https://example.com/gone");
      expect(result).toBeNull();
    });

    it("should return null for 451 Unavailable For Legal Reasons", async () => {
      mockPage.goto.mockResolvedValueOnce({ status: () => 451 });
      const result = await fetchUrlContent("https://example.com/legal");
      expect(result).toBeNull();
    });

    it("should extract content for 200 OK", async () => {
      mockPage.goto.mockResolvedValueOnce({ status: () => 200 });
      const result = await fetchUrlContent("https://example.com/ok");
      expect(result).not.toBeNull();
      expect(result.title).toBe("Test Page Title");
    });

    it("should extract content for 301 Redirect (final page)", async () => {
      mockPage.goto.mockResolvedValueOnce({ status: () => 301 });
      const result = await fetchUrlContent("https://example.com/redirect");
      expect(result).not.toBeNull();
    });

    it("should extract content for 500 Server Error", async () => {
      // 500 is not in NULL_STATUS_CODES — we still try to extract content
      mockPage.goto.mockResolvedValueOnce({ status: () => 500 });
      const result = await fetchUrlContent("https://example.com/error");
      expect(result).not.toBeNull();
    });

    it("should handle null response from goto", async () => {
      mockPage.goto.mockResolvedValueOnce(null);
      const result = await fetchUrlContent("https://example.com/null-response");
      // status() would be 0, not in NULL_STATUS_CODES, so content extraction proceeds
      expect(result).not.toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Timeout Handling
  // --------------------------------------------------------------------------

  describe("fetchUrlContent — timeout handling", () => {
    it("should return partial data on navigation timeout", async () => {
      const timeoutError = new Error("Navigation timeout");
      timeoutError.name = "TimeoutError";
      mockPage.goto.mockRejectedValueOnce(timeoutError);

      // page.evaluate returns partial metadata
      mockPage.evaluate.mockResolvedValueOnce({
        title: "Partial Title",
        description: "Partial description",
        headings: ["Heading 1"],
        text: "Some text that loaded before timeout",
      });

      const result = await fetchUrlContent("https://slow-site.com");

      expect(result).toEqual({
        title: "Partial Title",
        description: "Partial description",
        headings: ["Heading 1"],
        text: "", // Body text stripped on timeout
      });
    });

    it("should return empty fields if partial extraction also fails", async () => {
      const timeoutError = new Error("Navigation timeout");
      timeoutError.name = "TimeoutError";
      mockPage.goto.mockRejectedValueOnce(timeoutError);
      mockPage.evaluate.mockRejectedValueOnce(
        new Error("Execution context destroyed"),
      );

      const result = await fetchUrlContent("https://very-slow-site.com");

      expect(result).toEqual({
        title: "",
        description: "",
        headings: [],
        text: "",
      });
    });

    it("should respect PUPPETEER_TIMEOUT environment variable", async () => {
      process.env.PUPPETEER_TIMEOUT = "30000";

      await fetchUrlContent("https://example.com/page");

      expect(mockPage.goto).toHaveBeenCalledWith(
        "https://example.com/page",
        expect.objectContaining({ timeout: 30000 }),
      );

      delete process.env.PUPPETEER_TIMEOUT;
    });
  });

  // --------------------------------------------------------------------------
  // JavaScript Error Retry Logic
  // --------------------------------------------------------------------------

  describe("fetchUrlContent — JS error retry", () => {
    it("should retry once on JavaScript page errors", async () => {
      // First attempt: page has JS errors
      const firstPage = createMockPage();
      const secondPage = createMockPage();

      let callCount = 0;
      mockBrowser.newPage.mockImplementation(() => {
        callCount++;
        return Promise.resolve(callCount === 1 ? firstPage : secondPage);
      });

      // Make the first page trigger a JS error
      firstPage.goto.mockImplementation(async () => {
        // Trigger pageerror event after goto
        firstPage._triggerEvent("pageerror", new Error("Uncaught TypeError"));
        return { status: () => 200 };
      });

      secondPage.goto.mockResolvedValue({ status: () => 200 });
      secondPage.evaluate.mockResolvedValue({
        title: "Retried Page",
        description: "After retry",
        headings: [],
        text: "Content after retry",
      });

      const result = await fetchUrlContent("https://js-error-site.com");

      expect(callCount).toBe(2); // Two pages created (retry)
      expect(result.title).toBe("Retried Page");
    });

    it("should not retry more than once", async () => {
      const firstPage = createMockPage();
      const secondPage = createMockPage();

      let callCount = 0;
      mockBrowser.newPage.mockImplementation(() => {
        callCount++;
        return Promise.resolve(callCount === 1 ? firstPage : secondPage);
      });

      // Both pages have JS errors
      firstPage.goto.mockImplementation(async () => {
        firstPage._triggerEvent(
          "pageerror",
          new Error("Uncaught TypeError #1"),
        );
        return { status: () => 200 };
      });

      secondPage.goto.mockImplementation(async () => {
        secondPage._triggerEvent(
          "pageerror",
          new Error("Uncaught TypeError #2"),
        );
        return { status: () => 200 };
      });

      secondPage.evaluate.mockResolvedValue({
        title: "Page with JS Errors",
        description: "",
        headings: [],
        text: "Content despite errors",
      });

      const result = await fetchUrlContent("https://persistent-errors.com");

      // Should only retry once (2 total), not infinitely
      expect(callCount).toBe(2);
      expect(result).not.toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // General Error Handling
  // --------------------------------------------------------------------------

  describe("fetchUrlContent — error handling", () => {
    it("should return null on browser launch failure", async () => {
      puppeteer.launch.mockRejectedValueOnce(
        new Error("Failed to launch browser"),
      );

      const result = await fetchUrlContent("https://example.com/page");
      expect(result).toBeNull();
    });

    it("should return null on page creation failure", async () => {
      mockBrowser.newPage.mockRejectedValueOnce(
        new Error("Failed to create page"),
      );

      const result = await fetchUrlContent("https://example.com/page");
      expect(result).toBeNull();
    });

    it("should return null on non-timeout navigation error", async () => {
      const netError = new Error("net::ERR_NAME_NOT_RESOLVED");
      netError.name = "Error";
      mockPage.goto.mockRejectedValueOnce(netError);

      const result = await fetchUrlContent("https://nonexistent-domain.xyz");
      expect(result).toBeNull();
    });

    it("should return null on content extraction failure", async () => {
      mockPage.evaluate.mockRejectedValueOnce(new Error("Evaluation failed"));

      const result = await fetchUrlContent("https://example.com/broken");
      expect(result).toBeNull();
    });

    it("should close page even when errors occur", async () => {
      mockPage.evaluate.mockRejectedValueOnce(new Error("Evaluation failed"));

      await fetchUrlContent("https://example.com/broken");
      expect(mockPage.close).toHaveBeenCalled();
    });

    it("should handle page close failure gracefully", async () => {
      mockPage.close.mockRejectedValueOnce(new Error("Page already closed"));

      // Should not throw
      const result = await fetchUrlContent("https://example.com/page");
      expect(result).not.toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // fetchMultipleUrls
  // --------------------------------------------------------------------------

  describe("fetchMultipleUrls", () => {
    it("should fetch content from multiple URLs", async () => {
      const results = await fetchMultipleUrls([
        "https://example.com/page1",
        "https://example.com/page2",
      ]);

      expect(results).toHaveLength(2);
      expect(results[0].url).toBe("https://example.com/page1");
      expect(results[0].content).not.toBeNull();
      expect(results[1].url).toBe("https://example.com/page2");
      expect(results[1].content).not.toBeNull();
    });

    it("should handle mixed success and failure", async () => {
      // First page succeeds, second returns 404
      let callCount = 0;
      mockPage.goto.mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          return Promise.resolve({ status: () => 404 });
        }
        return Promise.resolve({ status: () => 200 });
      });

      const results = await fetchMultipleUrls([
        "https://example.com/exists",
        "https://example.com/missing",
      ]);

      expect(results[0].content).not.toBeNull();
      expect(results[1].content).toBeNull();
    });

    it("should return empty array for empty input", async () => {
      const results = await fetchMultipleUrls([]);
      expect(results).toEqual([]);
    });

    it("should return empty array for non-array input", async () => {
      const results = await fetchMultipleUrls("not-an-array");
      expect(results).toEqual([]);
    });

    it("should return empty array for null input", async () => {
      const results = await fetchMultipleUrls(null);
      expect(results).toEqual([]);
    });

    it("should include URL in each result", async () => {
      const results = await fetchMultipleUrls(["https://example.com/page"]);

      expect(results[0]).toHaveProperty("url", "https://example.com/page");
      expect(results[0]).toHaveProperty("content");
    });
  });
});
