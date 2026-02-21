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
 * Get the LLM's initial response to a user message.
 * Expects the LLM to return a tool_call (search_materials).
 */
async function getInitialLlmResponse(
  userMessage,
  conversationHistory,
  customInstructions,
) {
  const messages = buildMessages(
    userMessage,
    conversationHistory,
    customInstructions,
    null,
  );
  const rawResponse = await callHfChat(messages);
  const parsed = parseLlmResponse(rawResponse);

  console.log("[getInitialLlmResponse] LLM response type:", parsed.type);

  return parsed;
}

/**
 * Execute a search tool call and return results.
 */
async function executeSearch(args) {
  const { query, limit = 5 } = args;
  console.log(`[executeSearch] Searching for: "${query}" (limit: ${limit})`);

  const searchResult = await searchNodesBySimilarity(driver, query, limit);
  console.log(
    `[executeSearch] Found ${searchResult.results?.length || 0} results`,
  );

  return searchResult;
}

/**
 * Get LLM's decision after receiving search results.
 * The LLM decides whether to:
 * 1. Return a final response with relevant materials
 * 2. Ask the user if they have materials to contribute
 */
async function getLlmDecisionAfterSearch(
  userMessage,
  conversationHistory,
  customInstructions,
  searchToolCall,
  searchResults,
) {
  const messages = buildMessages(
    userMessage,
    conversationHistory,
    customInstructions,
    {
      tool: searchToolCall.tool,
      args: searchToolCall.args,
      output: searchResults,
    },
  );
  const rawResponse = await callHfChat(messages);
  const parsed = parseLlmResponse(rawResponse);

  console.log("[getLlmDecisionAfterSearch] LLM response type:", parsed.type);

  return parsed;
}

/**
 * POST /chatbot/chat — main chatbot orchestration endpoint.
 * Orchestrates the conversation flow:
 * 1. User sends message → LLM returns response (search tool call or final response)
 * 2. If search tool call: backend executes search → LLM receives results
 * 3. LLM returns final response (with materials if found, or asking to contribute)
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

    // Step 1: Get initial LLM response
    let llmResponse = await getInitialLlmResponse(
      message,
      conversationHistory,
      customInstructions,
    );

    console.log("[chatbotChat] Initial response type:", llmResponse.type);

    // If initial response is final, use it directly
    if (llmResponse.type === "final") {
      const response = {
        message: llmResponse.message || "",
        relatedMaterials: llmResponse.relatedMaterials || [],
        suggestedActions: llmResponse.suggestedActions || [],
        conversationState: {
          sessionId: sessionId || `session_${Date.now()}`,
          lastUpdated: new Date().toISOString(),
        },
      };
      return res.json(response);
    }

    // If initial response is search tool call, execute it
    if (
      llmResponse.type === "tool_call" &&
      llmResponse.tool === "search_materials"
    ) {
      // Step 2: Execute search
      const searchResults = await executeSearch(llmResponse.args);

      // Step 3: Get LLM decision after receiving search results
      let decisionResponse = await getLlmDecisionAfterSearch(
        message,
        conversationHistory,
        customInstructions,
        llmResponse,
        searchResults,
      );

      // Step 4: Validate final response
      if (decisionResponse.type !== "final") {
        console.warn(
          "[chatbotChat] Expected final response, got:",
          decisionResponse.type,
        );
        decisionResponse = {
          type: "final",
          message:
            "I'm unable to complete that request right now. Please try a different query or ask for help.",
          relatedMaterials: [],
          suggestedActions: ["try_search_again", "contact_support"],
        };
      }

      llmResponse = decisionResponse;
    } else {
      // Unexpected response type
      console.warn("[chatbotChat] Unexpected response type:", llmResponse.type);
      llmResponse = {
        type: "final",
        message:
          "I encountered an unexpected issue while processing your request. Please try again.",
        relatedMaterials: [],
        suggestedActions: ["try_search_again"],
      };
    }

    // Build and return final response
    const response = {
      message: llmResponse.message || "",
      relatedMaterials: llmResponse.relatedMaterials || [],
      suggestedActions: llmResponse.suggestedActions || [],
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
