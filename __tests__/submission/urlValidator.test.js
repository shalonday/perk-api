/**
 * Tests for URL Validator Utility
 * Tests domain whitelist, URL format validation, and hybrid safety checks
 */

const {
  validateUrlSafety,
  validateMultipleUrls,
  validateUrlFormat,
  isDomainTrusted,
  clearCache,
  getCacheSize,
  DEFAULT_TRUSTED_DOMAINS,
} = require("../../services/submission/urlValidator");

// Mock fetch for external API calls
global.fetch = jest.fn();

describe("URL Validator", () => {
  beforeEach(() => {
    // Clear cache and reset mocks before each test
    clearCache();
    jest.clearAllMocks();
    // Reset environment variables
    delete process.env.TRUSTED_DOMAINS;
    delete process.env.URLHAUS_API_URL;
  });

  afterAll(() => {
    // Clean up environment variables after all tests complete
    delete process.env.TRUSTED_DOMAINS;
    delete process.env.URLHAUS_API_URL;
  });

  describe("validateUrlFormat", () => {
    it("should accept valid HTTPS URLs", () => {
      const result = validateUrlFormat("https://example.com/path");
      expect(result.valid).toBe(true);
      expect(result.domain).toBe("example.com");
    });

    it("should accept valid HTTP URLs", () => {
      const result = validateUrlFormat("http://example.com");
      expect(result.valid).toBe(true);
      expect(result.domain).toBe("example.com");
    });

    it("should extract domain from URL with port", () => {
      const result = validateUrlFormat("https://example.com:8080/path");
      expect(result.valid).toBe(true);
      expect(result.domain).toBe("example.com");
    });

    it("should handle URLs with subdomains", () => {
      const result = validateUrlFormat("https://docs.example.com/api");
      expect(result.valid).toBe(true);
      expect(result.domain).toBe("docs.example.com");
    });

    it("should reject null URL", () => {
      const result = validateUrlFormat(null);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("URL is required");
    });

    it("should reject empty string", () => {
      const result = validateUrlFormat("");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("URL cannot be empty");
    });

    it("should reject whitespace-only string", () => {
      const result = validateUrlFormat("   ");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("URL cannot be empty");
    });

    it("should reject URLs without protocol", () => {
      const result = validateUrlFormat("example.com/path");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("URL must start with http:// or https://");
    });

    it("should reject FTP URLs", () => {
      const result = validateUrlFormat("ftp://files.example.com");
      expect(result.valid).toBe(false);
    });

    it("should reject localhost", () => {
      const result = validateUrlFormat("http://localhost:3000");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Local and private URLs are not allowed");
    });

    it("should reject 127.0.0.1", () => {
      const result = validateUrlFormat("http://127.0.0.1/api");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Local and private URLs are not allowed");
    });

    it("should reject private IP ranges (192.168.x.x)", () => {
      const result = validateUrlFormat("http://192.168.1.1/admin");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Local and private URLs are not allowed");
    });

    it("should reject private IP ranges (10.x.x.x)", () => {
      const result = validateUrlFormat("http://10.0.0.1/internal");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Local and private URLs are not allowed");
    });

    it("should reject malformed URLs", () => {
      const result = validateUrlFormat("https://");
      expect(result.valid).toBe(false);
    });
  });

  describe("isDomainTrusted", () => {
    it("should trust exact domain matches", () => {
      expect(isDomainTrusted("github.com")).toBe(true);
      expect(isDomainTrusted("stackoverflow.com")).toBe(true);
      expect(isDomainTrusted("youtube.com")).toBe(true);
    });

    it("should trust subdomains of whitelisted domains", () => {
      expect(isDomainTrusted("www.github.com")).toBe(true);
      expect(isDomainTrusted("docs.github.com")).toBe(true);
      expect(isDomainTrusted("gist.github.com")).toBe(true);
    });

    it("should be case-insensitive", () => {
      expect(isDomainTrusted("GitHub.com")).toBe(true);
      expect(isDomainTrusted("WWW.GITHUB.COM")).toBe(true);
    });

    it("should reject unknown domains", () => {
      expect(isDomainTrusted("malware-site.com")).toBe(false);
      expect(isDomainTrusted("unknown-domain.xyz")).toBe(false);
    });

    it("should not match partial domain names", () => {
      // "notgithub.com" should not match "github.com"
      expect(isDomainTrusted("notgithub.com")).toBe(false);
      expect(isDomainTrusted("github.com.evil.com")).toBe(false);
    });

    it("should include common educational platforms", () => {
      expect(DEFAULT_TRUSTED_DOMAINS).toContain("coursera.org");
      expect(DEFAULT_TRUSTED_DOMAINS).toContain("udemy.com");
      expect(DEFAULT_TRUSTED_DOMAINS).toContain("freecodecamp.org");
      expect(DEFAULT_TRUSTED_DOMAINS).toContain("developer.mozilla.org");
    });

    it("should respect environment variable overrides", () => {
      process.env.TRUSTED_DOMAINS = "custom-edu.org, my-learning.com";
      expect(isDomainTrusted("custom-edu.org")).toBe(true);
      expect(isDomainTrusted("my-learning.com")).toBe(true);
    });
  });

  describe("validateUrlSafety", () => {
    it("should pass URLs from whitelisted domains immediately", async () => {
      const result = await validateUrlSafety("https://github.com/repo");
      expect(result.safe).toBe(true);
      expect(fetch).not.toHaveBeenCalled(); // Fast-path, no API call
    });

    it("should pass URLs from whitelisted subdomains", async () => {
      const result = await validateUrlSafety(
        "https://docs.github.com/en/actions",
      );
      expect(result.safe).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("should fail invalid URL format", async () => {
      const result = await validateUrlSafety("not-a-url");
      expect(result.safe).toBe(false);
      expect(result.reason).toBe("URL must start with http:// or https://");
    });

    it("should fail localhost URLs", async () => {
      const result = await validateUrlSafety("http://localhost:3000");
      expect(result.safe).toBe(false);
    });

    describe("External API checks", () => {
      it("should call external API for unknown domains", async () => {
        fetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({ query_status: "no_results", threat: null }),
        });

        const result = await validateUrlSafety(
          "https://unknown-but-safe.com/page",
        );
        expect(result.safe).toBe(true);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch).toHaveBeenCalledWith(
          expect.stringContaining("urlhaus-api.abuse.ch"),
          expect.objectContaining({ method: "POST" }),
        );
      });

      it("should reject URLs flagged by external API", async () => {
        fetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              query_status: "ok",
              threat: "malware",
            }),
        });

        const result = await validateUrlSafety("https://malware-site.com");
        expect(result.safe).toBe(false);
        expect(result.reason).toBe("URL flagged by security service");
      });

      it("should cache results and skip API on second call", async () => {
        fetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ query_status: "no_results" }),
        });

        // First call - hits API
        await validateUrlSafety("https://new-domain.com/page1");
        expect(fetch).toHaveBeenCalledTimes(1);

        // Second call - should use cache
        const result = await validateUrlSafety("https://new-domain.com/page2");
        expect(result.safe).toBe(true);
        expect(fetch).toHaveBeenCalledTimes(1); // Still 1, used cache
      });

      it("should cache negative results and skip API on second call", async () => {
        fetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              query_status: "ok",
              threat: "phishing",
            }),
        });

        // First call - hits API
        await validateUrlSafety("https://phishing-site.com/page1");

        // Second call - should use cache
        const result = await validateUrlSafety(
          "https://phishing-site.com/page2",
        );
        expect(result.safe).toBe(false);
        expect(result.reason).toBe("Domain previously flagged as unsafe");
        expect(fetch).toHaveBeenCalledTimes(1);
      });

      it("should fail open on API errors", async () => {
        fetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
        });

        const result = await validateUrlSafety(
          "https://unknown-domain.com/page",
        );
        expect(result.safe).toBe(true); // Fail open
        expect(result.warnings).toContain(
          "Safety verification unavailable — admin will review this URL",
        );
      });

      it("should fail open on network errors", async () => {
        fetch.mockRejectedValueOnce(new Error("Network timeout"));

        const result = await validateUrlSafety(
          "https://another-unknown.com/page",
        );
        expect(result.safe).toBe(true); // Fail open
        expect(result.warnings).toContain(
          "Safety verification unavailable — admin will review this URL",
        );
      });

      it("should NOT include warnings when external API succeeds", async () => {
        fetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({ query_status: "no_results", threat: null }),
        });

        const result = await validateUrlSafety(
          "https://successful-check.com/page",
        );
        expect(result.safe).toBe(true);
        expect(result.warnings).toBeUndefined();
      });
    });

    describe("Default URLhaus endpoint", () => {
      it("should use the default URLhaus endpoint when none is configured", async () => {
        delete process.env.URLHAUS_API_URL;
        fetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ query_status: "no_results" }),
        });

        const result = await validateUrlSafety(
          "https://unknown-domain.org/page",
        );
        expect(result.safe).toBe(true);
        expect(fetch).toHaveBeenCalledWith(
          expect.stringContaining("urlhaus-api.abuse.ch"),
          expect.any(Object),
        );
      });
    });
  });

  describe("validateMultipleUrls", () => {
    it("should validate all URLs in array", async () => {
      const result = await validateMultipleUrls([
        "https://github.com/repo",
        "https://stackoverflow.com/questions",
        "https://youtube.com/watch?v=123",
      ]);

      expect(result.allSafe).toBe(true);
      expect(result.results).toHaveLength(3);
      expect(result.results.every((r) => r.safe)).toBe(true);
    });

    it("should return allSafe: false if any URL fails", async () => {
      const result = await validateMultipleUrls([
        "https://github.com/repo",
        "not-a-valid-url",
        "https://stackoverflow.com/questions",
      ]);

      expect(result.allSafe).toBe(false);
      expect(result.results[1].safe).toBe(false);
    });

    it("should handle empty array", async () => {
      const result = await validateMultipleUrls([]);
      expect(result.allSafe).toBe(false);
      expect(result.results[0].reason).toBe("URLs array is required");
    });

    it("should handle non-array input", async () => {
      const result = await validateMultipleUrls("not-an-array");
      expect(result.allSafe).toBe(false);
    });

    it("should validate URLs in parallel", async () => {
      // Mock two API calls
      fetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ query_status: "no_results" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ query_status: "no_results" }),
        });

      const result = await validateMultipleUrls([
        "https://github.com/repo", // Whitelisted
        "https://unknown1.com/page", // API call
        "https://stackoverflow.com/q", // Whitelisted
        "https://unknown2.com/page", // API call
      ]);

      expect(result.allSafe).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(2); // Only 2 API calls
    });
  });

  describe("Cache management", () => {
    it("should clear cache", async () => {
      fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ query_status: "no_results" }),
      });

      await validateUrlSafety("https://domain1.com/page");
      await validateUrlSafety("https://domain2.com/page");

      expect(getCacheSize()).toBe(2);

      clearCache();

      expect(getCacheSize()).toBe(0);
    });
  });

  describe("Cache expiration (24-hour TTL)", () => {
    it("should expire cache entries older than 24 hours", async () => {
      // Mock first API call (successful)
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ query_status: "no_results" }),
      });

      // First call - caches the result
      await validateUrlSafety("https://old-cache-domain.com/page1");
      expect(fetch).toHaveBeenCalledTimes(1);

      // Manually expire the cache entry by advancing time
      const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
      jest.useFakeTimers();
      jest.advanceTimersByTime(CACHE_TTL_MS + 1000); // 24h + 1s

      // Reset mocks and set up new API call
      fetch.mockClear();
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ query_status: "no_results" }),
      });

      // Second call - cache should be expired, so API should be called again
      await validateUrlSafety("https://old-cache-domain.com/page2");
      expect(fetch).toHaveBeenCalledTimes(1); // New API call made

      jest.useRealTimers();
    });

    it("should use fresh cache entries before expiration", async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ query_status: "no_results" }),
      });

      // First call
      await validateUrlSafety("https://fresh-cache-domain.com/page1");
      expect(fetch).toHaveBeenCalledTimes(1);

      // Second call immediately after (no time advance)
      fetch.mockClear();
      await validateUrlSafety("https://fresh-cache-domain.com/page2");
      expect(fetch).toHaveBeenCalledTimes(0); // Use cache, no API call
    });
  });

  describe("API error scenarios (Fail open strategy)", () => {
    it("should allow URL on malformed API response (JSON parse error)", async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.reject(new Error("Invalid JSON")),
      });

      const result = await validateUrlSafety(
        "https://malformed-response.com/page",
      );
      expect(result.safe).toBe(true); // Fail open
      expect(result.warnings).toContain(
        "Safety verification unavailable — admin will review this URL",
      );
    });

    it("should allow URL on API 403 Forbidden", async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      });

      const result = await validateUrlSafety("https://forbidden-api.com/page");
      expect(result.safe).toBe(true); // Fail open
      expect(result.warnings).toContain(
        "Safety verification unavailable — admin will review this URL",
      );
    });

    it("should allow URL on API 429 Rate Limit", async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
      });

      const result = await validateUrlSafety("https://rate-limited.com/page");
      expect(result.safe).toBe(true); // Fail open
      expect(result.warnings).toContain(
        "Safety verification unavailable — admin will review this URL",
      );
    });

    it("should allow URL on API 503 Service Unavailable", async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      });

      const result = await validateUrlSafety("https://unavailable-api.com");
      expect(result.safe).toBe(true); // Fail open
      expect(result.warnings).toContain(
        "Safety verification unavailable — admin will review this URL",
      );
    });

    it("should allow URL on network connection timeout", async () => {
      fetch.mockRejectedValueOnce(new Error("Network timeout"));

      const result = await validateUrlSafety("https://timeout-domain.com/page");
      expect(result.safe).toBe(true); // Fail open
      expect(result.warnings).toContain(
        "Safety verification unavailable — admin will review this URL",
      );
    });

    it("should allow URL on ECONNREFUSED error", async () => {
      const error = new Error("ECONNREFUSED");
      error.code = "ECONNREFUSED";
      fetch.mockRejectedValueOnce(error);

      const result = await validateUrlSafety("https://refused-domain.com");
      expect(result.safe).toBe(true); // Fail open
      expect(result.warnings).toContain(
        "Safety verification unavailable — admin will review this URL",
      );
    });

    it("should allow URL on ENOTFOUND error (DNS lookup failure)", async () => {
      const error = new Error("ENOTFOUND");
      error.code = "ENOTFOUND";
      fetch.mockRejectedValueOnce(error);

      const result = await validateUrlSafety("https://notfound-domain.com");
      expect(result.safe).toBe(true); // Fail open
      expect(result.warnings).toContain(
        "Safety verification unavailable — admin will review this URL",
      );
    });

    it("should allow URL on unknown fetch error", async () => {
      fetch.mockRejectedValueOnce(new Error("Unknown error"));

      const result = await validateUrlSafety("https://unknown-error.com");
      expect(result.safe).toBe(true); // Fail open
      expect(result.warnings).toContain(
        "Safety verification unavailable — admin will review this URL",
      );
    });
  });

  describe("Environment variable overrides", () => {
    it("should include custom domains from TRUSTED_DOMAINS env var", () => {
      process.env.TRUSTED_DOMAINS = "custom-course.org, my-edu.com";

      expect(isDomainTrusted("custom-course.org")).toBe(true);
      expect(isDomainTrusted("my-edu.com")).toBe(true);
      expect(isDomainTrusted("github.com")).toBe(true); // Still includes defaults
    });

    it("should trim whitespace in TRUSTED_DOMAINS", () => {
      process.env.TRUSTED_DOMAINS =
        "  spaced-domain.org  ,  another-domain.com  ";

      expect(isDomainTrusted("spaced-domain.org")).toBe(true);
      expect(isDomainTrusted("another-domain.com")).toBe(true);
    });

    it("should handle case-insensitive custom domains", () => {
      process.env.TRUSTED_DOMAINS = "CustomDomain.ORG";

      expect(isDomainTrusted("CustomDomain.ORG")).toBe(true);
      expect(isDomainTrusted("customdomain.org")).toBe(true);
      expect(isDomainTrusted("CUSTOMDOMAIN.ORG")).toBe(true);
    });

    it("should exclude domains not in TRUSTED_DOMAINS", () => {
      process.env.TRUSTED_DOMAINS = "only-this.org";

      // Should still have defaults (github.com included)
      expect(isDomainTrusted("github.com")).toBe(true);

      // Should have the custom domain
      expect(isDomainTrusted("only-this.org")).toBe(true);

      // Should not have random domains
      expect(isDomainTrusted("random-unknown.com")).toBe(false);
    });

    it("should handle empty TRUSTED_DOMAINS", () => {
      process.env.TRUSTED_DOMAINS = "";

      // Should still use defaults
      expect(isDomainTrusted("github.com")).toBe(true);
    });

    it("should use defaults when TRUSTED_DOMAINS not set", () => {
      delete process.env.TRUSTED_DOMAINS;

      expect(isDomainTrusted("github.com")).toBe(true);
      expect(isDomainTrusted("stackoverflow.com")).toBe(true);
    });
  });

  describe("Edge cases in URL handling", () => {
    it("should handle URLs with query parameters", () => {
      const result = validateUrlFormat(
        "https://example.com/page?query=test&other=value",
      );
      expect(result.valid).toBe(true);
      expect(result.domain).toBe("example.com");
    });

    it("should handle URLs with URL fragments", () => {
      const result = validateUrlFormat(
        "https://example.com/page#section-anchor",
      );
      expect(result.valid).toBe(true);
      expect(result.domain).toBe("example.com");
    });

    it("should handle URLs with query params and fragments", () => {
      const result = validateUrlFormat(
        "https://example.com/page?id=123#comments",
      );
      expect(result.valid).toBe(true);
      expect(result.domain).toBe("example.com");
    });

    it("should handle URLs with authentication (user:pass@host)", () => {
      const result = validateUrlFormat("https://user:password@example.com/api");
      expect(result.valid).toBe(true);
      expect(result.domain).toBe("example.com");
    });

    it("should handle URLs with path, query, and fragment all together", () => {
      const result = validateUrlFormat(
        "https://api.example.com:8443/v1/endpoint?key=value&limit=10#response",
      );
      expect(result.valid).toBe(true);
      expect(result.domain).toBe("api.example.com");
    });

    it("should handle very long URLs", () => {
      const longPath = "/path/" + "segment/".repeat(100);
      const url = `https://example.com${longPath}?param=value`;
      const result = validateUrlFormat(url);
      expect(result.valid).toBe(true);
      expect(result.domain).toBe("example.com");
    });

    it("should handle URLs with international domain (punycode)", () => {
      // Example: münchen.de (Munich in German) encoded as xn--mnchen-3ya.de
      const result = validateUrlFormat(
        "https://xn--mnchen-3ya.de/kulturzentrum",
      );
      expect(result.valid).toBe(true);
      expect(result.domain).toBe("xn--mnchen-3ya.de");
    });

    it("should reject URLs with multiple consecutive slashes", () => {
      const result = validateUrlFormat("https://example.com//api///v1/");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe(
        "URL contains consecutive slashes — please verify the URL format",
      );
    });

    it("should reject URLs with only whitespace in query/fragment", () => {
      // URL itself is valid, but domain extraction should work
      const result = validateUrlFormat("https://example.com?param=   ");
      expect(result.valid).toBe(true);
      expect(result.domain).toBe("example.com");
    });

    it("should handle deeply nested port numbers", () => {
      const result = validateUrlFormat("https://example.com:65535/api");
      expect(result.valid).toBe(true);
      expect(result.domain).toBe("example.com");
    });
  });

  describe("Private IP rejection edge cases", () => {
    it("should reject 172.16.0.0 range (172.16.0.0/12)", () => {
      const result = validateUrlFormat("https://172.16.0.1/admin");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Local and private URLs are not allowed");
    });

    it("should reject 172.31.255.255 (end of private range)", () => {
      const result = validateUrlFormat("https://172.31.255.255/test");
      expect(result.valid).toBe(false);
    });

    it("should allow 172.15.0.0 (just before private range)", () => {
      const result = validateUrlFormat("https://172.15.0.1/api");
      expect(result.valid).toBe(true); // Not in private range
      expect(result.domain).toBe("172.15.0.1");
    });

    it("should allow 172.32.0.0 (just after private range)", () => {
      const result = validateUrlFormat("https://172.32.0.1/api");
      expect(result.valid).toBe(true); // Not in private range
      expect(result.domain).toBe("172.32.0.1");
    });

    it("should reject 0.0.0.0", () => {
      const result = validateUrlFormat("https://0.0.0.0/test");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Local and private URLs are not allowed");
    });
  });

  describe("Type and input validation edge cases", () => {
    it("should handle URL as number input", () => {
      const result = validateUrlFormat(123);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("URL must be a string");
    });

    it("should handle URL as object input", () => {
      const result = validateUrlFormat({ url: "https://example.com" });
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("URL must be a string");
    });

    it("should handle URL as array input", () => {
      const result = validateUrlFormat(["https://example.com"]);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("URL must be a string");
    });

    it("should handle URL as false boolean", () => {
      const result = validateUrlFormat(false);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("URL must be a string");
    });

    it("should handle space padding in URL", () => {
      const result = validateUrlFormat("  https://example.com/path  ");
      expect(result.valid).toBe(true);
      expect(result.domain).toBe("example.com");
    });
  });

  describe("API response edge cases", () => {
    it("should handle API response with no results", async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ query_status: "no_results" }),
      });

      const result = await validateUrlSafety("https://clean-domain.com");
      expect(result.safe).toBe(true);
    });

    it("should handle API response with ok status and threat", async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            query_status: "ok",
            threat: "malware_download",
          }),
      });

      const result = await validateUrlSafety(
        "https://unknown-threat-domain.com",
      );
      expect(result.safe).toBe(false);
      expect(result.reason).toBe("URL flagged by security service");
    });

    it("should handle API response with ok status and non-clean threat", async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            query_status: "ok",
            threat: "phishing",
          }),
      });

      const result = await validateUrlSafety("https://multi-threat.com");
      expect(result.safe).toBe(false);
      expect(result.reason).toBe("URL flagged by security service");
    });

    it("should handle API response with null threat", async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ query_status: "no_results", threat: null }),
      });

      const result = await validateUrlSafety("https://null-matches.com");
      expect(result.safe).toBe(true);
    });

    it("should handle API response with undefined", async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const result = await validateUrlSafety("https://undefined-response.com");
      expect(result.safe).toBe(true);
    });
  });
});
