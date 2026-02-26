# Submission Handler — Requirements Doc

## Overview

The submission handler processes learning materials (URLs) submitted by users during chatbot conversations. It validates URLs for safety, analyzes content to extract prerequisite and objective skills using an LLM, and routes structured material proposals to Discord for admin review.

---

## Core Flow

### 1. Entry Point: Message Classification in `/chatbot/chat`

**Requirement:** The `/chatbot/chat` endpoint must determine whether an incoming user message is a material submission or regular chat.

**Logic:**

- The LLM (via system prompt or dedicated classification step) analyzes the message.
- If the message contains one or more URLs **and** the user's intent is to submit these as learning resources (not just referencing materials in conversation), classify as **material submission**.
- If classified as submission, invoke the submission handler.
- If classified as regular chat, proceed with normal chatbot flow.

**Example Heuristics (for LLM classification):**

- User explicitly mentions "I want to submit..." or "Here are materials..."
- User responds affirmatively after being asked "Do you have materials you'd like to submit?"
- Message contains one or more URLs with minimal additional conversational context.

**Response to User:**

- If submission: "Thank you for submitting these materials. I'm analyzing them and will send details to our admin team shortly."
- If not submission: Normal chatbot response (with search results, suggestions, etc.).

---

## 2. URL Safety Check

**Requirement:** Before analyzing URLs, validate them for safety.

**Approach Options:**

- **Option A: Domain Whitelist**
  - Maintain an approved list of educational domains (github.com, stackoverflow.com, developer.mozilla.org, coursera.org, udemy.com, youtube.com, Medium, etc.).
  - Reject URLs from unknown domains with user feedback.
  - _Trade-off:_ Simple, low false positives, but may reject niche educational resources.

- **Option B: URL Pattern & Malware Detection**
  - Check URL format validity (regex or URL parsing library).
  - Query a malware/phishing detection service (e.g., URLhaus, VirusTotal, PhishTank).
  - _Trade-off:_ More comprehensive, catches suspicious domains, but requires external API calls and rate limiting.

- **Option C: Hybrid (Recommended)**
  - Fast-path: check against whitelist.
  - Slow-path: if not on whitelist, query external safety service (with caching).
  - Allow admin override for approved domains after review.

**Decision: Using Option C (Hybrid)**

**Implementation:**

- Create a `validateUrlSafety(url: string): Promise<{ safe: boolean, reason?: string }>` utility.
- Return 400 error to user if URL fails safety check, with message: "That URL could not be verified as safe. Please check the link or contact support."
- Log rejected URLs for monitoring.
- Do **not** expose exact rejection reason to user (security best practice).

---

## 3. Submission Handler (Internal Process)

When `/chatbot/chat` classifies a message as a material submission, it invokes an internal submission handler with the following steps.

### Step 1: Validate Input

- Ensure `urls` array is non-empty.
- Validate each URL format.
- Check URL count limit (e.g., max 10 per submission).
- Verify `sessionId` exists.

#### Step 2: URL Safety Check (Per URL)

- Run safety validation on each URL (see section 2).
- If any URL fails, return 400 error with details.

#### Step 3: LLM Analysis

**Step 3a: Query Existing Graph (Duplicate & Skill Detection)**

- Extract keywords from fetched URL content (title, description, extracted text).
- Call `search_materials` internally for each keyword to find similar skills and materials already in the graph.
- Capture existing node names, descriptions, and relationships.

**LLM Prompt Instructions:**

```
Analyze the following learning materials. For each, extract:
1. Objective Skills: What skills does this material teach? (be specific and concise)
2. Prerequisite Skills: What prior knowledge is assumed? (list only essential prerequisites)
3. Brief Description: 1-2 sentences summarizing the content.
4. Estimated TimeMinutes: Rough time to complete (be conservative).

IMPORTANT CONSTRAINTS:
- When multiple materials are submitted together, ensure skill names are consistent across them.
- If a skill concept matches an existing node in the knowledge graph (provided below), use the EXACT existing node name.
- If a skill is new, choose clear, descriptive names that follow the existing naming conventions.

EXISTING KNOWLEDGE GRAPH NODES (for reference):
{existingNodes}
{
  "type": "submission",
  "message": "Thank you for submitting these materials! Our admin team is reviewing them. You can discuss details and next steps [here].",
  "materials": [
    {
      "url": "...",
      "title": "...",
      "description": "...",
      "estimatedTimeMinutes": 30,
      "objectiveSkills": ["skill1", "skill2"],
      "prerequisiteSkills": ["skill3"],
      "notes": "..."
    }
  ],
  "warnings": []
}
```

(Note: The backend will send the materials to Discord, capture the Discord message URL, substitute it into the message, add `submissionId` and `discordMessageUrl`, then return the full response to the client.)

**Requirements:**

- Fetch URL content using Puppeteer for reliable JavaScript rendering and content extraction.
- For each material, extract:
  - **Objective Skills**: What the material teaches (array of skill names).
  - **Prerequisite Skills**: What knowledge is assumed (array of skill names).
  - **Title & Description**: Metadata about the material.
  - **Estimated Time**: Rough completion time in minutes.
- Return structured JSON (parse and validate).

**Timeout & Retries:**

- Set LLM call timeout to 60 seconds per URL (or batch timeout of 120 seconds).
- If timeout, log error and return 503 "Service temporarily unavailable" to user.
- Do NOT retry; let admin review incomplete submissions later.

#### Step 4: Format Admin Notification

**Discord Notification Payload:**

```json
{
  "submissionId": "sub-12345",
  "sessionId": "session-uuid",
  "timestamp": "2026-02-22T10:30:00Z",
  "userContext": "I want to learn about SEO for my blog",
  "materials": [
    {
      "url": "...",
      "title": "...",
      "description": "...",
      "estimatedTimeMinutes": 30,
      "objectiveSkills": ["skill1", "skill2"],
      "prerequisiteSkills": ["skill3"],
      "notes": "..."
    }
  ],
  "adminActions": [
    "Review material accuracy",
    "Map skills to existing nodes or create new ones",
    "Approve or request resubmission",
    "Reply in Discord thread linking back to user session"
  ]
}
```

#### Step 5: Send to Discord

**Requirement:** Post each submission as a separate message in a designated Discord channel (e.g., `#material-submissions`).

**Implementation:**

- Use Discord webhook (environment variable: `DISCORD_WEBHOOK_URL`).
- Post each submission as a top-level message in the channel.
- Format as an embed for readability (include submission ID, materials, skills, etc.).
- Include reaction buttons (✅ Approve, ❌ Reject) for admin approval workflow.
- Admins reply to the message, creating a thread for discussion; bot listens for reactions/commands.

**Response to User:**

- Capture Discord message URL and return to user.
- Construct user-facing message: "Thank you for submitting these materials! Our admin team is reviewing them. You can discuss details and next steps [here](discord-message-url)."
- Store `discordMessageUrl` and `discordThreadId` in session context for reference.
- Users will check the Discord thread to see approval/rejection status and admin feedback.

#### Step 6: Log Submission

**Logging:**

- Log submission ID, session ID, URLs, LLM response, Discord message ID.
- Log any errors or warnings encountered.
- Use structured logging (JSON) for easy querying.

---

## 4. Error Handling

**Validation Errors:**

- Missing or empty `urls` array → 400, "URLs required"
- Invalid URL format → 400, "Invalid URL format"
- URL fails safety check → 400, "URL could not be verified as safe"
- Invalid `sessionId` → 400, "Invalid session"
- Too many URLs → 400, "Maximum 10 URLs per submission"

**LLM Errors:**

- LLM timeout → 503, "Analysis service temporarily unavailable. Please try again later."
- LLM returns invalid JSON → 500, "Internal error processing materials. Admin notified."
- LLM unable to access URL content → Log warning, include in Discord notification for admin review.

**Discord Posting Errors:**

- Webhook fails → Log error, retry up to 2 times with exponential backoff. If persistent, alert ops and return 500 to user: "Submission queued but admin notification failed. Support team notified."

**User-Facing Messages:**

- Never expose raw errors (e.g., "LLM timeout: 60s exceeded").
- Use friendly messages: "We're having trouble analyzing those materials right now. Please try again in a moment."

---

## 5. Integration with `/chatbot/chat` Endpoint

The `/chatbot/chat` endpoint is the single user-facing entry point. It now handles both regular chat and material submissions.

**Request to `/chatbot/chat` (Submission Example):**

```json
{
  "message": "I want to submit these SEO resources to help others learning. They cover on-page optimization, link building, and technical SEO: https://example.com/seo-guide https://example.com/backlinks-tutorial",
  "sessionId": "session-uuid",
  "conversationHistory": [...]
}
```

**Request to `/chatbot/chat` (Regular Chat Example):**

```json
{
  "message": "How do I improve my website's SEO? I found these resources that might help: https://example.com/seo-guide https://example.com/backlinks-tutorial",
  "sessionId": "session-uuid",
  "conversationHistory": [...]
}
```

**Response (Submission Case):**

```json
{
  "type": "submission",
  "message": "Thank you for submitting these materials! Our admin team is reviewing them. You can discuss details and next steps [here](https://discord.com/channels/...).",
  "submissionId": "sub-12345",
  "discordMessageUrl": "https://discord.com/channels/...",
  "materials": [
    {
      "url": "...",
      "title": "...",
      "description": "...",
      "estimatedTimeMinutes": 30,
      "objectiveSkills": ["skill1", "skill2"],
      "prerequisiteSkills": ["skill3"],
      "notes": "..."
    }
  ],
  "warnings": []
}
```

**Response (Regular Chat Case):**

```json
{
  "type": "chat",
  "message": "Here's what I found about that topic...",
  "relatedMaterials": [...],
  "suggestedActions": [...]
}
```

### Flow

1. **Message Classification & Extraction:** The LLM analyzes the incoming message.
   - Extract any URLs present.
   - Determine if the user intends to **submit** these as learning resources (vs. just referencing them in conversation).
   - If submission detected, return a `tool_call` to invoke the submission handler.
   - If regular chat, proceed with normal flow (search or final response).

2. **LLM Response Options:**
   - **Tool call (submission)**: `{"type":"tool_call","tool":"submit_materials","args":{"urls":[...],"userContext":"..."}}`
   - **Tool call (search)**: `{"type":"tool_call","tool":"search_materials","args":{"query":"...","limit":5}}`
   - **Final response**: `{"type":"final","message":"...","relatedMaterials":[...],"suggestedActions":[...]}`

3. **Backend Routing:**
   - If `tool="submit_materials"`: Invoke internal submission handler (Section 3: validate URLs, fetch content, analyze with LLM, post to Discord).
     - **Enhanced:** Before analyzing with LLM, search the graph for similar skills/materials using all extracted keywords from URL content.
     - Pass existing node names and relationships to the LLM so it aligns new skill wording with existing nodes (Duplicate Detection + Skill Mapping).
   - If `tool="search_materials"`: Execute search and reinvoke LLM with results.
   - If `type="final"`: Return response directly to user.

4. **Response to User:**
   - **Submission**: `type: "submission"` with user message (including Discord link), extracted materials, submission ID, and any warnings.
   - **Chat**: `type: "final"` with user message, related materials from search, and suggested actions.

---

## 6. Data Model

### SubmissionEntity (stored in database or session storage)

```typescript
interface MaterialSubmission {
  submissionId: string; // UUID
  sessionId: string; // Link to chat session
  timestamp: Date;
  userContext: string; // User's explanation of why submitting
  materials: {
    url: string;
    title: string;
    description: string;
    estimatedTimeMinutes: number;
    objectiveSkills: string[];
    prerequisiteSkills: string[];
    notes: string;
  }[];
  discordMessageId: string; // Link to Discord notification
  discordThreadId?: string; // If using threads
  adminStatus:
    | "pending"
    | "in_review"
    | "approved"
    | "rejected"
    | "resubmit_requested";
  adminNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

---

## 7. Testing

### Unit Tests

- **URL Validation:**
  - Valid URL formats pass.
  - Invalid formats (missing scheme, malformed) are rejected.
  - Safety check (whitelist / external service) works.

- **LLM Analysis:**
  - Valid response parsing (JSON validation).
  - Skill extraction accuracy (mock LLM responses).
  - Timeout handling.
  - Invalid JSON response handled gracefully.

- **Consistency Checking:**
  - Skills across different materials: if the same concept appears as an objective in one material and a prerequisite in another, naming is consistent.
  - LLM enforces consistent wording for related skills across the submission.

- **Message Classification:**
  - Submission messages detected (with URLs + submission intent).
  - Regular chat messages (URLs in conversation context) not misclassified.
  - Edge cases: URL only, minimal context, etc.

- **Error Handling:**
  - Each error type returns correct HTTP status and user-friendly message.
  - Errors logged with context (submission ID, LLM response, etc.).

### Integration Tests

- **End-to-End Flow (Submission):**
  - User sends message to `/chatbot/chat` containing multiple URLs with submission intent.
  - Message classified as submission by LLM.
  - URLs pass safety check.
  - LLM analyzes content and extracts skills with consistent naming across materials.
  - Discord notification posted.
  - User receives confirmation with Discord link.
  - Mock LLM, Discord webhook, message classifier.

- **End-to-End Flow (Regular Chat):**
  - User sends message to `/chatbot/chat` containing URL(s) in conversational context (not as submission).
  - Message classified as regular chat.
  - Proceeds with normal search/response flow.
  - Does not trigger submission handler.

- **Discord Integration:**
  - Webhook call succeeds and message URL is captured.
  - Webhook call fails → retry logic, fallback error handling.
- **Message Classification Edge Cases:**
  - URL-only message (minimal context) → classified as submission.
  - URL in middle of conversation → classify as regular chat.
  - Ambiguous intent → LLM decides based on heuristics.

---

## 8. Security & Rate Limiting

**Rate Limiting:**

- Limit submissions per session: 5 per hour (adjustable).
- Return 429 "Too many requests" if exceeded.

**Safety:**

- LLM API key kept server-side (environment variable).
- Discord webhook URL kept server-side.
- Do not expose LLM prompt or internal workflows to client.
- Sanitize user context before logging (remove PII if present).
- Validate all user inputs (URLs, session ID, etc.).

**URL Fetching:**

- Use Puppeteer to fetch and render URL content (handles JavaScript-heavy sites).
- Set page timeout to 15 seconds per URL.
- Extract title, meta description, and readable text content.
- Limit content to 5000 characters per URL.
- Reuse browser instance across multiple requests for efficiency.

---

## 9. Future Enhancements

- **Admin Dashboard:** UI to review, approve, edit, and merge submissions.
- **LLM Refinement:** Use feedback from admin approvals to fine-tune LLM prompts.
- **Batch Processing:** Allow submissions of 50+ URLs with async processing.
- **User-Facing Duplicate Alerts:** Notify user if submitted materials are similar to existing ones (before sending to admin).

---

## 10. Success Criteria

- ✅ User can submit one or more URLs via chat message.
- ✅ Submitted URLs are validated for safety.
- ✅ LLM analyzes content and extracts skills.
- ✅ Admin receives structured notification in Discord with all details.
- ✅ User is notified of submission with link to Discord discussion.
- ✅ Submitted materials have consistent skill naming across the submission.
- ✅ Regular chat messages are not misclassified as submissions.
- ✅ All errors are handled gracefully with user-friendly messages.
- ✅ Submissions are logged for audit and debugging.
