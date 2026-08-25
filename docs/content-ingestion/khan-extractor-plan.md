# Khan Academy Site-Specific Extractor — Implementation Spec

## Goal

Port the transcript-first extraction logic from the Python reference implementation at
`autopopulate-wbp/crawlers/src/sources/khan_transcript_extractor.py` to Node, and wire it
into the existing `scrapeContent` flow in `perk-api` so Khan Academy pages get properly
filtered transcript/body text instead of the generic `main`/`article`/`body` `innerHTML`
fallback used today.

This only improves Phase 2 (scrape and parse) of the content-ingestion pipeline. No
changes to whitelist gating, LLM extraction, canonicalization, or the commit flow.

## Background: current state

- `perk-api/services/ingest/scraper.js` exports `scrapeContent(url)`, which launches a
  Playwright browser, navigates to the URL, and extracts `articleRoot.innerHTML` from
  `main`, then `article`, then `body` as a fallback chain. This is generic and does not
  filter navigation, cookie banners, or other boilerplate.
- `perk-api/services/ingest/scraperConfig.js` exports `normalizeHostname` and
  `isAllowedDomain`, used for the site whitelist gate. Reuse the same hostname
  normalization approach for the new Khan Academy URL check.
- Tests for the scraper live in `perk-api/__tests__/ingestScraper.test.js` and mock the
  `playwright` module directly (`jest.mock("playwright", ...)`).

## Step 1: Create the Khan Academy extractor module

**File:** `perk-api/services/ingest/extractors/khanAcademyExtractor.js`

Port these marker constants verbatim from the Python source (same strings, same
matching semantics — case-insensitive substring matching against normalized lines):

```js
const TRANSCRIPT_START_MARKERS = ["video transcript", "transcript"];

const SUMMARY_START_MARKERS = ["abouttranscript", "about transcript"];

const TRANSCRIPT_END_MARKERS = [
  "creative commons attribution",
  "video on youtube",
  "skip to main content",
  "use of cookies",
  "additional links",
  "want to join the conversation",
  "questions",
  "tips & thanks",
  "up next:",
];

const ARTICLE_ONLY_END_MARKERS = ["skip to end of discussions"];

const BOILERPLATE_LINE_MARKERS = [
  "welcome to khan academy",
  "skip to main content",
  "use of cookies",
  "additional links",
  "want to join the conversation",
  "sign up",
  "log in",
  "accept all cookies",
  "strictly necessary only",
  "cookies settings",
];
```

### Exports

#### `isKhanAcademyUrl(url)`

- Input: a URL string (or `URL` instance).
- Normalize the hostname the same way `normalizeHostname` does in `scraperConfig.js`
  (lowercase, strip protocol/`www.` when parsing fails).
- Return `true` when the hostname is `khanacademy.org` or ends with `.khanacademy.org`.
- Return `false` for anything invalid or non-matching. Never throw.

#### `extractTranscriptOrBody(text, url)` — pure function, no I/O

- Input: raw visible page text (a single string, as you'd get from `innerText` on a
  rendered page) and the page URL string (used only to check for `/a/` in the path, to
  mirror the Python article-detection heuristic).
- Output: `{ body: string, transcriptUsed: boolean }`.
- Behavior, mirroring the Python class method-for-method:
  1. **Normalize lines**: split `text` on newlines, collapse internal whitespace to
     single spaces and trim each line (equivalent to Python's `_clean_single_line`),
     drop empty lines, then dedupe consecutive identical lines (equivalent to
     `_dedupe_consecutive`).
  2. **Locate a transcript section**, in this priority order:
     - a line that _exactly_ equals `"video transcript"` (case-insensitive, after
       trimming) — exact match, not substring;
     - otherwise, the first line matching any of `TRANSCRIPT_START_MARKERS` via
       case-insensitive substring match;
     - otherwise, the first line matching any of `SUMMARY_START_MARKERS` via
       case-insensitive substring match.
  3. **If a transcript start was found**: collect lines after that line, stopping
     (excluding the stop line) at the first line matching any of
     `TRANSCRIPT_END_MARKERS`, skipping any line matching `BOILERPLATE_LINE_MARKERS`
     along the way. Join the collected lines with `\n`. Set `transcriptUsed = true`.
  4. **If no transcript start was found**: fall back to a main-body extraction over
     _all_ normalized lines. Choose the end-marker set based on the URL: use
     `ARTICLE_ONLY_END_MARKERS` when the URL path contains `/a/`, otherwise use
     `TRANSCRIPT_END_MARKERS`. Stop at the first matching end marker, skipping
     boilerplate lines along the way, same as above. Set `transcriptUsed = false`.
  5. Trim the final joined body. If it ends up empty, return `{ body: "", transcriptUsed: false }`.
- Keep this function synchronous and dependency-free so it can be unit tested directly
  with plain string fixtures (no Playwright mocking needed).

#### `extractKhanAcademyPage(page, url)` — async, thin Playwright wrapper

- Input: an already-navigated Playwright `page` object, and the URL string.
- Steps:
  1. Best-effort dismiss a cookie banner: try clicking a button matched by accessible
     name against `/Accept All Cookies/i` first, then `/Strictly Necessary Only/i`,
     with a short timeout; swallow any errors (the banner may not be present).
  2. Get the title: try `page.locator("h1").first().innerText()` with a short timeout;
     on failure fall back to `page.title()`; on failure fall back to `""`. Clean it with
     the same single-line whitespace collapsing used for body lines.
  3. Get the raw page text: try `page.locator("main").innerText()`; on failure fall back
     to `page.locator("body").innerText()`.
  4. Call `extractTranscriptOrBody(rawText, url)`.
  5. Return `{ content: body, title: cleanedTitle, transcriptUsed }`.
- Do not put any line-filtering logic in this function — it all lives in
  `extractTranscriptOrBody`.

### JSDoc

Add JSDoc with `@param`/`@returns` on all three exported functions, matching the style
already used in `scraperConfig.js` and `scraper.js`.

### Substeps in request flow order

1. **Route the submitted URL through the Khan-specific gate**
   - Validate the input URL string.
   - Normalize the hostname and detect whether it is a Khan Academy URL.
   - If it is not a Khan URL, return early and let the generic scraper continue.
   - If it is a Khan URL, continue to the Khan-specific rendering branch.

2. **Load the rendered page in the browser**
   - Open a Playwright Chromium browser context.
   - Navigate to the URL with a Khan-specific wait strategy: try `networkidle` first,
     then retry with `domcontentloaded` if the page times out.
   - Keep the browser session open long enough for React hydration to finish and the
     page content to appear.

3. **Dismiss UI blockers before text extraction**
   - Attempt to click a cookie banner button such as `Accept All Cookies` or
     `Strictly Necessary Only`.
   - Ignore failures silently if the banner is absent or not interactive.
   - This ensures the visible transcript/body content is not obscured by overlays.

4. **Read the page title and main body text from the rendered DOM**
   - Try `h1` text first and fall back to `page.title()`.
   - Read the main visible text from `main` and, if needed, fall back to `body`.
   - Use the browser's visible text output rather than raw HTML so list items and
     transcript blocks are flattened into user-visible text lines.

5. **Normalize the text into line-based transcript candidates**
   - Split the output into lines.
   - Collapse repeated whitespace inside each line.
   - Remove empty lines.
   - Drop duplicate consecutive lines.
   - This creates a stable list of transcript-like lines that the next stage can scan.

6. **Search for transcript markers in order**
   - Look for an exact `"video transcript"` line first.
   - If not found, scan for the transcript start markers.
   - If still not found, scan for the summary-style `about transcript` markers.
   - If none are found, continue to the generic main-body fallback path.

7. **Extract the transcript body between the start and end markers**
   - Start after the first recognized transcript header.
   - Stop at the first end marker such as `"up next:"` or `"want to join the conversation"`.
   - Skip boilerplate lines such as login, cookie, and navigation text.
   - Join the surviving lines back into a single body string.

8. **Fall back to the main article body when no transcript exists**
   - Use the generic Khan instructional-page extraction rules when transcript markers
     are absent.
   - For article URLs (`/a/`), use the article-only end markers.
   - Otherwise use the general transcript-stop markers.
   - Keep collecting only visible instructional text until the correct cutoff point.

9. **Return the final extraction result**
   - Return `{ content, title, transcriptUsed }` from the Khan-specific extractor.
   - Produce the trimmed text body, clean title, and the flag that indicates whether a
     transcript was used.
   - Pass that result back to `scrapeContent`, which then returns it as the canonical
     result for a Khan Academy page.

## Step 2: Wire the extractor into `scrapeContent`

**File:** `perk-api/services/ingest/scraper.js` (depends on Step 1)

- Import `isKhanAcademyUrl` and `extractKhanAcademyPage` from
  `./extractors/khanAcademyExtractor`.
- **Navigation strategy must branch too, not just extraction.** Khan Academy is a
  client-rendered React app: `waitUntil: "domcontentloaded"` (the current generic
  behavior) can resolve before the app has hydrated, leaving `main`/`h1` empty or
  showing a "please enable JavaScript" placeholder — this is the bug the user is
  hitting today. Mirror the Python reference's `_render_with_playwright` fallback:
  - Determine `isKhanAcademyUrl(parsedUrl)` **before** calling `page.goto`.
  - If Khan: call `page.goto(url, { waitUntil: "networkidle", timeout: 45000 })`
    first; if that throws a Playwright `TimeoutError`, retry once with
    `page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 })` as a
    fallback (same two-tier strategy as the Python code, adapted to Node's
    `page.goto` throwing on timeout instead of returning early).
  - Otherwise: keep the existing single `waitUntil: "domcontentloaded"` call
    unchanged for all other sites.
  - Keep the existing `response.status() >= 400` check after whichever `goto` call
    ultimately succeeds.
- After navigation succeeds, branch on `isKhanAcademyUrl(parsedUrl)` again:
  - If true, call `extractKhanAcademyPage(page, parsedUrl.toString())` to get
    `{ content, title }`.
  - Otherwise, keep the existing generic `main`/`article`/`body` `innerHTML`
    extraction exactly as it is today.
- Preserve the existing behavior of throwing `"Unable to load the page for ingestion."`
  when the extracted `content` is empty, for both branches.
- Do not change the function signature, return shape, or error handling for invalid
  URLs — only the internal navigation/extraction branches change.

## Step 3: Unit tests for the new extractor

**File:** `perk-api/__tests__/khanAcademyExtractor.test.js` (new)

Cover, using plain string/URL fixtures (no Playwright mocking) for
`extractTranscriptOrBody` and `isKhanAcademyUrl`:

1. `isKhanAcademyUrl`
   - Returns `true` for `https://www.khanacademy.org/...` and a subdomain like
     `https://khan-cdn.khanacademy.org/...`.
   - Returns `false` for `https://example.com/...` and for malformed input.
2. `extractTranscriptOrBody`
   - **Transcript present**: given text containing a `"Video transcript"` header line
     followed by transcript lines and then an end marker (e.g. `"Up next:"`) followed by
     unrelated trailing text, asserts the returned `body` contains only the transcript
     lines and `transcriptUsed` is `true`.
   - **No transcript, video-like page**: given text with no transcript markers, asserts
     it falls back to the main body, stopping at a `TRANSCRIPT_END_MARKERS` line (e.g.
     `"Want to join the conversation?"`), and `transcriptUsed` is `false`.
   - **Article page**: given a URL containing `/a/` and text with no transcript
     markers, asserts the cutoff uses `ARTICLE_ONLY_END_MARKERS` (e.g.
     `"Skip to end of discussions"`) rather than the general end markers.
   - **Boilerplate filtering**: given text with interleaved boilerplate lines (e.g.
     `"Sign up"`, `"Log in"`, `"Accept All Cookies"`), asserts none of them appear in the
     returned body.
   - **Dedup**: given text with an immediately-repeated line, asserts only one copy
     appears in the returned body.
   - **Empty input**: given empty/whitespace-only text, asserts `body` is `""` and
     `transcriptUsed` is `false`.

Add one thin test for `extractKhanAcademyPage`, mocking a Playwright `page` object with
jest mock functions for `locator(...).first().innerText()`, `locator(...).innerText()`,
`title()`, and `getByRole(...).click()`, following the same mocking style already used
in `ingestScraper.test.js`. Assert it returns the expected `{ content, title,
transcriptUsed }` shape by delegating to `extractTranscriptOrBody` under the hood
(you can spot-check with a small fixture rather than re-testing all extraction rules
here).

## Step 4: Extend scraper tests for the new branch

**File:** `perk-api/__tests__/ingestScraper.test.js` (depends on Step 2)

- Add `jest.mock("../services/ingest/extractors/khanAcademyExtractor")` and assert that
  when `scrapeContent` is called with a `khanacademy.org` URL, it calls
  `extractKhanAcademyPage` (mocked to resolve a fixture `{ content, title,
transcriptUsed }`) and returns that content/title, without invoking the generic
  `page.evaluate` innerHTML path.
- Add/keep a case with a non-Khan URL (e.g. `developer.mozilla.org`) asserting the
  generic path is still used and the Khan extractor mock is not called.
- Add a case asserting a Khan URL calls `page.goto` with `waitUntil: "networkidle"`
  first, and, when that `page.goto` call rejects, retries once with
  `waitUntil: "domcontentloaded"` before proceeding to extraction. Add a case asserting
  a non-Khan URL still calls `page.goto` exactly once with `waitUntil:
"domcontentloaded"` (no networkidle attempt).

## Suggested implementation order

1. Step 1 (extractor module) — independently testable, no dependency on scraper.js.
2. Step 3 (extractor unit tests) — verify Step 1 before touching the scraper.
3. Step 2 (wire into `scrapeContent`).
4. Step 4 (scraper branch tests).

## Verification

1. Run `npm test` in `perk-api` — all ingest tests (new and existing) pass.
2. Run `npm run lint` in `perk-api` — no new lint errors.
3. Optional manual smoke check: point `scrapeContent` at a real Khan Academy video URL
   and a real Khan Academy article URL locally, and confirm transcript vs. main-body
   text is extracted without boilerplate.

## Design notes

- Keep the split strict: `extractTranscriptOrBody` is pure and synchronous (all
  marker/line filtering logic); `extractKhanAcademyPage` is the only place touching
  Playwright APIs. This mirrors the Python module's separation between rendering and
  text processing, and keeps the bulk of the logic unit-testable without mocking a
  browser.
- The generic (non-Khan) scraping path in `scrapeContent` must remain unchanged.
- No changes to Phase 3+ (LLM extraction/canonicalization) or the whitelist gate.
