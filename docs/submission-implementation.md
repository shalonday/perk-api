# Submission Handler — Implementation Plan

This document breaks down the implementation of the submission handler into sequential phases. Each phase builds on the previous one and includes specific files to create, dependencies, and ordered step-by-step tasks.

---

## Project Structure

```
services/
  submission/
    urlFetcher.ts          # Puppeteer wrapper for content extraction
    urlValidator.ts        # URL safety validation (whitelist + hybrid)
    submissionHandler.ts   # Main orchestrator (Steps 1-6)
    discordNotifier.ts     # Discord webhook integration
    submissionLogger.ts    # Structured logging
    types.ts               # TypeScript interfaces for submission
__tests__/
  submission/
    urlValidator.test.ts
    urlFetcher.test.ts
    submissionHandler.test.ts
    discordNotifier.test.ts
```

---

## Phase 1: URL Infrastructure (Foundation)

**Goal:** Build the utilities needed to safely fetch and validate URLs.

**Files to Create:**

- `services/submission/urlValidator.ts` — URL safety checks (whitelist + hybrid)
- `services/submission/urlFetcher.ts` — Puppeteer wrapper for content extraction
- `services/submission/types.ts` — Shared TypeScript interfaces

### Step 1.1: Create URL Validator Utility

**What the implementation needs:**

1. **Domain Whitelist:**
   - Create a hardcoded list of trusted educational domains (github.com, stackoverflow.com, developer.mozilla.org, etc.)
   - Add environment variable override for custom whitelist

2. **URL Format Validation:**
   - Validate URL structure (protocol, domain, path)
   - Reject malformed URLs early

3. **Hybrid Safety Check:**
   - Fast-path: Check against whitelist (instant).
   - Slow-path: Query external safety API (Google Safe Browsing or similar) if not on whitelist.
   - Cache results for 24 hours to avoid repeated API calls.

4. **Error Handling:**
   - Return structured error object: `{ safe: boolean, reason?: string }`
   - Log rejections without exposing details to user.

**Interface:**

```typescript
validateUrlSafety(url: string): Promise<{ safe: boolean, reason?: string }>
```

### Step 1.2: Create URL Fetcher (Puppeteer Wrapper)

**What the implementation needs:**

1. **Browser Instance Management:**
   - Lazy-initialize Puppeteer browser on first use.
   - Reuse across multiple URL fetches.
   - Graceful shutdown on application exit.

2. **Content Extraction:**
   - Navigate to URL with 15-second timeout.
   - Extract title, meta description, H1/H2 headings.
   - Extract readable body text (strip scripts, styles).
   - Limit text output to 5000 characters.
   - Return structured object: `{ title, description, text }`

3. **Error Handling:**
   - Timeout → log and return partial data (metadata only).
   - 404/403 → return null.
   - JavaScript errors → log and retry once.

**Interface:**

```typescript
fetchUrlContent(url: string): Promise<{ title: string, description: string, text: string }>
```

### Step 1.3: Create Submission Types

**What the implementation needs:**

- `MaterialSubmission` interface (from requirements doc).
- `SubmissionRequest` interface (incoming request).
- `SubmissionResponse` interface (response to user).
- `UriFetchResult`, `UrlValidationResult` helper types.

---

## Phase 2: Submission Handler Core (Message Classification & Orchestration)

**Goal:** Integrate with `/chatbot/chat` to classify messages and route to submission handler.

**Files to Create/Modify:**

- `services/submission/submissionHandler.ts` — Main orchestrator
- `services/service.js` — Update `/chatbot/chat` endpoint to classify messages

### Step 2.1: Message Classification in `/chatbot/chat`

**What the implementation needs:**

1. **LLM Classification:**
   - Add to the system prompt: instruction for LLM to detect submission intent.
   - LLM returns: `{"type":"tool_call","tool":"submit_materials",...}` if submission detected.
   - LLM returns: `{"type":"tool_call","tool":"search_materials",...}` or `{"type":"final",...}` otherwise.

2. **URL Extraction:**
   - Extract URLs from user message (regex or URL parser).
   - If URLs found and LLM signals submission, pass to submission handler.

3. **Response to User:**
   - If submission: "Thank you for submitting these materials. I'm analyzing them..."
   - If not submission: Normal chatbot flow (search or final response).

**Integration Point:**

```javascript
// In service.js /chatbot/chat endpoint:
if (lmmResponse.tool === "submit_materials") {
  const result = await submissionHandler(lmmResponse.args);
  return result; // type: "submission"
}
```

### Step 2.2: Create Submission Handler Orchestrator

**What the implementation needs:**

The orchestrator executes Steps 1-6 from the requirements doc in sequence:

1. **Step 1: Validate Input**
   - Check `urls` array non-empty, valid format, count ≤ 10.
   - Verify `sessionId` exists.
   - Return 400 if validation fails.

2. **Step 2: URL Safety Checks**
   - Run `urlValidator` on each URL.
   - If any fails, return 400 to user.

3. **Step 3: Fetch & Analyze**
   - Call `urlFetcher` for each URL to get content.
   - Extract keywords from content.
   - Query existing graph via `search_materials` (Step 3a).
   - Format `existingNodes` for LLM prompt.
   - Call LLM with graph-aware prompt (Step 3b).
   - Parse LLM response and validate JSON.

4. **Step 4: Format Notification**
   - Build Discord embed payload with submission details.

5. **Step 5: Send to Discord**
   - Call Discord webhook.
   - Capture message URL and thread ID.

6. **Step 6: Log Submission**
   - Structured logging (JSON) with submission ID, URLs, LLM response.

**Function Signature:**

```typescript
async function submitMaterials(
  urls: string[],
  userContext: string,
  sessionId: string,
): Promise<SubmissionResponse>;
```

---

## Phase 3: Graph Integration & LLM Analysis

**Goal:** Query existing graph and analyze materials with LLM.

**Files to Create/Modify:**

- `services/submission/submissionHandler.ts` — Integrate graph queries and LLM calls

### Step 3.1: Query Existing Graph (Step 3a)

**What the implementation needs:**

1. **Keyword Extraction:**
   - From fetched URL content, extract key terms (title, nouns, entities).
   - Use simple NLP or regex-based extraction.

2. **Search Materials:**
   - For each keyword, call existing `search_materials` tool/endpoint.
   - Collect results: existing skill nodes, URL nodes, relationships.
   - Format results as readable text for LLM: "Existing Skill: JavaScript Fundamentals (4 prerequisites, teaches 8 skills)"

3. **Duplicate Detection (Early):**
   - If search finds a URL with exact same or very similar content, flag as potential duplicate for admin.
   - Include warning in response to user.

### Step 3.2: LLM Analysis with Graph Context (Step 3b)

**What the implementation needs:**

1. **Prompt Construction:**
   - Use template from requirements doc.
   - Substitute `{existingNodes}` with results from Step 3a.
   - Include fetched URL content (title, description, text).

2. **LLM API Call:**
   - Call HuggingFace LLM with system + user prompt.
   - Set timeout: 60 seconds per URL, or 120 seconds batch.
   - Handle timeout gracefully (log and mark for admin review).

3. **Response Parsing:**
   - LLM returns JSON with materials array.
   - Validate JSON structure.
   - Extract: objective skills, prerequisite skills, title, description, estimated time.
   - Verify skill naming consistency across submitted materials.

4. **Skill Name Alignment:**
   - If a skill matches existing node, replace with exact node name.
   - Log replacements for transparency.

---

## Phase 4: Discord Integration & Admin Workflow

**Goal:** Post to Discord and set up admin approval flow.

**Files to Create:**

- `services/submission/discordNotifier.ts` — Webhook integration

### Step 4.1: Discord Webhook Setup

**What the implementation needs:**

1. **Environment Configuration:**
   - Read `DISCORD_WEBHOOK_URL` from environment.
   - Validate webhook URL on startup.
   - Retry logic for failed webhook calls (2 retries, exponential backoff).

2. **Message Formatting:**
   - Create Discord embed with:
     - Submission ID
     - User context
     - List of materials (URL, title, objective skills, prerequisite skills, estimated time)
     - Admin action items
   - Include reaction buttons (✅ Approve, ❌ Reject, 🔄 Needs Review).

3. **Webhook Call:**
   - POST to webhook URL.
   - Capture response: message ID, thread ID, timestamp.
   - Return message URL to client.

**Interface:**

```typescript
postToDiscord(payload: DiscordPayload): Promise<{ messageUrl: string, threadId?: string }>
```

### Step 4.2: Admin Approval Workflow

**What the implementation needs:**

1. **Reaction Listening (Future/Optional for MVP):**
   - Set up Discord bot to listen for reactions on submission messages.
   - On ✅ reaction: mark submission as `approved`, update Discord thread with confirmation.
   - On ❌ reaction: mark as `rejected`, prompt admin for reason in thread.

2. **Discord Thread Integration:**
   - Each submission is a message in `#material-submissions`.
   - Admins reply in the thread to discuss.
   - Bot posts status updates to the thread as admins take action.

3. **User Notification (Phase 5):**
   - Once admin approves/rejects, update session context or send chat message to user.

---

## Phase 5: Logging & Persistence

**Goal:** Track all submissions for audit and debugging.

**Files to Create/Modify:**

- `services/submission/submissionLogger.ts` — Structured logging
- Database schema (if needed) for materialized submission records

### Step 5.1: Submission Logging

**What the implementation needs:**

1. **Structured Logging:**
   - Log each submission with:
     - Submission ID (UUID)
     - Session ID
     - Timestamp
     - URLs submitted
     - User context
     - LLM response (full JSON)
     - Discord message ID
     - Status (pending, approved, rejected, etc.)
     - Any errors/warnings

2. **Log Storage:**
   - Write to JSON log files or structured logging service (e.g., Winston).
   - Include query filters: by session ID, submission ID, date range.
   - Sanitize logs: remove PII from user context before logging.

### Step 5.2: Submission Storage (Session/Database)

**What the implementation needs:**

1. **Session Context:**
   - Store submission details in session object.
   - Track: submission ID, Discord message URL, admin status, Discord thread ID.
   - Enable users to reference their submission in subsequent chat messages.

2. **Database (Optional):**
   - If project uses a database, create `submissions` table:
     - Columns: submissionId, sessionId, timestamp, userContext, materials (JSON), discordMessageId, discordThreadId, adminStatus, adminNotes, createdAt, updatedAt.
   - Index on: submissionId, sessionId, timestamp for quick queries.

---

## Phase 6: Testing & Refinement

**Goal:** Ensure correctness and handle edge cases.

### Unit Tests

**Files to Create:**

- `__tests__/submission/urlValidator.test.ts` — Test whitelist matching, hybrid validation, error cases.
- `__tests__/submission/urlFetcher.test.ts` — Test content extraction, timeout handling, malformed HTML.
- `__tests__/submission/submissionHandler.test.ts` — Test input validation, error handling, mock LLM responses.
- `__tests__/submission/discordNotifier.test.ts` — Test webhook calls, retry logic, payload formatting.

**What to test:**

1. **URL Validation:**
   - Valid URLs on whitelist pass.
   - Invalid URLs fail with correct error.
   - URLs not on whitelist trigger hybrid check.
   - Cached results prevent repeated API calls.

2. **URL Fetching:**
   - Content extracted and truncated to 5000 chars.
   - Timeout returns partial data (metadata).
   - Error pages return null gracefully.

3. **Submission Handler:**
   - Input validation catches empty/invalid submissions.
   - URL safety stops invalid submissions.
   - LLM response parsed correctly.
   - Skill consistency enforced across materials.
   - Errors return correct HTTP status and user-friendly message.

4. **Discord Integration:**
   - Webhook called with correct payload.
   - Message URL captured and returned.
   - Failed webhook triggers retry.
   - After 2 retries, returns 500 to user with fallback message.

### Integration Tests

**What to test:**

1. **End-to-End Submission Flow:**
   - User message classified as submission.
   - URLs validated, fetched, analyzed.
   - Discord message posted.
   - User receives response with Discord link.

2. **Regular Chat Flow:**
   - User message classified as chat (not submission).
   - Proceeds with normal search flow.
   - Does not trigger submission handler.

3. **Error Scenarios:**
   - URL fetch fails → partial analysis, flag for admin.
   - LLM timeout → 503 to user, submission sent to Discord for manual review.
   - Discord webhook fails after retries → 500 to user, ops alerted.

---

## Phase 7: Deployment & Iteration

**Goal:** Deploy to production and refine based on usage.

### Step 7.1: Environment Configuration

**What the implementation needs:**

1. **Environment Variables:**
   - `DISCORD_WEBHOOK_URL` — Discord webhook for material submissions.
   - `HUGGINGFACE_API_KEY` — LLM API key.
   - `PUPPETEER_TIMEOUT` — Page load timeout (default 15s).
   - `SUBMISSION_RATE_LIMIT` — Submissions per hour per session (default 5).
   - `LOG_LEVEL` — Logging verbosity (debug, info, warn, error).

2. **Error Monitoring:**
   - Set up sentry or similar for exception tracking.
   - Alert admins on persistent Discord webhook failures.
   - Track LLM timeout frequency and adjust timeout threshold.

### Step 7.2: Monitoring & Iteration

**What to monitor:**

1. **Submission Volume:**
   - Total submissions per day/week.
   - Average URL count per submission.
   - Approval vs. rejection rates.

2. **Performance:**
   - Average LLM analysis time per submission.
   - Discord webhook latency.
   - URL fetch success rate.

3. **User Feedback:**
   - Is the Discord link clear to users?
   - Are admins able to approve efficiently?
   - Are any submissions failing validation repeatedly?

---

## Implementation Order (Sequential)

1. **Phase 1** — Build URL utilities (validator, fetcher).
2. **Phase 2** — Integrate with `/chatbot/chat`, create submissionHandler orchestrator.
3. **Phase 3** — Add graph queries and LLM analysis.
4. **Phase 4** — Connect Discord webhook and notification formatting.
5. **Phase 5** — Add logging and submission persistence.
6. **Phase 6** — Write comprehensive tests.
7. **Phase 7** — Deploy and monitor.

---

## Key Dependencies

- **Puppeteer** — Headless browser for content extraction.
- **HuggingFace API** — LLM for skill analysis.
- **Discord.js** or HTTP client — Webhook integration.
- **Winston or Pino** — Structured logging.
- **Jest or Vitest** — Testing framework.
- **Neo4j Driver** — For `search_materials` calls (already in project).

---

## Success Metrics

- ✅ All phases completed and tested.
- ✅ End-to-end submission flow works from chat to Discord.
- ✅ Submissions logged and retrievable by ID/session.
- ✅ Admin approval workflow functional (reactions/threads).
- ✅ Error handling covers all documented scenarios.
- ✅ Performance: submission processed in <30 seconds (URL fetch + LLM analysis).
- ✅ Zero data loss: all submissions logged even if Discord fails.
