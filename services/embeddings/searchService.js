/**
 * Embedding and search utilities using @xenova/transformers.
 * Handles semantic search against Neo4j nodes with embeddings.
 */

/**
 * Search for nodes using semantic similarity.
 * Fetches all nodes with embeddings, computes similarity with query, and returns top results.
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

async function searchNodesBySimilarity(driver, query, limit = 5) {
  const session = driver.session();

  try {
    // Fetch all nodes with embeddings
    const result = await session.executeRead((tx) => {
      return tx.run(
        `
        MATCH (n:Skill|URL)
        WHERE n.embedding IS NOT NULL
        RETURN {
          uuid: n.uuid,
          name: n.name,
          type: labels(n)[0]
        } as node,
        n.embedding as embedding
        `,
      );
    });

    // If we have no results, return empty
    if (result.records.length === 0) {
      return {
        results: [],
        note: "No embeddings found. Run 'npm run generate-embeddings' to populate embeddings.",
      };
    }

    // Load embedding pipeline (supports ESM runtime + Jest test environment)
    const pipeline = await loadPipeline();
    const extractor = await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
    );

    // Generate embedding for the query
    const queryEmbeddingResult = await extractor(query, {
      pooling: "mean",
      normalize: true,
    });
    const queryEmbedding = Array.from(queryEmbeddingResult.data);

    // Compute cosine similarity with dot product (since embeddings are normalized)
    const scored = result.records
      .map((record) => {
        const nodeEmbedding = record.get("embedding");
        const similarity = nodeEmbedding.reduce(
          (sum, val, idx) => sum + val * queryEmbedding[idx],
          0,
        );
        return {
          node: record.get("node"),
          similarity,
        };
      })
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return { results: scored };
  } finally {
    session.close();
  }
}

module.exports = {
  searchNodesBySimilarity,
};
