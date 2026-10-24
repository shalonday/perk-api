jest.mock("@xenova/transformers", () => ({
  pipeline: jest.fn(),
}));

const { pipeline } = require("@xenova/transformers");
const {
  embedText,
  fetchNodesWithEmbeddings,
  rankNodesBySimilarity,
  searchNodesBySimilarity,
} = require("../services/embeddings/searchService");

function createRecord(node, embedding) {
  return {
    get: jest.fn((key) => (key === "node" ? node : embedding)),
  };
}

function createDriver(records) {
  const txRun = jest.fn().mockResolvedValue({ records });
  const session = {
    executeRead: jest.fn((callback) => callback({ run: txRun })),
    close: jest.fn(),
  };

  return {
    driver: { session: jest.fn(() => session) },
    session,
    txRun,
  };
}

describe("embedding search helpers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("fetches embedded nodes filtered by the requested labels", async () => {
    const node = { uuid: "skill-1", name: "Fractions", type: "Skill" };
    const embedding = [0.5, 0.5];
    const { driver, session, txRun } = createDriver([
      createRecord(node, embedding),
    ]);

    await expect(fetchNodesWithEmbeddings(driver, ["Skill"])).resolves.toEqual([
      { node, embedding },
    ]);

    expect(txRun).toHaveBeenCalledWith(
      expect.stringContaining("nodeType IN $nodeTypes"),
      { nodeTypes: ["Skill"] },
    );
    expect(session.close).toHaveBeenCalled();
  });

  test("embeds text with the configured normalized feature-extraction pipeline", async () => {
    const extractor = jest
      .fn()
      .mockResolvedValue({ data: Float32Array.from([0.25, 0.75]) });
    pipeline.mockResolvedValue(extractor);

    await expect(embedText("learn fractions")).resolves.toEqual([0.25, 0.75]);

    expect(pipeline).toHaveBeenCalledWith(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
    );
    expect(extractor).toHaveBeenCalledWith("learn fractions", {
      pooling: "mean",
      normalize: true,
    });
  });

  test("ranks results by similarity and applies the result limit", () => {
    const nodes = [
      { node: { name: "Lower match" }, embedding: [0.2, 0.8] },
      { node: { name: "Higher match" }, embedding: [0.9, 0.1] },
    ];

    expect(rankNodesBySimilarity(nodes, [1, 0], 1)).toEqual([
      { node: { name: "Higher match" }, similarity: 0.9 },
    ]);
  });

  test("composes the helpers and preserves empty-embedding behavior", async () => {
    const { driver } = createDriver([]);

    await expect(searchNodesBySimilarity(driver, "fractions")).resolves.toEqual(
      {
        results: [],
        note: "No embeddings found. Run 'npm run generate-embeddings' to populate embeddings.",
      },
    );
    expect(pipeline).not.toHaveBeenCalled();
  });

  test("composes the helpers to return ranked search results", async () => {
    const records = [
      createRecord({ name: "Lower match" }, [0.2, 0.8]),
      createRecord({ name: "Higher match" }, [0.9, 0.1]),
    ];
    const { driver, session } = createDriver(records);
    const extractor = jest.fn().mockResolvedValue({
      data: Float32Array.from([1, 0]),
    });
    pipeline.mockResolvedValue(extractor);

    const result = await searchNodesBySimilarity(driver, "fractions", 1);

    expect(result.results).toEqual([
      { node: { name: "Higher match" }, similarity: 0.9 },
    ]);
    expect(session.close).toHaveBeenCalled();
  });
});
