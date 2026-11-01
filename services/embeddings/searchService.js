/**
 * Embedding and search utilities using @xenova/transformers.
 * Handles semantic search against Neo4j nodes with embeddings.
 */

const DEFAULT_NODE_TYPES = ["Skill", "URL"];
const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
let extractorPromise;

/**
 * Loads the Transformers pipeline in the format supported by the current runtime.
 */
async function loadPipeline() {
  // Jest runs tests in a CJS VM context where dynamic import requires an extra
  // node flag. Use the mocked CJS require path in tests, and dynamic import at runtime.
  if (process.env.JEST_WORKER_ID) {
    return require("@xenova/transformers").pipeline;
  }

  const { pipeline } = await import("@xenova/transformers");
  return pipeline;
}

/**
 * Loads and reuses the text embedding extractor.
 *
 * @returns {Promise<Function>} Transformers feature-extraction pipeline.
 */
async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const pipeline = await loadPipeline();
      return pipeline("feature-extraction", EMBEDDING_MODEL);
    })();
  }

  try {
    return await extractorPromise;
  } catch (error) {
    extractorPromise = undefined;
    throw error;
  }
}

/**
 * Fetches embedded nodes with selected labels from Neo4j.
 *
 * @param {object} driver - Neo4j driver.
 * @param {string[]} nodeTypes - Node labels to search.
 * @returns {Promise<{ node: object, embedding: number[] }[]>} Nodes with embeddings.
 */
async function fetchNodesWithEmbeddings(
  driver,
  nodeTypes = DEFAULT_NODE_TYPES,
) {
  const session = driver.session();

  try {
    const result = await session.executeRead((tx) => {
      return tx.run(
        `
        MATCH (n)
        WHERE any(nodeType IN labels(n) WHERE nodeType IN $nodeTypes)
          AND n.embedding IS NOT NULL
        RETURN {
          uuid: n.uuid,
          name: n.name,
          type: labels(n)[0]
        } as node,
        n.embedding as embedding
        `,
        { nodeTypes },
      );
    });

    return result.records.map((record) => ({
      node: record.get("node"),
      embedding: record.get("embedding"),
    }));
  } finally {
    session.close();
  }
}

/**
 * Generates a normalized embedding for a text query.
 *
 * @param {string} text - Text to embed.
 * @returns {Promise<number[]>} Normalized query embedding.
 */
async function embedText(text) {
  const extractor = await getExtractor();
  const embeddingResult = await extractor(text, {
    pooling: "mean",
    normalize: true,
  });

  return Array.from(embeddingResult.data);
}

/**
 * Ranks embedded nodes by cosine similarity with a normalized query embedding.
 *
 * @param {{ node: object, embedding: number[] }[]} nodes - Nodes to rank.
 * @param {number[]} queryEmbedding - Normalized query embedding.
 * @param {number} limit - Maximum number of results.
 * @returns {{ node: object, similarity: number }[]} Ranked top results.
 */
function rankNodesBySimilarity(nodes, queryEmbedding, limit = 5) {
  return nodes
    .map(({ node, embedding }) => ({
      node,
      // Embeddings are normalized, so their dot product is cosine similarity.
      similarity: embedding.reduce(
        (sum, value, index) => sum + value * queryEmbedding[index],
        0,
      ),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

/**
 * Searches embedded Neo4j nodes using semantic similarity.
 *
 * @param {object} driver - Neo4j driver.
 * @param {string} query - Text query to search for.
 * @param {number} limit - Maximum number of results.
 * @returns {Promise<{ results: object[], note?: string }>} Ranked search results.
 */
async function searchNodesBySimilarity(driver, query, limit = 5) {
  const nodes = await fetchNodesWithEmbeddings(driver);
  if (nodes.length === 0) {
    return {
      results: [],
      note: "No embeddings found. Run 'npm run generate-embeddings' to populate embeddings.",
    };
  }

  const queryEmbedding = await embedText(query);
  return {
    results: rankNodesBySimilarity(nodes, queryEmbedding, limit),
  };
}

module.exports = {
  fetchNodesWithEmbeddings,
  embedText,
  rankNodesBySimilarity,
  searchNodesBySimilarity,
};
