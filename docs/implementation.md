# Perk API — Implementation Tasks (WBP Chatbot)

This document contains backend implementation tasks for the WBP Chatbot feature in Perk API. For frontend tasks, see [wbp-chatbot/docs/implementation.md](../../wbp-chatbot/docs/implementation.md).

## Task 1: Implement `POST /chatbot/chat` endpoint

Build the LLM orchestration endpoint in `perk-api`.

**Request:** `{ message: string, sessionId?: string, conversationHistory?: array, customInstructions?: string, context?: object }`

**Response:** `{ message: string, relatedMaterials?: array, suggestedActions?: array, conversationState?: object }`

**Requirements:**

- Accept the request and construct a system prompt (define a canonical system template for the chatbot's role and behavior).
- Call a Hugging Face model via the Hugging Face Inference API (or a self-hosted transformer endpoint such as text-generation-inference) with the constructed prompt and conversation history.
- Parse the LLM's JSON response. The LLM will emit one of two response types:
  - `{ "type": "final", "message": "...", "relatedMaterials": [...], "suggestedActions": [...], "conversationState": {...} }` → return directly to user.
  - `{ "type": "tool_call", "tool": "search_materials"|"request_material_addition", "args": {...} }` → execute the tool (see Tasks 2 and 3), inject the result back to the LLM, and re-invoke the LLM for a final answer.
- Keep model API keys server-side (use environment variables, e.g. `HF_API_KEY`).
- Log tool calls and errors for debugging.

**Tests:**

- Test successful chat request with valid message.
- Test LLM returns final response (no tool call).
- Test LLM returns tool_call and orchestrator executes it correctly.
- Test tool result injection and second LLM invocation.
- Test invalid request (missing message field).
- Test error handling when HF API fails.
- Mock the HF client to avoid external API calls in tests.

**Status:** ✅ Complete (see `__tests__/chatbotChat.test.js`)

---

## Task 2: Implement `GET /chatbot/search` endpoint

Build the search endpoint that the orchestrator calls when the LLM requests a `search_materials` tool.

**Request:** `GET /chatbot/search?query=...&limit=...&page=...` (with optional encoded `filters`, `sort`)

**Response:** `{ results: [{ nodeId, name, type, pathLink, similarity, metadata?: {...} }], total?: number, facets?: {...} }`

**Requirements:**

- Execute a Neo4j similarity search over embeddings for the given query.
- Support optional `filters` (e.g., `minRating`, `maxTimeMinutes`, `nodeTypes`) as query parameters or via a POST helper for complex payloads.
- Return result nodes with similarity scores; include optional `metadata` (e.g., `averageTimeMinutes`, `rating`).
- Optionally return `facets` for future filtering UI (e.g., difficulty counts, tag counts).
- Use read-only DB credentials (see `SECURITY.md`).

**Tests:**

- Test search with valid query returns ranked results.
- Test search with filters (minRating, maxTimeMinutes, nodeTypes).
- Test search with limit and pagination.
- Test search with no embeddings returns empty results.
- Test invalid query (empty string) returns 400 error.
- Mock Neo4j driver and embedding pipeline.

---

## Task 3: Implement `POST /chatbot/request-material-addition` tool handler

Build the backend handler for when the LLM invokes `request_material_addition`.

**LLM invocation format:** `{ tool: "request_material_addition", args: { topic: string, user_context?: string, suggested_resources?: string[] } }`

**Response:** `{ requestId?: string, status: "queued"|"sent" }`

**Requirements:**

- Accept the tool arguments and format them into a material-addition request.
- Send the request to an admin channel (e.g., Discord webhook or a database queue).
- Return an acknowledgement with a request ID and status.
- Include the user context and suggested resources in the admin notification.

**Tests:**

- Test request creation with valid topic and context.
- Test request with suggested resources array.
- Test request ID generation is unique.
- Test Discord webhook call (or queue insertion).
- Test invalid request (missing topic) returns 400 error.
- Mock Discord webhook or queue.

---

## Task 4: Implement `GET /chatbot/find-path` endpoint

Build the path-finding endpoint that the **client** (not the LLM) calls when a user clicks a search result.

**Request:** `GET /chatbot/find-path?fromNodeId=...&toNodeId=...&sort=...` (with optional `filters`)

**Response:** `{ paths: [{ nodes: [{ nodeId, name, type, metadata? }], edges?: [...], totalSteps, totalEstimatedTimeMinutes?, averageRating?, rank?, preferred?, explanation? }] }`

**Requirements:**

- Accept `fromNodeId` and `toNodeId` (required).
- Support `sort` strategies: `shortest_hops`, `shortest_time`, `highest_rating`, `balanced`.
- Return multiple candidate paths ranked by the selected strategy.
- Include per-path metrics (`totalEstimatedTimeMinutes`, `averageRating`) and metadata (`rank`, `preferred`, `explanation`).
- Explain why each path was ranked (e.g., `"explanation": "shortest_time"` or `"explanation": "only_available_path"`).
- Use read-only DB credentials.

**Tests:**

- Test path finding with valid fromNodeId and toNodeId.
- Test each sort strategy (shortest_hops, shortest_time, highest_rating, balanced).
- Test multiple paths are returned and ranked correctly.
- Test path metrics (totalSteps, totalEstimatedTimeMinutes, averageRating).
- Test invalid nodeId returns 400 or 404 error.
- Test no path exists returns empty array or appropriate message.
- Mock Neo4j driver.

---

## Task 5: Implement `POST /progress/start-node` endpoint

Build the endpoint that the **client** calls to compute the user's most-advanced start node before calling `/chatbot/find-path`.

**Request:** `{ doneIds: string[], targetId?: string }`

**Response:** `{ terminals: string[], startNodeId?: string }`

**Requirements:**

- Compute terminal completed skills (skills with no outgoing prerequisites to other completed skills).
- If `targetId` is provided, prefer the terminal closest (shortest path) to the target.
- Fall back to ranking by descendant reachability (how advanced the terminal is) if multiple terminals exist.
- Return the list of terminals and a recommended `startNodeId`.
- Use read-only DB credentials.

**Tests:**

- Test terminal computation with valid doneIds.
- Test target-aware selection (closest terminal to target).
- Test descendant-count fallback when no target provided.
- Test empty doneIds returns empty terminals.
- Test invalid doneIds (non-array) returns 400 error.
- Mock Neo4j driver.

---

## Task 6: Implement admin ingestion flow (backend)

Allow admins to submit URLs and get proposed Cypher recommendations.

**Requirements:**

- When an admin provides a URL, call the LLM with instructions to analyze it and produce:
  - `{ objectiveSkills: [...], prerequisiteSkills: [...], proposedCypher: "...", notes: "..." }`
- Return the proposed Cypher for review (never auto-execute).
- Filter recommended prerequisites so no recommended prerequisite is itself a prerequisite of another (terminal prerequisites only).
- Optionally provide an admin-only endpoint to execute reviewed Cypher.

**Tests:**

- Test LLM analyzes URL and returns structured proposal.
- Test proposedCypher contains valid Cypher syntax.
- Test prerequisite filtering (only terminal prerequisites).
- Test invalid URL returns error.
- Test Cypher is never auto-executed (security test).
- Mock LLM API.

---

## Task 7: Add error handling and fallbacks (backend)

**Requirements:**

- If a tool call fails, emit a friendly error message from the LLM ("I encountered an issue searching for materials. Please try again or rephrase your question.").
- Log all errors and timeouts for monitoring.
- Return appropriate HTTP status codes (400 for validation, 500 for server errors, 503 for service unavailable).

**Tests:**

- Test tool call failure triggers friendly LLM error message.
- Test network timeout is handled gracefully.
- Test error logging captures stack traces.
- Test user sees appropriate error messages (not raw exceptions).
- Mock various failure scenarios (API timeout, network error, invalid response).

---

## Notes

- All LLM API keys and DB credentials must remain server-side.
- Use read-only DB accounts for all chat/search/find-path queries (see `SECURITY.md`).
- The LLM should only invoke `search_materials` and `request_material_addition` tools; it does NOT call `find-path` or `start-node` (those are client-initiated).
- See `SECURITY.md` for database security guidelines.
- Frontend implementation tasks are in the wbp-chatbot repository.
