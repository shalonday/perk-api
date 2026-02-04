/**
 * Tests for POST /chatbot/chat endpoint
 * Tests LLM orchestration with tool calling and conversation flow
 */

// Mock @huggingface/inference BEFORE importing service
const mockChatCompletion = jest.fn();
jest.mock("@huggingface/inference", () => {
  return {
    HfInference: jest.fn().mockImplementation(() => ({
      chatCompletion: mockChatCompletion,
    })),
  };
});

// Mock neo4j-driver
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

// Mock @xenova/transformers for search_materials tool
jest.mock("@xenova/transformers", () => ({
  pipeline: jest.fn(() => {
    return jest.fn((text, options) => {
      const mockEmbedding = new Float32Array(384);
      for (let i = 0; i < 384; i++) {
        mockEmbedding[i] = Math.sin(i * 0.1) * 0.5;
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

describe("POST /chatbot/chat Endpoint", () => {
  let chatbotChat;
  let mockSession;
  let req;
  let res;

  beforeAll(() => {
    jest.resetModules();
    const service = require("../services/service");
    chatbotChat = service.chatbotChat;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockChatCompletion.mockClear();

    // Setup mock Neo4j session
    const neo4j = require("neo4j-driver");
    const mockDriver = neo4j.driver();
    mockSession = mockDriver.session();

    // Setup mock Express req/res
    req = {
      body: {
        message: "I want to learn React hooks",
        sessionId: "test-session-123",
        conversationHistory: [],
        customInstructions: null,
        context: {},
      },
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
  });

  describe("Valid requests", () => {
    test("should handle successful chat request with final response (no tool call)", async () => {
      // Mock LLM response - final answer
      mockChatCompletion.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                type: "final",
                message: "React hooks are great! Here are some resources.",
                relatedMaterials: [
                  { nodeId: "uuid-1", name: "React Hooks Guide", type: "url" },
                ],
                suggestedActions: ["Learn useState", "Learn useEffect"],
              }),
            },
          },
        ],
      });

      await chatbotChat(req, res);

      expect(mockChatCompletion).toHaveBeenCalledTimes(1);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "React hooks are great! Here are some resources.",
          relatedMaterials: [
            { nodeId: "uuid-1", name: "React Hooks Guide", type: "url" },
          ],
          suggestedActions: ["Learn useState", "Learn useEffect"],
          conversationState: expect.objectContaining({
            sessionId: "test-session-123",
          }),
        }),
      );
    });

    test("should handle LLM returning tool_call and execute search_materials", async () => {
      // Mock LLM first response - tool call
      mockChatCompletion.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                type: "tool_call",
                tool: "search_materials",
                args: { query: "React hooks", limit: 5 },
              }),
            },
          },
        ],
      });

      // Mock Neo4j search results
      mockSession.executeRead.mockResolvedValueOnce({
        records: [
          {
            get: jest.fn((key) => {
              if (key === "node") {
                return { id: "uuid-1", name: "React Hooks Guide", type: "URL" };
              } else if (key === "embedding") {
                const emb = new Float32Array(384);
                for (let i = 0; i < 384; i++) emb[i] = 0.1;
                return emb;
              }
            }),
          },
        ],
      });

      // Mock LLM second response - final answer after tool execution
      mockChatCompletion.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                type: "final",
                message: "I found these materials about React hooks.",
                relatedMaterials: [
                  { nodeId: "uuid-1", name: "React Hooks Guide", type: "url" },
                ],
                suggestedActions: [],
              }),
            },
          },
        ],
      });

      await chatbotChat(req, res);

      // Should call LLM twice: once for initial, once after tool execution
      expect(mockChatCompletion).toHaveBeenCalledTimes(2);

      // Should execute the search
      expect(mockSession.executeRead).toHaveBeenCalled();
      expect(mockSession.close).toHaveBeenCalled();

      // Should return final response
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "I found these materials about React hooks.",
        }),
      );
    });

    test("should handle request_material_addition tool call", async () => {
      // Mock LLM first response - request material addition
      mockChatCompletion.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                type: "tool_call",
                tool: "request_material_addition",
                args: {
                  topic: "SolidJS",
                  user_context: "User wants to learn reactive frameworks",
                },
              }),
            },
          },
        ],
      });

      // Mock LLM second response after tool
      mockChatCompletion.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                type: "final",
                message: "I've submitted your request for SolidJS materials.",
                relatedMaterials: [],
                suggestedActions: [],
              }),
            },
          },
        ],
      });

      req.body.message = "I want to learn SolidJS";

      await chatbotChat(req, res);

      expect(mockChatCompletion).toHaveBeenCalledTimes(2);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "I've submitted your request for SolidJS materials.",
        }),
      );
    });

    test("should inject tool result back to LLM correctly", async () => {
      // Mock tool call response
      mockChatCompletion.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                type: "tool_call",
                tool: "search_materials",
                args: { query: "TypeScript", limit: 3 },
              }),
            },
          },
        ],
      });

      // Mock search results
      mockSession.executeRead.mockResolvedValueOnce({
        records: [
          {
            get: jest.fn((key) => {
              if (key === "node") {
                return {
                  id: "uuid-ts",
                  name: "TypeScript Basics",
                  type: "URL",
                };
              } else if (key === "embedding") {
                return new Float32Array(384).fill(0.1);
              }
            }),
          },
        ],
      });

      // Mock final response
      mockChatCompletion.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                type: "final",
                message: "Here are TypeScript resources.",
                relatedMaterials: [],
                suggestedActions: [],
              }),
            },
          },
        ],
      });

      req.body.message = "Show me TypeScript tutorials";

      await chatbotChat(req, res);

      // Verify the second LLM call includes tool result
      const secondCallArgs = mockChatCompletion.mock.calls[1][0];
      const messages = secondCallArgs.messages;

      // Should have a message containing the tool result
      const toolResultMessage = messages.find((msg) =>
        msg.content.includes("Tool result for search_materials"),
      );
      expect(toolResultMessage).toBeDefined();
    });

    test("should handle conversation history in request", async () => {
      req.body.conversationHistory = [
        { role: "user", content: "Tell me about JavaScript" },
        { role: "assistant", content: "JavaScript is a programming language." },
      ];

      mockChatCompletion.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                type: "final",
                message: "Sure, here's more info.",
                relatedMaterials: [],
                suggestedActions: [],
              }),
            },
          },
        ],
      });

      await chatbotChat(req, res);

      // Verify conversation history is included in messages
      const callArgs = mockChatCompletion.mock.calls[0][0];
      expect(callArgs.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: "Tell me about JavaScript",
          }),
          expect.objectContaining({
            role: "assistant",
            content: "JavaScript is a programming language.",
          }),
        ]),
      );
    });

    test("should handle custom instructions", async () => {
      req.body.customInstructions = "Focus on beginner-friendly materials";

      mockChatCompletion.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                type: "final",
                message: "Here are beginner resources.",
                relatedMaterials: [],
                suggestedActions: [],
              }),
            },
          },
        ],
      });

      await chatbotChat(req, res);

      const callArgs = mockChatCompletion.mock.calls[0][0];
      const customInstMsg = callArgs.messages.find((msg) =>
        msg.content.includes("Focus on beginner-friendly materials"),
      );
      expect(customInstMsg).toBeDefined();
    });
  });

  describe("Error handling", () => {
    test("should return 400 for missing message field", async () => {
      req.body.message = null;

      await chatbotChat(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "message is required and must be a string",
        }),
      );
    });

    test("should return 400 for non-string message", async () => {
      req.body.message = 123;

      await chatbotChat(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "message is required and must be a string",
        }),
      );
    });

    test("should handle HF API failure gracefully", async () => {
      mockChatCompletion.mockRejectedValueOnce(new Error("HF API timeout"));

      await chatbotChat(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Chat request failed",
          message: "HF API timeout",
        }),
      );
    });

    test("should handle malformed LLM JSON response", async () => {
      mockChatCompletion.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: "This is not valid JSON",
            },
          },
        ],
      });

      await chatbotChat(req, res);

      // Should treat as final message (fallback behavior)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "This is not valid JSON",
          relatedMaterials: [],
          suggestedActions: [],
        }),
      );
    });

    test("should handle tool execution failure", async () => {
      mockChatCompletion.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                type: "tool_call",
                tool: "search_materials",
                args: { query: "test", limit: 5 },
              }),
            },
          },
        ],
      });

      // Mock search failure
      mockSession.executeRead.mockRejectedValueOnce(
        new Error("Database connection failed"),
      );

      await chatbotChat(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Chat request failed",
        }),
      );
    });

    test("should handle empty message string", async () => {
      req.body.message = "   ";

      await chatbotChat(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("Session management", () => {
    test("should generate new sessionId if not provided", async () => {
      delete req.body.sessionId;

      mockChatCompletion.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                type: "final",
                message: "Hello!",
                relatedMaterials: [],
                suggestedActions: [],
              }),
            },
          },
        ],
      });

      await chatbotChat(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationState: expect.objectContaining({
            sessionId: expect.stringMatching(/^session_\d+$/),
          }),
        }),
      );
    });

    test("should preserve provided sessionId", async () => {
      mockChatCompletion.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                type: "final",
                message: "Hello!",
                relatedMaterials: [],
                suggestedActions: [],
              }),
            },
          },
        ],
      });

      await chatbotChat(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationState: expect.objectContaining({
            sessionId: "test-session-123",
          }),
        }),
      );
    });

    test("should include timestamp in conversationState", async () => {
      mockChatCompletion.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                type: "final",
                message: "Hi",
                relatedMaterials: [],
                suggestedActions: [],
              }),
            },
          },
        ],
      });

      await chatbotChat(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationState: expect.objectContaining({
            lastUpdated: expect.any(String),
          }),
        }),
      );
    });
  });
});
