const EMBEDDING_SIZE = 384;

function createNormalizedEmbedding() {
  const mockEmbedding = new Float32Array(EMBEDDING_SIZE);
  for (let i = 0; i < EMBEDDING_SIZE; i++) {
    mockEmbedding[i] = Math.sin(i * 0.1) * 0.5;
  }
  let sum = 0;
  for (let i = 0; i < EMBEDDING_SIZE; i++) {
    sum += mockEmbedding[i] * mockEmbedding[i];
  }
  const norm = Math.sqrt(sum);
  for (let i = 0; i < EMBEDDING_SIZE; i++) {
    mockEmbedding[i] /= norm;
  }
  return mockEmbedding;
}

const createReq = (overrides = {}) => ({
  body: {
    message: "I want to learn React hooks",
    sessionId: "test-session-123",
    conversationHistory: [],
    customInstructions: null,
    context: {},
    ...overrides,
  },
});

const createRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
});

const createToolCallResponse = (tool, args) => ({
  choices: [
    {
      message: {
        content: JSON.stringify({ type: "tool_call", tool, args }),
      },
    },
  ],
});

const createFinalResponse = ({
  message,
  relatedMaterials = [],
  suggestedActions = [],
}) => ({
  choices: [
    {
      message: {
        content: JSON.stringify({
          type: "final",
          message,
          relatedMaterials,
          suggestedActions,
        }),
      },
    },
  ],
});

const mockNeo4jSearchResults = (records) => ({
  records: records.map((record) => ({
    get: jest.fn((key) => record[key]),
  })),
});

module.exports = {
  EMBEDDING_SIZE,
  createNormalizedEmbedding,
  createReq,
  createRes,
  createToolCallResponse,
  createFinalResponse,
  mockNeo4jSearchResults,
};
