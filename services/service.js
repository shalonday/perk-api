const neo4j = require("neo4j-driver");
require("dotenv").config();

// Import extracted modules
const {
  buildMessages,
  callHfChat,
  parseLlmResponse,
} = require("./chatbot/llmOrchestrator");
const { getD3CompatibleLink } = require("./neo4j/neo4jHelpers");
const { searchNodesBySimilarity } = require("./embeddings/searchService");

let driver;

async function initDriver() {
  try {
    driver = await neo4j.driver(
      process.env.NEO4J_URI,
      neo4j.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD),
    );
    await driver.verifyAuthentication;
    console.log("connection to server established");
  } catch (err) {
    console.error(err);
  }
}

initDriver();

// Execute transactions one by one to declare necessary variables one by one
async function readUniversalTree(req, res, next) {
  const session = driver.session();

  const getSkillsTransaction = await session.executeRead((tx) => {
    return tx.run("MATCH (s:Skill) RETURN s");
  });

  const skills = getSkillsTransaction.records.map(
    (record) => record.get("s").properties,
  );
  skills.map((skill) => (skill.type = "skill"));

  const getURLsTransaction = await session.executeRead((tx) => {
    return tx.run("MATCH (u:URL) RETURN u");
  });

  const urls = getURLsTransaction.records.map(
    (record) => record.get("u").properties,
  );
  urls.map((url) => (url.type = "url"));

  const getPrerequisiteLinksTransaction = await session.executeRead((tx) => {
    return tx.run(
      "MATCH (s:Skill)-[r:IS_PREREQUISITE_TO]->(u:URL) RETURN s,r,u",
    );
  });

  const prereqLinks = getPrerequisiteLinksTransaction.records.map((record) => {
    const link = {
      source: record.get("s").properties.id,
      target: record.get("u").properties.id,
      id: record.get("r").properties.id,
    };

    return link;
  });

  const getTeachesLinksTransaction = await session.executeRead((tx) => {
    return tx.run("MATCH (u:URL)-[r:TEACHES]->(s:Skill) RETURN u,r,s");
  });

  const teachesLinks = getTeachesLinksTransaction.records.map((record) => {
    const link = {
      source: record.get("u").properties.id,
      target: record.get("s").properties.id,
      id: record.get("r").properties.id,
    };

    return link;
  });

  const nodes = urls.concat(skills);
  const links = prereqLinks.concat(teachesLinks);
  res.json({ nodes, links });

  session.close();
  console.log("session closed at read");
}

/**
 * Read a path between two nodes.
 */

async function readPath(req, res, next) {
  const startNodeId = req.params.startNodeId;
  const targetNodeId = req.params.targetNodeId;

  const session = driver.session();

  const pathTransaction = await session.executeRead((tx) => {
    return tx.run(
      `MATCH p=({id: "${startNodeId}"})-[*]->({id:"${targetNodeId}"})
      UNWIND relationships(p) AS relationshipsWithCopies
      UNWIND nodes(p) AS nodesWithCopies
      RETURN collect(distinct relationshipsWithCopies) as relationships, collect(distinct nodesWithCopies) as nodes`,
    );
  });

  // the pathTransaction only returns one record, which can be accessed with
  // records[0]. It contains one "nodes" array and one "relationships" array.
  const nodesWithInternalData = pathTransaction.records[0].get("nodes");

  const nodes = nodesWithInternalData.map((node) => {
    const nodeData = node.properties;
    nodeData.type = node.labels[0].toLowerCase();
    return nodeData;
  });

  const links = pathTransaction.records[0].get("relationships").map((link) => {
    return getD3CompatibleLink(link, nodesWithInternalData);
  });

  res.json({
    nodes: nodes,
    links: links,
  });

  session.close();
}

/**
 * Semantic search endpoint for chatbot.
 */
async function chatbotSearch(req, res) {
  try {
    const { query, limit = 5 } = req.body;

    if (!query || typeof query !== "string") {
      return res.status(400).json({
        error: "Query is required and must be a string",
      });
    }

    const searchResult = await searchNodesBySimilarity(driver, query, limit);

    res.json({
      ...searchResult,
      query,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("chatbotSearch error:", error);
    res.status(500).json({
      error: "Search failed",
      message: error.message,
    });
  }
}

/**
 * Material request endpoint.
 */
async function chatbotMaterialRequest(req, res) {
  try {
    const { embed, request } = req.body;

    if (!embed || !request) {
      return res.status(400).json({
        error: "Both embed and request objects are required",
      });
    }

    // TODO: Send to Discord webhook
    // const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    // await axios.post(webhookUrl, { embeds: [embed] });

    res.json({
      success: true,
      message: "Material request submitted",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("chatbotMaterialRequest error:", error);
    res.status(500).json({
      error: "Material request failed",
      message: error.message,
    });
  }
}

/**
 * Execute a tool call internally.
 * Handles search_materials and request_material_addition tools.
 */
async function executeTool(tool, args, driver) {
  if (tool === "search_materials") {
    const { query, limit = 5 } = args;
    const searchResult = await searchNodesBySimilarity(driver, query, limit);
    return searchResult;
  } else if (tool === "request_material_addition") {
    // Queue the request (simplified: just acknowledge)
    const requestId = `req_${Date.now()}`;
    console.log(`[Material Request] ${requestId}:`, args);
    return { requestId, status: "queued" };
  }

  return { error: `Unknown tool: ${tool}` };
}

/**
 * POST /chatbot/chat — main chatbot orchestration endpoint.
 * Handles LLM conversation with tool calling support.
 */
async function chatbotChat(req, res) {
  try {
    const { message, sessionId, conversationHistory, customInstructions } =
      req.body;

    if (!message || typeof message !== "string" || message.trim() === "") {
      return res
        .status(400)
        .json({ error: "message is required and must be a string" });
    }

    console.log(
      `[chatbotChat] sessionId=${sessionId || "none"}, message="${message.slice(0, 50)}..."`,
    );

    // Build initial messages and call the LLM
    let messages = buildMessages(
      message,
      conversationHistory,
      customInstructions,
      null,
    );
    let rawResponse = await callHfChat(messages);
    let parsed = parseLlmResponse(rawResponse);

    console.log("[chatbotChat] LLM response type:", parsed.type);

    // Handle tool calls (max 1 round to prevent infinite loops)
    if (parsed.type === "tool_call") {
      const { tool, args } = parsed;
      console.log(`[chatbotChat] Executing tool: ${tool}`, args);

      const toolOutput = await executeTool(tool, args, driver);
      console.log(
        `[chatbotChat] Tool output:`,
        JSON.stringify(toolOutput).slice(0, 200),
      );

      // Re-invoke LLM with tool result
      messages = buildMessages(
        message,
        conversationHistory,
        customInstructions,
        {
          tool,
          args,
          output: toolOutput,
        },
      );
      rawResponse = await callHfChat(messages);
      parsed = parseLlmResponse(rawResponse);
      console.log("[chatbotChat] LLM final response type:", parsed.type);
    }

    // Build the response
    const response = {
      message: parsed.message || "",
      relatedMaterials: parsed.relatedMaterials || [],
      suggestedActions: parsed.suggestedActions || [],
      conversationState: {
        sessionId: sessionId || `session_${Date.now()}`,
        lastUpdated: new Date().toISOString(),
      },
    };

    res.json(response);
  } catch (error) {
    console.error("[chatbotChat] Error:", error);
    console.error("[chatbotChat] Full error details:", {
      name: error.name,
      message: error.message,
      stack: error.stack,
      response: error.response?.data,
      status: error.response?.status,
      statusText: error.response?.statusText,
    });
    res.status(500).json({
      error: "Chat request failed",
      message: error.message,
      details: error.response?.data || error.toString(),
    });
  }
}

module.exports = {
  readUniversalTree,
  readPath,
  chatbotSearch,
  chatbotMaterialRequest,
  chatbotChat,
};
