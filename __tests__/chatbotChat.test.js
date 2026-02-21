/**
 * Tests for POST /chatbot/chat endpoint
 * Tests LLM orchestration with tool calling and conversation flow
 */

// Mock @huggingface/inference BEFORE importing service
const mockChatCompletion = jest.fn();
jest.mock("@huggingface/inference", () => {
  return {
    InferenceClient: jest.fn().mockImplementation(() => ({
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

// Import test helpers
const {
  createNormalizedEmbedding,
  createReq,
  createRes,
  createToolCallResponse,
  createFinalResponse,
  mockNeo4jSearchResults,
} = require("./helpers/chatbotChat.helpers");

// Mock @xenova/transformers for search_materials tool
jest.mock("@xenova/transformers", () => {
  return {
    pipeline: jest.fn(() => {
      // Require helpers inside the mock factory to avoid referencing out-of-scope variables
      const {
        createNormalizedEmbedding,
      } = require("./helpers/chatbotChat.helpers");
      const embedding = createNormalizedEmbedding();
      return jest.fn(() => Promise.resolve({ data: embedding }));
    }),
  };
});

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
    req = createReq();
    res = createRes();
  });

  describe("Valid requests", () => {
    test("should handle successful chat request with final response (no tool call)", async () => {
      // Mock LLM response - final answer
      mockChatCompletion.mockResolvedValueOnce(
        createFinalResponse({
          message: "React hooks are great.",
          suggestedActions: ["Learn useState", "Learn useEffect"],
        }),
      );

      await chatbotChat(req, res);

      expect(mockChatCompletion).toHaveBeenCalledTimes(1);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "React hooks are great.",
          relatedMaterials: [],
          suggestedActions: ["Learn useState", "Learn useEffect"],
          conversationState: expect.objectContaining({
            sessionId: "test-session-123",
          }),
        }),
      );
    });

    test("should handle LLM returning tool_call and execute search_materials", async () => {
      // Mock LLM first response - tool call
      mockChatCompletion.mockResolvedValueOnce(
        createToolCallResponse("search_materials", {
          query: "React hooks",
          limit: 5,
        }),
      );

      // Mock Neo4j search results
      mockSession.executeRead.mockResolvedValueOnce(
        mockNeo4jSearchResults([
          {
            node: {
              id: "uuid-1",
              name: "https://reactjs.org/docs/hooks-intro",
              type: "URL",
            },
            embedding: createNormalizedEmbedding(),
          },
        ]),
      );

      // Mock LLM second response - final answer after tool execution
      mockChatCompletion.mockResolvedValueOnce(
        createFinalResponse({
          message: "I found these materials about React hooks.",
          relatedMaterials: [
            {
              nodeId: "uuid-1",
              name: "https://reactjs.org/docs/hooks-intro",
              type: "url",
            },
          ],
        }),
      );

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

    test("should handle LLM asking user to contribute materials", async () => {
      // Mock LLM first response - search tool call
      mockChatCompletion.mockResolvedValueOnce(
        createToolCallResponse("search_materials", {
          query: "SolidJS",
          limit: 5,
        }),
      );

      // Mock search results (no relevant materials found)
      mockSession.executeRead.mockResolvedValueOnce(mockNeo4jSearchResults([]));

      // Mock LLM second response - no relevant results, asking for contributions
      mockChatCompletion.mockResolvedValueOnce(
        createFinalResponse({
          message:
            "We don't have materials on SolidJS. Do you have any resources you'd like to contribute?",
        }),
      );

      req.body.message = "I want to learn SolidJS";

      await chatbotChat(req, res);

      expect(mockChatCompletion).toHaveBeenCalledTimes(2);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Do you have any resources"),
        }),
      );
    });

    test("should inject tool result back to LLM correctly", async () => {
      // Mock tool call response
      mockChatCompletion.mockResolvedValueOnce(
        createToolCallResponse("search_materials", {
          query: "TypeScript",
          limit: 3,
        }),
      );

      // Mock search results from database
      mockSession.executeRead.mockResolvedValueOnce(
        mockNeo4jSearchResults([
          {
            node: {
              id: "uuid-ts",
              name: "https://www.typescriptlang.org/docs/",
              type: "URL",
            },
            embedding: createNormalizedEmbedding(),
          },
        ]),
      );

      // Mock final response
      mockChatCompletion.mockResolvedValueOnce(
        createFinalResponse({ message: "Here are TypeScript resources." }),
      );

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

      mockChatCompletion.mockResolvedValueOnce(
        createFinalResponse({ message: "Sure, here's more info." }),
      );

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

      mockChatCompletion.mockResolvedValueOnce(
        createFinalResponse({ message: "Here are beginner resources." }),
      );

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

      // Should return apology message when JSON parsing fails
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            "I apologize, but I encountered an error processing your request. The administrators have been notified and will investigate this issue. Please try again later or contact support if the problem persists.",
          relatedMaterials: [],
          suggestedActions: ["try_again", "contact_support"],
        }),
      );
    });

    test("should handle tool execution failure", async () => {
      mockChatCompletion.mockResolvedValueOnce(
        createToolCallResponse("search_materials", { query: "test", limit: 5 }),
      );

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

      mockChatCompletion.mockResolvedValueOnce(
        createFinalResponse({ message: "Hello!" }),
      );

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
      mockChatCompletion.mockResolvedValueOnce(
        createFinalResponse({ message: "Hello!" }),
      );

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
      mockChatCompletion.mockResolvedValueOnce(
        createFinalResponse({ message: "Hi" }),
      );

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
