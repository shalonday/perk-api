const neo4j = require("neo4j-driver");
const { InferenceClient } = require("@huggingface/inference");
require("dotenv").config();

// Hugging Face client (initialized lazily)
let hf = null;
function getHfClient() {
  if (!hf) {
    hf = new InferenceClient(process.env.HF_API_KEY);
  }
  return hf;
}

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

async function mergeTree(req, res, next) {
  const session = driver.session();
  const tree = req.body;
  const nodesArray = tree.nodes;
  const linksArray = tree.links;
  const query = buildMergeQuery(nodesArray, linksArray);

  const { summary } = await session.executeWrite((tx) => {
    return tx.run(query);
  });
  console.log("Finished transaction: " + summary.counters._stats);
  res.json(summary.counters._stats);
  session.close();
  console.log("session closed");
}

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

  let prereqLinks = getPrerequisiteLinksTransaction.records.map((record) => {
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

  let teachesLinks = getTeachesLinksTransaction.records.map((record) => {
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

// Since I do not save source and target UUIDs into the relationships in the tree (for some reason I forgot)
// I need to find the corresponding source and target uuid's for each relationship using their neo4j internal
// "start" and "end" properties and comparing that with the neo4j internal "identity" properties of the nodes
// and grabbing the matching node's id property corresponding to the UUID that I specified.
function getD3CompatibleLink(link, nodesWithInternalData) {
  const startNodeInternalId = link.start.toString();
  const endNodeInternalId = link.end.toString();
  let mySourceUuid; // the corresponding source node's uuid which was set by me.
  let myTargetUuid;

  // iterate through the nodes to find the source and target
  nodesWithInternalData.forEach((node) => {
    if (node.identity.toString() === startNodeInternalId) {
      mySourceUuid = node.properties.id;
    }
    if (node.identity.toString() === endNodeInternalId) {
      myTargetUuid = node.properties.id;
    }
  });

  const rel = {
    id: link.properties.id,
    source: mySourceUuid,
    target: myTargetUuid,
  };
  return rel;
}

// Build a neo4j query from the nodes and links
function buildMergeQuery(nodesArray, linksArray) {
  let query = "";

  if (linksArray.length > 0) {
    // For each link, build query merging a (source)-[link]->(target) record to the neo4j database.
    // The indeces i,j are important to make the variables unique throughout the whole query.
    linksArray.forEach((link, i) => {
      const sourceNode = nodesArray.filter(
        (node) => node.id === link.source,
      )[0];
      const targetNode = nodesArray.filter(
        (node) => node.id === link.target,
      )[0];
      if (sourceNode.type === "skill" && targetNode.type === "module") {
        query += buildQueryForSkillToModuleAndModuleToResourceRelationships(
          sourceNode,
          link.id,
          targetNode,
          i,
        );
      } else if (sourceNode.type === "module" && targetNode.type === "skill") {
        query += buildQueryForModuleToSkillRelationships(
          sourceNode,
          link.id,
          targetNode,
          i,
        );
      }
    });
  } else {
    // only nodes were submitted to be merged; probably updates
    nodesArray.forEach((node, i) => {
      query += buildQueryForDisconnectedNode(node, i);
    });
  }

  return query;
}

function buildQueryForSkillToModuleAndModuleToResourceRelationships(
  sourceSkillNode,
  linkId,
  targetModuleNode,
  index,
) {
  let querySegment = "";
  const { resourcesArray, ...restOfModuleNode } = targetModuleNode;
  // MERGE Skill Node and Module node to store them into variables.
  // MERGE Skill -IS_PREREQUISITE_TO-> Module records
  querySegment += `MERGE (ss${index}:Skill {${convertToPropertiesString(
    sourceSkillNode,
  )}}) MERGE (tm${index}:Module {${convertToPropertiesString(
    restOfModuleNode,
  )}}) MERGE (ss${index})-[:IS_PREREQUISITE_TO {id: "${linkId}"}]->(tm${index}) `; //ss for source-skill, and tm for target-module

  // MERGE Resource Nodes to get their variables
  // MERGE Module -REFERENCES-> Resource records
  // That I put this in the same query builder function as the Skill-->Module relationships instead of the other one
  // doesn't matter; I just needed some reference to the modules.
  if (targetModuleNode.resourcesArray) {
    targetModuleNode.resourcesArray.forEach((resource, j) => {
      querySegment += `MERGE (r${index}_${j}:Resource {${convertToPropertiesString(
        resource,
      )}}) MERGE (tm${index})-[:REFERENCES]->(r${index}_${j}) `;
    });
  }

  return querySegment;
}

function buildQueryForModuleToSkillRelationships(
  sourceModuleNode,
  linkId,
  targetSkillNode,
  index,
) {
  let querySegment = "";
  const { resourcesArray, ...restOfModuleNode } = sourceModuleNode;
  // MERGE Module and Skill nodes to store them into variables
  // MERGE Module -[:TEACHES]-> Skill records
  querySegment += `MERGE (sm${index}:Module {${convertToPropertiesString(
    restOfModuleNode,
  )}}) MERGE (ts${index}:Skill {${convertToPropertiesString(
    targetSkillNode,
  )}}) MERGE (sm${index})-[:TEACHES {id: "${linkId}"}]->(ts${index}) `;

  return querySegment;
}

function buildQueryForDisconnectedNode(node, index) {
  let querySegment = "";
  if (node.type === "skill")
    querySegment += `MERGE (:Skill {${convertToPropertiesString(node)}}) `;
  else if (node.type === "module") {
    // merge Module node and its associated Resource nodes
    querySegment += `MERGE (m${index}:Module {${convertToPropertiesString(
      node,
    )}}) `;

    node.resourcesArray?.forEach((resource, j) => {
      querySegment += `MERGE (r${index}_${j}:Resource {${convertToPropertiesString(
        resource,
      )}}) MERGE (m${index})-[:REFERENCES]->(r${index}_${j}) `;
    });
  }

  return querySegment;
}

// Object -> String
// Rewrite the object as a string without appending quotation marks on property names, but
// with marks on the property values. This makes the string acceptable as a properties object
// on a neo4j query.
function convertToPropertiesString(object) {
  const string = Object.keys(object).map(
    (key) => key + ": " + JSON.stringify(object[key]),
  );
  return string;
}

// ModulesArray, Transaction -> ModulesArray
// Using the transaction that relates resources with the modules they belong in, populate the
// resourcesArray of each module.
function populateModulesWithResources(modules, relationshipTransaction) {
  modules.forEach((module) => (module.resourcesArray = []));
  // I don't remember why I put this above line but this works because I end up saving filled up resourcesArray as a property of
  // Module objects, when these Resources are also converted to nodes. We basically have copies of resources as nodes
  // and as properties. But in this function we reset the resourcesArray property to an empty array first, so that the
  // push doesn't end up doubling the contents.
  relationshipTransaction.records.forEach((record) => {
    let matchedModule = modules.filter(
      (module) => module.id && module.id === record.get("m").properties.id,
    )[0];

    if (matchedModule)
      matchedModule.resourcesArray.push(record.get("r").properties);
  });
}

function buildQueryForMatchingNodesById(array) {
  let queryString = "";
  let returnString = "RETURN";

  for (let i = 0; i < array.length; i++) {
    queryString += `MATCH (n_${i} {id: "${array[i]}"}) `;
    if (i < array.length - 1) returnString += ` n_${i},`;
    else returnString += ` n_${i}`;
  }

  queryString += returnString;
  console.log(queryString);
  return queryString;
}

async function chatbotSearch(req, res) {
  try {
    const { query, limit = 5 } = req.body;

    if (!query || typeof query !== "string") {
      return res.status(400).json({
        error: "Query is required and must be a string",
      });
    }

    const session = driver.session();

    // Fetch all nodes with embeddings and compute similarity using dot product
    // Cypher's dot_product is not available in all versions, so we compute similarity client-side
    const result = await session.executeRead((tx) => {
      return tx.run(
        `
        MATCH (n:Skill|URL)
        WHERE n.embedding IS NOT NULL
        RETURN {
          id: n.id,
          name: n.name,
          type: labels(n)[0]
        } as node,
        n.embedding as embedding
        `,
      );
    });

    session.close();

    // If we have no results, return empty
    if (result.records.length === 0) {
      return res.json({
        results: [],
        query,
        timestamp: new Date().toISOString(),
        note: "No embeddings found. Run 'npm run generate-embeddings' to populate embeddings.",
      });
    }

    // Import the embedding generator to get query embedding
    const { pipeline } = require("@xenova/transformers");
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

    res.json({
      results: scored,
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

// -------------------------------------------------------------------
// chatbotChat — LLM orchestration endpoint (Task 1)
// -------------------------------------------------------------------
const SYSTEM_PROMPT = `You are a helpful learning assistant for the Web Brain Project.
Your goal is to help users discover learning materials and learning paths.

When the user asks about a topic, you should search for relevant materials using the search_materials tool.
When no relevant materials exist, you can request new materials to be added using request_material_addition.

You MUST respond with valid JSON in one of these formats:

1. Final response (when you have an answer for the user):
{"type":"final","message":"<your response>","relatedMaterials":[{"nodeId":"...","name":"...","type":"skill|url"}],"suggestedActions":["action1","action2"]}

2. Tool call (when you need to search or request materials):
{"type":"tool_call","tool":"search_materials","args":{"query":"<search query>","limit":5}}
or
{"type":"tool_call","tool":"request_material_addition","args":{"topic":"<topic>","user_context":"<context>"}}

Always respond with valid JSON only. No markdown, no extra text.`;

/**
 * Build the messages array for the HF chat completion.
 */
function buildMessages(
  userMessage,
  conversationHistory,
  customInstructions,
  toolResult,
) {
  const messages = [{ role: "system", content: SYSTEM_PROMPT }];

  if (customInstructions) {
    messages.push({
      role: "system",
      content: `Additional instructions: ${customInstructions}`,
    });
  }

  // Add conversation history
  if (Array.isArray(conversationHistory)) {
    for (const msg of conversationHistory) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  // Add current user message
  messages.push({ role: "user", content: userMessage });

  // If we have a tool result to inject, add it
  if (toolResult) {
    messages.push({
      role: "assistant",
      content: JSON.stringify({
        type: "tool_call",
        tool: toolResult.tool,
        args: toolResult.args,
      }),
    });
    messages.push({
      role: "user",
      content: `Tool result for ${toolResult.tool}: ${JSON.stringify(toolResult.output)}`,
    });
  }

  return messages;
}

/**
 * Call the HF inference API for chat completion.
 */
async function callHfChat(messages) {
  const client = getHfClient();
  const model = process.env.HF_MODEL || "mistralai/Mistral-7B-Instruct-v0.3";

  console.log("[callHfChat] Calling HF API with model:", model);
  console.log("[callHfChat] Messages:", JSON.stringify(messages, null, 2));

  try {
    const response = await client.chatCompletion({
      model,
      messages,
      max_tokens: 1024,
      temperature: 0.7,
    });

    console.log(
      "[callHfChat] Success! Response:",
      JSON.stringify(response, null, 2),
    );
    return response.choices[0].message.content;
  } catch (error) {
    console.error("[callHfChat] HF API Error:", {
      message: error.message,
      status: error.status,
      statusCode: error.statusCode,
      body: error.body,
      data: error.data,
      fullError: JSON.stringify(error, null, 2),
    });
    throw error;
  }
}

/**
 * Parse the LLM response as JSON, with fallback handling.
 */
function parseLlmResponse(raw) {
  try {
    // Try to extract JSON from the response (in case of markdown wrapping)
    const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(cleaned);
  } catch {
    // If parsing fails, treat as a final message
    return {
      type: "final",
      message: raw,
      relatedMaterials: [],
      suggestedActions: [],
    };
  }
}

/**
 * Execute a tool call internally (calls chatbotSearch or chatbotMaterialRequest logic).
 */
async function executeTool(tool, args, driver) {
  if (tool === "search_materials") {
    // Reuse the search logic from chatbotSearch
    const { query, limit = 5 } = args;
    const session = driver.session();

    try {
      const result = await session.executeRead((tx) => {
        return tx.run(
          `
          MATCH (n:Skill|URL)
          WHERE n.embedding IS NOT NULL
          RETURN {
            id: n.id,
            name: n.name,
            type: labels(n)[0]
          } as node,
          n.embedding as embedding
          `,
        );
      });

      if (result.records.length === 0) {
        return { results: [], note: "No embeddings found" };
      }

      // Generate query embedding
      const { pipeline } = require("@xenova/transformers");
      const extractor = await pipeline(
        "feature-extraction",
        "Xenova/all-MiniLM-L6-v2",
      );
      const queryEmbeddingResult = await extractor(query, {
        pooling: "mean",
        normalize: true,
      });
      const queryEmbedding = Array.from(queryEmbeddingResult.data);

      // Compute similarity
      const scored = result.records
        .map((record) => {
          const nodeEmbedding = record.get("embedding");
          const similarity = nodeEmbedding.reduce(
            (sum, val, idx) => sum + val * queryEmbedding[idx],
            0,
          );
          return { node: record.get("node"), similarity };
        })
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);

      return { results: scored };
    } finally {
      session.close();
    }
  } else if (tool === "request_material_addition") {
    // Queue the request (simplified: just acknowledge)
    const requestId = `req_${Date.now()}`;
    console.log(`[Material Request] ${requestId}:`, args);
    return { requestId, status: "queued" };
  }

  return { error: `Unknown tool: ${tool}` };
}

/**
 * POST /chatbot/chat — main orchestration endpoint
 */
async function chatbotChat(req, res) {
  try {
    const {
      message,
      sessionId,
      conversationHistory,
      customInstructions,
      context,
    } = req.body;

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
  mergeTree,
  readUniversalTree,
  readPath,
  chatbotSearch,
  chatbotMaterialRequest,
  chatbotChat,
};
