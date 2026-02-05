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

module.exports = {
  buildMessages,
  callHfChat,
  parseLlmResponse,
};
