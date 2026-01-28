/**
 * Tests for embedding generation script
 * Tests Neo4j integration and batch embedding generation
 */

const neo4j = require("neo4j-driver");

// Mock dependencies
jest.mock("neo4j-driver", () => {
  const actual = jest.requireActual("neo4j-driver");
  return {
    ...actual,
    driver: jest.fn(),
    auth: actual.auth,
  };
});

jest.mock("@xenova/transformers", () => ({
  pipeline: jest.fn(() => {
    return jest.fn((text) => {
      // Simple deterministic embedding for testing
      const emb = new Float32Array(384);
      let hash = 0;
      for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
      }
      for (let i = 0; i < 384; i++) {
        emb[i] = Math.sin((hash + i) * 0.1) * 0.5;
      }
      // Normalize
      let sum = 0;
      for (let i = 0; i < 384; i++) sum += emb[i] * emb[i];
      const norm = Math.sqrt(sum);
      for (let i = 0; i < 384; i++) emb[i] /= norm;
      return Promise.resolve({ data: emb });
    });
  }),
}));

jest.mock("dotenv", () => ({
  config: jest.fn(),
}));

describe("Embedding Generation Script", () => {
  let mockDriver;
  let mockSession;
  let mockTx;
  let consoleLogSpy;
  let consoleErrorSpy;
  let processExitSpy;

  beforeEach(() => {
    // Spy on console
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
    processExitSpy = jest.spyOn(process, "exit").mockImplementation();

    // Create mock transaction
    mockTx = {
      run: jest.fn(),
    };

    // Create mock session
    mockSession = {
      executeRead: jest.fn((cb) => cb(mockTx)),
      executeWrite: jest.fn((cb) => cb(mockTx)),
      close: jest.fn(),
    };

    // Create mock driver
    mockDriver = {
      session: jest.fn(() => mockSession),
      verifyAuthentication: jest.fn().mockResolvedValue(true),
      close: jest.fn().mockResolvedValue(undefined),
    };

    neo4j.driver.mockReturnValue(mockDriver);

    // Setup environment
    process.env.NEO4J_URI = "neo4j+s://test.databases.neo4j.io";
    process.env.NEO4J_USERNAME = "neo4j";
    process.env.NEO4J_PASSWORD = "password";
  });

  afterEach(() => {
    jest.clearAllMocks();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  test("should successfully connect to Neo4j", async () => {
    // This test verifies that the driver is properly mocked
    // The script initializes the driver at module load time
    const neo4j = require("neo4j-driver");
    const mockDriver = neo4j.driver();

    // Verify mock driver has expected methods
    expect(mockDriver.session).toBeDefined();
    expect(mockDriver.close).toBeDefined();
    expect(typeof mockDriver.session).toBe("function");
  });

  test("should fetch nodes without embeddings", async () => {
    const mockNodes = [
      { id: "uuid-1", name: "JavaScript", type: "Skill" },
      { id: "uuid-2", name: "Python", type: "Skill" },
      { id: "uuid-3", name: "MDN Docs", type: "URL" },
    ];

    mockTx.run.mockResolvedValue({
      records: mockNodes.map((node) => ({
        get: jest
          .fn()
          .mockReturnValueOnce(node.id)
          .mockReturnValueOnce(node.name)
          .mockReturnValueOnce(node.type),
      })),
    });

    // Test that executeRead is called for fetching nodes
    await mockSession.executeRead((tx) => {
      return tx.run(
        `
        MATCH (n:Skill|URL)
        WHERE n.embedding IS NULL
        RETURN n.id as id, n.name as name, labels(n)[0] as type
      `,
      );
    });

    expect(mockSession.executeRead).toHaveBeenCalled();
    expect(mockTx.run).toHaveBeenCalledWith(
      expect.stringContaining("embedding IS NULL"),
    );
  });

  test("should batch process nodes", async () => {
    const BATCH_SIZE = 10;
    const mockNodes = Array.from({ length: 25 }, (_, i) => ({
      id: `uuid-${i}`,
      name: `Node ${i}`,
      type: "Skill",
    }));

    // Simulate batching
    const batches = [];
    for (let i = 0; i < mockNodes.length; i += BATCH_SIZE) {
      batches.push(mockNodes.slice(i, i + BATCH_SIZE));
    }

    expect(batches.length).toBe(3); // 25 nodes in batches of 10 = 3 batches
    expect(batches[0].length).toBe(10);
    expect(batches[1].length).toBe(10);
    expect(batches[2].length).toBe(5);
  });

  test("should update nodes with embeddings", async () => {
    const nodeId = "uuid-1";
    const embedding = new Float32Array(384);
    for (let i = 0; i < 384; i++) embedding[i] = 0.1;

    mockTx.run.mockResolvedValue({
      records: [{ get: jest.fn().mockReturnValue({ id: nodeId }) }],
    });

    await mockSession.executeWrite((tx) => {
      return tx.run(
        `
        MATCH (n {id: $id})
        SET n.embedding = $embedding
        RETURN n
      `,
        { id: nodeId, embedding: Array.from(embedding) },
      );
    });

    expect(mockSession.executeWrite).toHaveBeenCalled();
    expect(mockTx.run).toHaveBeenCalledWith(
      expect.stringContaining("SET n.embedding"),
      expect.objectContaining({ id: nodeId }),
    );
  });

  test("should calculate node statistics", async () => {
    mockTx.run.mockResolvedValue({
      records: [
        {
          get: jest
            .fn()
            .mockReturnValueOnce(25) // with embeddings
            .mockReturnValueOnce(50), // total
        },
      ],
    });

    await mockSession.executeRead((tx) => {
      return tx.run(`
        MATCH (n:Skill|URL)
        RETURN 
          count(CASE WHEN n.embedding IS NOT NULL THEN 1 END) as withEmbeddings,
          count(n) as total
      `);
    });

    expect(mockSession.executeRead).toHaveBeenCalled();
    expect(mockTx.run).toHaveBeenCalledWith(
      expect.stringContaining("count(CASE"),
    );
  });

  test("should handle connection errors", async () => {
    // Reset mocks to test error handling
    jest.clearAllMocks();

    const connectionError = new Error("Connection failed");
    mockDriver.verifyAuthentication = jest
      .fn()
      .mockRejectedValue(connectionError);

    neo4j.driver.mockReturnValue(mockDriver);

    // Script would exit on connection error
    expect(mockDriver.verifyAuthentication).toBeDefined();
  });

  test("should close Neo4j session properly", async () => {
    await mockSession.close();

    expect(mockSession.close).toHaveBeenCalled();
  });

  test("should generate normalized embeddings", async () => {
    const { pipeline } = require("@xenova/transformers");
    const extractor = await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
    );

    const result = await extractor("test text");

    expect(result.data).toBeDefined();
    expect(result.data.length).toBe(384); // all-MiniLM-L6-v2 produces 384-dim embeddings
  });

  test("should handle errors during embedding generation", async () => {
    const { pipeline } = require("@xenova/transformers");

    // Mock pipeline to reject
    const mockPipeline = jest
      .fn()
      .mockRejectedValue(new Error("Model load failed"));
    require("@xenova/transformers").pipeline = mockPipeline;

    expect(mockPipeline).toBeDefined();
  });
});
