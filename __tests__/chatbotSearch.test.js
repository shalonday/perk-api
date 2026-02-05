/**
 * Tests for chatbot search endpoint
 * Tests semantic similarity search with embeddings
 */

// Mock neo4j-driver BEFORE importing service
jest.mock("neo4j-driver", () => {
  const mockSession = {
    executeRead: jest.fn(),
    close: jest.fn(),
  };

  const mockDriver = {
    session: jest.fn(() => mockSession),
    verifyAuthentication: Promise.resolve(),
    close: jest.fn().mockResolvedValue(undefined),
  };

  return {
    driver: jest.fn(() => mockDriver),
    auth: {
      basic: jest.fn((user, pass) => ({ user, pass })),
    },
  };
});

// Mock @xenova/transformers
jest.mock("@xenova/transformers", () => ({
  pipeline: jest.fn(() => {
    return jest.fn((text, _options) => {
      // Return mock embedding based on text
      const mockEmbedding = new Float32Array(384);
      // Simple hash-based mock embedding for consistency
      let hash = 0;
      for (let i = 0; i < text.length; i++) {
        const char = text.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash; // Convert to 32bit integer
      }
      // Fill embedding with pseudo-random values based on hash
      for (let i = 0; i < 384; i++) {
        mockEmbedding[i] =
          Math.sin((hash + i) * 0.1) * 0.5 + Math.cos((hash + i) * 0.2) * 0.5;
      }
      // Normalize
      let sum = 0;
      for (let i = 0; i < 384; i++) {
        sum += mockEmbedding[i] * mockEmbedding[i];
      }
      const norm = Math.sqrt(sum);
      for (let i = 0; i < 384; i++) {
        mockEmbedding[i] /= norm;
      }
      return Promise.resolve({ data: mockEmbedding });
    });
  }),
}));

describe("Chatbot Search Endpoint", () => {
  let chatbotSearch;
  let mockSession;

  beforeAll(() => {
    // Clear modules and re-import with mocked dependencies
    jest.resetModules();
    const service = require("../services/service");
    chatbotSearch = service.chatbotSearch;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    const neo4j = require("neo4j-driver");
    const mockDriver = neo4j.driver();
    mockSession = mockDriver.session();
  });

  test("should return search results with similarity scores", async () => {
    const mockRecords = [
      {
        get: jest.fn((key) => {
          if (key === "node") {
            return { id: "uuid-1", name: "JavaScript Basics", type: "Skill" };
          } else if (key === "embedding") {
            const emb = new Float32Array(384);
            for (let i = 0; i < 384; i++) emb[i] = 0.1;
            return emb;
          }
        }),
      },
      {
        get: jest.fn((key) => {
          if (key === "node") {
            return { id: "uuid-2", name: "Python Basics", type: "Skill" };
          } else if (key === "embedding") {
            const emb = new Float32Array(384);
            for (let i = 0; i < 384; i++) emb[i] = 0.05;
            return emb;
          }
        }),
      },
    ];

    mockSession.executeRead.mockResolvedValue({
      records: mockRecords,
    });

    const req = {
      body: { query: "JavaScript", limit: 5 },
    };

    const res = {
      json: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
    };

    await chatbotSearch(req, res);

    expect(res.json).toHaveBeenCalled();
    const response = res.json.mock.calls[0][0];
    expect(response.results).toBeDefined();
    expect(response.results.length).toBeLessThanOrEqual(5);
    expect(response.query).toBe("JavaScript");
    expect(response.timestamp).toBeDefined();
  });

  test("should return 400 when query is missing", async () => {
    const req = {
      body: {},
    };

    const res = {
      json: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
    };

    await chatbotSearch(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.any(String),
      }),
    );
  });

  test("should return 400 when query is not a string", async () => {
    const req = {
      body: { query: 123 },
    };

    const res = {
      json: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
    };

    await chatbotSearch(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("should use default limit of 5", async () => {
    const mockRecords = Array.from({ length: 10 }, (_, i) => ({
      get: jest.fn((key) => {
        if (key === "node") {
          return {
            id: `uuid-${i}`,
            name: `Skill ${i}`,
            type: "Skill",
          };
        } else if (key === "embedding") {
          const emb = new Float32Array(384);
          for (let j = 0; j < 384; j++) emb[j] = 0.1;
          return emb;
        }
      }),
    }));

    mockSession.executeRead.mockResolvedValue({
      records: mockRecords,
    });

    const req = {
      body: { query: "test" },
    };

    const res = {
      json: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
    };

    await chatbotSearch(req, res);

    const response = res.json.mock.calls[0][0];
    expect(response.results.length).toBeLessThanOrEqual(5);
  });

  test("should return empty results when no embeddings exist", async () => {
    mockSession.executeRead.mockResolvedValue({
      records: [],
    });

    const req = {
      body: { query: "test", limit: 5 },
    };

    const res = {
      json: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
    };

    await chatbotSearch(req, res);

    const response = res.json.mock.calls[0][0];
    expect(response.results).toEqual([]);
    expect(response.note).toBeDefined();
  });

  test("should handle errors gracefully", async () => {
    mockSession.executeRead.mockRejectedValue(
      new Error("Database connection failed"),
    );

    const req = {
      body: { query: "test" },
    };

    const res = {
      json: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
    };

    await chatbotSearch(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Search failed",
      }),
    );
  });

  test("should sort results by similarity in descending order", async () => {
    const mockRecords = [
      {
        get: jest.fn((key) => {
          if (key === "node")
            return { id: "uuid-1", name: "Low similarity", type: "Skill" };
          const emb = new Float32Array(384);
          for (let i = 0; i < 384; i++) emb[i] = 0.1;
          return emb;
        }),
      },
      {
        get: jest.fn((key) => {
          if (key === "node")
            return { id: "uuid-2", name: "High similarity", type: "Skill" };
          const emb = new Float32Array(384);
          for (let i = 0; i < 384; i++) emb[i] = 0.9;
          return emb;
        }),
      },
    ];

    mockSession.executeRead.mockResolvedValue({
      records: mockRecords,
    });

    const req = {
      body: { query: "test", limit: 10 },
    };

    const res = {
      json: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
    };

    await chatbotSearch(req, res);

    const response = res.json.mock.calls[0][0];
    // Results should be sorted by similarity descending
    for (let i = 1; i < response.results.length; i++) {
      expect(response.results[i - 1].similarity).toBeGreaterThanOrEqual(
        response.results[i].similarity,
      );
    }
  });
});
