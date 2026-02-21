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

const SYSTEM_PROMPT = `You are a helpful learning assistant for the Web Brain Project.
Your goal is to help users discover learning materials and learning paths.

IMPORTANT: You do NOT have access to any function-calling or tool-calling capabilities.
You MUST respond ONLY with JSON objects.
Do NOT attempt to use any native function calls, tool_use tags, or function_calls - they will not work.

When the user asks about a topic, return a JSON object starting a tool_call to search for relevant materials.
When search results are too irrelevant, return a JSON object to request material addition.

CRITICAL RULES:
- NEVER make up or hallucinate node IDs, material names, or resources.
- ONLY include relatedMaterials from the search_materials results.
- If search results don't match the user's needs, inform the user, saying "Materials regarding [X topic] are not available yet..." then call request_material_addition—do NOT invent materials.
- Always verify node IDs exist in search results before including them in your response.
- If you call request_material_addition, don't tell the user to "wait a moment" or any variation thereof, as this addition can take a long time. You may tell them to check the Discord server (https://discord.gg/xhshtzc5) for updates.

RESPONSE FORMAT - CRITICAL:
You MUST respond with EXACTLY ONE valid JSON object per response. NEVER concatenate multiple JSON objects.
After you return a tool_call JSON object, the system will execute the tool and invoke you again with the results.
Do NOT try to use native function calls, tool_use, or any provider-specific tool-calling format.
Do NOT return anything other than valid JSON - no markdown, no explanations, no extra text.

EXAMPLE FLOW:
(Note: IDs like "abc-123", "xyz-789" below are placeholder examples only - NOT real database data. Always use actual IDs from search results.)

User: "I want to learn React"
Your response: {"type":"tool_call","tool":"search_materials","args":{"query":"React","limit":5}}
[System executes search and calls you again with results]

Tool result: {"results":[{"node":{"name":"learn React basics","id":"abc-123","type":"Skill"},"similarity":0.95}]}
Your response: {"type":"final","message":"I found materials about React! Here are some resources to get started.","relatedMaterials":[{"nodeId":"abc-123","name":"learn React basics","type":"skill"}],"suggestedActions":[]}

User: "I want to learn machine learning"
Your response: {"type":"tool_call","tool":"search_materials","args":{"query":"machine learning","limit":5}}
[System executes search and calls you again with results]

Tool result: {"results":[{"node":{"name":"how the web works","id":"xyz-789","type":"Skill"},"similarity":0.24}]}
Your response: {"type":"tool_call","tool":"request_material_addition","args":{"topic":"machine learning","user_context":"User wants to learn machine learning"}}
[System executes request and calls you again with confirmation]

Tool result: {"requestId":"req_123","status":"queued"}
Your response: {"type":"final","message":"Materials regarding machine learning are not available yet. I've requested the addition of new learning resources on this topic. Please check the Discord server (https://discord.gg/xhshtzc5) for updates, and I'll help you once the materials are ready.","relatedMaterials":[],"suggestedActions":[]}

Notice: Each response is ONE JSON object. Never combine tool_call and final in the same response.

Valid response formats (return ONE):

1. Final response (when you have an answer for the user):
{"type":"final","message":"<your response>","relatedMaterials":[{"nodeId":"...","name":"...","type":"skill|url"}],"suggestedActions":["action1","action2"]}

2. Tool call (when you need to search or request materials):
{"type":"tool_call","tool":"search_materials","args":{"query":"<search query>","limit":5}}
or
{"type":"tool_call","tool":"request_material_addition","args":{"topic":"<topic>","user_context":"<context>"}}

Return ONLY ONE valid JSON object. No markdown formatting, no extra text, no concatenation.`;

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
 * The LLM returns a JSON string with instructions for the backend to execute.
 * The response always has one of two structures:
 *
 * **Tool call** - When the LLM decides the backend should execute a tool:
 * - `type` (string): Always "tool_call"
 * - `tool` (string): Either "search_materials" or "request_material_addition"
 * - `args` (object): Parameters for the tool (e.g., {query, limit} or {topic, user_context})
 *
 * **Final response** - When the LLM has an answer for the user:
 * - `type` (string): Always "final"
 * - `message` (string): The response text to display to the user
 * - `relatedMaterials` (array): List of material objects with {nodeId, name, type}
 * - `suggestedActions` (array): List of suggested action strings
 *
 * @param {Array} messages - Message array in OpenAI format ({role, content}[])
 * @returns {Promise<string>} Raw JSON string from the LLM
 */
async function callHfChat(messages) {
  const client = getHfClient();
  const model = process.env.HF_MODEL || "openai/gpt-oss-120b";

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
    const message = response.choices[0].message;
    // Handle models with reasoning: if content is empty but reasoning exists, use reasoning
    const content = message.content || message.reasoning || "";
    return content;
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
    console.log("[parseLlmResponse] Cleaned LLM response:", cleaned);
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    console.log(
      "[parseLlmResponse] Extracted JSON string:",
      jsonMatch ? jsonMatch[0] : "none",
    );
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(cleaned);
  } catch (error) {
    console.error(
      "[parseLlmResponse] CRITICAL ERROR: Failed to parse LLM response as JSON:",
      raw,
    );
    console.error("[parseLlmResponse] Parse error details:", error);
    // Return an error response informing the user
    return {
      type: "final",
      message:
        "I apologize, but I encountered an error processing your request. The administrators have been notified and will investigate this issue. Please try again later or contact support if the problem persists.",
      relatedMaterials: [],
      suggestedActions: ["try_again", "contact_support"],
    };
  }
}

module.exports = {
  buildMessages,
  callHfChat,
  parseLlmResponse,
};
