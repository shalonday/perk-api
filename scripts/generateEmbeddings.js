#!/usr/bin/env node

/**
 * Embedding Generation Script
 * Generates and stores embeddings for all Skill and URL nodes in Neo4j Aura
 *
 * Usage:
 *   node scripts/generateEmbeddings.js
 *
 * Requirements:
 *   - Environment variables: NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD
 *   - @xenova/transformers installed
 */

require("dotenv").config();
const neo4j = require("neo4j-driver");
const { pipeline } = require("@xenova/transformers");

// Configuration
const BATCH_SIZE = 10;
const MODEL = "Xenova/all-MiniLM-L6-v2"; // 384-dimensional embeddings, fast & lightweight

let driver;

/**
 * Initialize Neo4j driver
 */
async function initDriver() {
  try {
    driver = neo4j.driver(
      process.env.NEO4J_URI,
      neo4j.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD),
    );
    await driver.verifyAuthentication();
    console.log("✓ Connected to Neo4j");
    return driver;
  } catch (error) {
    console.error("✗ Failed to connect to Neo4j:", error.message);
    process.exit(1);
  }
}

/**
 * Generate embedding for a single text using sentence transformer
 */
async function generateEmbedding(extractor, text) {
  try {
    const result = await extractor(text, {
      pooling: "mean",
      normalize: true,
    });

    // Convert to array and round to 4 decimal places for storage efficiency
    const embedding = Array.from(result.data).map(
      (val) => Math.round(val * 10000) / 10000,
    );

    return embedding;
  } catch (error) {
    console.error(`Error generating embedding for "${text}":`, error.message);
    throw error;
  }
}

/**
 * Fetch all nodes without embeddings
 */
async function fetchNodesWithoutEmbeddings() {
  const session = driver.session();
  try {
    const result = await session.executeRead((tx) => {
      return tx.run(`
        MATCH (n:Skill|URL)
        WHERE n.embedding IS NULL
        RETURN n.id as id, n.name as name, labels(n)[0] as type
      `);
    });

    const nodes = result.records.map((record) => ({
      id: record.get("id"),
      name: record.get("name"),
      type: record.get("type"),
    }));

    return nodes;
  } finally {
    session.close();
  }
}

/**
 * Update node with embedding
 */
async function updateNodeEmbedding(id, embedding) {
  const session = driver.session();
  try {
    await session.executeWrite((tx) => {
      return tx.run(
        `
        MATCH (n {id: $id})
        SET n.embedding = $embedding
        RETURN n
        `,
        { id, embedding },
      );
    });
  } finally {
    session.close();
  }
}

/**
 * Get total node count and embedding progress
 */
async function getNodeStats() {
  const session = driver.session();
  try {
    const result = await session.executeRead((tx) => {
      return tx.run(`
        MATCH (n:Skill|URL)
        RETURN 
          count(CASE WHEN n.embedding IS NOT NULL THEN 1 END) as withEmbeddings,
          count(n) as total
      `);
    });

    const record = result.records[0];
    return {
      total: record.get("total").toNumber(),
      withEmbeddings: record.get("withEmbeddings").toNumber(),
      remaining:
        record.get("total").toNumber() -
        record.get("withEmbeddings").toNumber(),
    };
  } finally {
    session.close();
  }
}

/**
 * Main execution
 */
async function main() {
  console.log(`
╔════════════════════════════════════════════════╗
║     Neo4j Embedding Generation Script          ║
║     Model: ${MODEL}           ║
║     Batch Size: ${BATCH_SIZE}                              ║
╚════════════════════════════════════════════════╝
  `);

  try {
    // Initialize
    await initDriver();

    // Check node stats
    let stats = await getNodeStats();
    console.log(`\nNode Statistics:`);
    console.log(`  Total nodes: ${stats.total}`);
    console.log(`  With embeddings: ${stats.withEmbeddings}`);
    console.log(`  Remaining: ${stats.remaining}`);

    if (stats.remaining === 0) {
      console.log("\n✓ All nodes already have embeddings!");
      process.exit(0);
    }

    console.log(`\nInitializing embedding model: ${MODEL}`);
    console.log(`(This may take a moment on first run...)\n`);

    // Initialize the embedding pipeline
    const extractor = await pipeline("feature-extraction", MODEL);

    // Fetch nodes without embeddings
    const nodes = await fetchNodesWithoutEmbeddings();
    console.log(
      `Processing ${nodes.length} nodes in batches of ${BATCH_SIZE}...\n`,
    );

    // Process in batches
    let processedCount = 0;
    for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
      const batch = nodes.slice(i, i + BATCH_SIZE);
      const startIdx = i + 1;

      console.log(`[${startIdx}/${nodes.length}] Processing batch...`);

      // Generate embeddings for batch
      const embeddings = await Promise.all(
        batch.map((node) => generateEmbedding(extractor, node.name)),
      );

      // Update each node
      await Promise.all(
        batch.map((node, idx) => updateNodeEmbedding(node.id, embeddings[idx])),
      );

      processedCount += batch.length;
      console.log(
        `  ✓ Processed ${batch.length} nodes (${processedCount}/${nodes.length})`,
      );
    }

    // Final stats
    stats = await getNodeStats();
    console.log(`
✓ Embedding generation complete!
  Total nodes: ${stats.total}
  With embeddings: ${stats.withEmbeddings}
  Coverage: ${((stats.withEmbeddings / stats.total) * 100).toFixed(1)}%
    `);
  } catch (error) {
    console.error("\n✗ Error during embedding generation:", error);
    process.exit(1);
  } finally {
    if (driver) {
      await driver.close();
      console.log("✓ Neo4j connection closed");
    }
  }
}

// Run the script
main();
