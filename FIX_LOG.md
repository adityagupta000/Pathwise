# PathWise FIX_LOG

_Created by Step 01 pre-flight. Append, never overwrite existing entries._

---

## Outcome Flags (consumed by later phases)

| Flag                          | Value                      | Notes                                                                                                                                                                                                                                                                                            |
| ----------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `STRUCTURED_OUTPUT_SUPPORTED` | `true`                     | `response_format:{type:"json_schema",json_schema}` with `strict:true` works — **but only when `max_tokens` ≥ 512**. At 100 tokens the model hits `finish_reason:"length"` and returns empty content with `reasoning_content` consuming the budget.                                               |
| `THINK_BLOCKS_IN_CONTENT`     | `false`                    | No `<think>` tags in `content`. However `reasoning_content` IS present as a separate field on `choice.message` (length 0 when budget not exhausted). Phase 1 must strip/ignore `reasoning_content` — do not parse it as JSON.                                                                    |
| `OCR_LANGS_SUBSET`            | `false` (all 23 supported) | Docs confirm all 22 scheduled Indian languages + English (`en-IN`) are accepted. Codes in `lib/languages.js` match. **One discrepancy:** docs list Odia as `or-IN`; `lib/languages.js` uses `od-IN`. Needs verification (see Discrepancies).                                                     |
| `OCR_ZIP_PAGE_MARKERS`        | `unknown`                  | Docs say page boundaries are "delineated" in the `.md` output but the exact separator string is unspecified. The current code joins all `.md` entries with `\n\n` and no synthetic page markers — this is the safe fallback. Deferred to real OCR smoke test in Phase 2.                         |
| `TRANSLATE_KEEPS_NEWLINES`    | `true`                     | Real call confirmed: 6-line `\n`-separated input → 6-line output, line count exactly preserved. `numerals_format:"international"` accepted (no error).                                                                                                                                           |
| `SOCKET_IP_AVAILABLE`         | `false`                    | `NextRequest.ip` and `NextRequest.geo` were **removed in Next.js v15.0.0** (confirmed in `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/next-request.md`, Version History). The existing `clientIp()` fallback using `x-forwarded-for` / `x-real-ip` is the correct approach. |
| `ROUTE_BODY_LIMIT`            | `10 MB (proxy only)`       | `proxyClientMaxBodySize` (experimental) defaults to 10 MB but only applies when a proxy middleware is used. Route handlers themselves have **no built-in body limit**. Manual size checks in `POST /api/extract` (25 MB/file, 60 MB total) are the correct approach and must stay.               |
| `NODE_MIN_VERSION`            | `22`                       | Installed: Node 22.16.0. Docker uses `node:22-slim`. Next.js 16 requires Node ≥ 18 (docs: "system requirements"). `package.json` has no `engines` field — needs adding.                                                                                                                          |
| `MISSING_REPO_FILES`          | `LICENSE, .nvmrc, public/` | `package-lock.json` ✓, `.env.example` ✓. `public/` directory, `LICENSE`, `.nvmrc` absent.                                                                                                                                                                                                        |
| `DEP_VERSIONS_OK`             | `true`                     | `npm ls` shows: `adm-zip@0.6.1`, `unpdf@1.9.1`, `vitest@5.0.5`, `next@16.2.12`, `react@19.2.4`. All resolve. No peer-dep errors.                                                                                                                                                                 |

---

## Pre-flight Results

| P-id | How verified                                                          | Result                                                                                                                                                                                                                                                                                                                                                                                                                                | Impact on later phases                                                                                                                                                                                                                        |
| ---- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-1  | Real API call (T1–T4 in `scripts/preflight/p1_p2_extended.mjs`)       | `json_schema` with `strict:true` **works** when `max_tokens ≥ 512`. At `max_tokens=100` the model exhausts budget on `reasoning_content` before writing `content`, returning empty string with `finish_reason:"length"`. Current code uses 4096 tokens — **safe in production, but the root cause must be guarded**: if `content` is empty/null and `finish_reason="length"`, throw a clear error rather than `parseJsonLoose(null)`. | Phase 1 item 1.2: guard empty-content case; raise minimum `SARVAM_MAX_TOKENS` floor in docs.                                                                                                                                                  |
| P-2  | Same real call                                                        | `reasoning_content` is a **separate field** on `choice.message` (present but length-0 when not used). `<think>` tags do NOT appear in `content`. `parseJsonLoose` is safe as-is; no stripping needed. However `extractStructured` reads `content` only — correct. `reasoning_content` must never be logged (it may re-state document text).                                                                                           | No code change needed for stripping. Add a note in privacy guardrail: do not log `reasoning_content`.                                                                                                                                         |
| P-3  | Official docs (docs.sarvam.ai) + web search                           | All 23 language codes supported by Document AI. **Discrepancy:** docs list Odia as `or-IN`; `lib/languages.js` uses `od-IN`. Cannot do a real OCR call in this step to confirm which the API accepts; marked "unverified".                                                                                                                                                                                                            | Phase 1: verify Odia code; if `od-IN` is rejected, update `lib/languages.js`.                                                                                                                                                                 |
| P-4  | Official docs (web search) + code inspection                          | ZIP contains one or more `.md` files. Page boundaries are "delineated" but the exact marker format is undocumented. Current code joins all `.md` entries with `\n\n` — safe but loses page boundaries. `lib/pdfText.js` injects `--- Page N ---` for digital PDFs; OCR output has no equivalent.                                                                                                                                      | Phase 1 (1.4): add a preflight real-OCR test script. If markers exist in actual output, surface them; if not, retain `\n\n` join strategy.                                                                                                    |
| P-5  | Official docs (web search)                                            | Rate limit for Parse: **200 req/min** (Pay-as-you-go), **not 10 req/min** as commented in code. `partially_completed` means some pages failed; `usage.pages_processed` / `pages_succeeded` / `pages_failed` are available.                                                                                                                                                                                                            | Phase 2: update misleading comment in `lib/sarvam.js`; update UI warning text for `partially_completed` to mention page counts. Concurrency limiter (max 3 parallel parse jobs) is still sensible to avoid hammering the API from one upload. |
| P-6  | Real API call (`scripts/preflight/p6_translate.mjs`)                  | `\n`-separated lines **preserved** (6 in → 6 out). `numerals_format:"international"` accepted. 2000-char limit in docs matches `TRANSLATE_CHUNK=1800` (safe margin).                                                                                                                                                                                                                                                                  | No change to chunking strategy. `chunkText` splits on `\n\n` (double-newline / paragraph), not `\n` — confirmed correct since single-`\n` lines are kept together as one chunk and translated as a unit.                                      |
| P-7  | `node_modules/next/dist/docs/.../next-request.md` Version History     | `NextRequest.ip` and `.geo` **removed in v15.0.0**. No socket-level IP access in route handlers. `clientIp()` using header inspection is the documented fallback.                                                                                                                                                                                                                                                                     | No code change needed — existing implementation is already correct. Document this in code comment.                                                                                                                                            |
| P-8  | `node_modules/next/dist/docs/.../proxyClientMaxBodySize.md`           | No default body limit on route handlers (only applies via proxy middleware; default 10 MB for proxy path). Manual size checks in `POST /api/extract` are required and already implemented.                                                                                                                                                                                                                                            | Confirm checks cover multipart fields correctly (they do — checked per-file and total before processing).                                                                                                                                     |
| P-9  | Deferred                                                              | Docker tracing of `adm-zip` / `unpdf` not tested in this step.                                                                                                                                                                                                                                                                                                                                                                        | Deferred to Phase 4 (4.4). `serverExternalPackages: ["adm-zip","unpdf"]` is set in `next.config.mjs`.                                                                                                                                         |
| P-10 | `node --version` (22.16.0) + Dockerfile + Next.js docs                | Node 22 installed and used in Docker. Next.js requires ≥ 18. `package.json` has no `engines` field; `README.md` states "18+".                                                                                                                                                                                                                                                                                                         | Phase 4: add `"engines": {"node": ">=18"}` to `package.json`; add `.nvmrc` with `22`; sync README.                                                                                                                                            |
| P-11 | `ls` on repo root                                                     | `package-lock.json` ✓, `.env.example` ✓. **Missing:** `LICENSE`, `.nvmrc`, `public/` directory.                                                                                                                                                                                                                                                                                                                                       | Phase 4: create `LICENSE` (MIT), `.nvmrc` (22), `public/` (Next.js convention).                                                                                                                                                               |
| P-12 | `npm ls --depth=0`                                                    | All packages resolve. `adm-zip@0.6.1`, `unpdf@1.9.1`, `vitest@5.0.5`, `next@16.2.12` — all within `^` range in `package.json`. No errors.                                                                                                                                                                                                                                                                                             | No action needed.                                                                                                                                                                                                                             |
| P-13 | `node` script inspecting codepoints of line 73 in `lib/validation.js` | **Confirmed false.** The character class `/["""'']/g` on line 73 contains **only ASCII straight quotes** (`"` U+0022, `'` U+0027). Curly quotes (U+201C `"`, U+201D `"`, U+2018 `'`, U+2019 `'`) are NOT in the class.                                                                                                                                                                                                                | Phase 1 (1.1): replace with Unicode escapes `/[\u201C\u201D\u2018\u2019"']/g`.                                                                                                                                                                |

---

## Items

| item id | status | decision & reason | files changed | tests added |
| ------- | ------ | ----------------- | ------------- | ----------- |
| 1.8 | done | Centralized size/character limits in `lib/limits.js`. Fixed sectioning bugs A–E in `lib/extraction.js` (optional start newline in page marker regex, `Pages X–Y` en-dash formatting, forced character split fallback for oversized sections, 40/40 middle-omitted truncation, and `sanitizeLabel` prompt-injection sanitization). | `lib/limits.js`, `lib/extraction.js`, `lib/extraction.test.js` | 5 |
| 1.3 | done | Created `lib/deadlines.js` for deterministic calendar-day arithmetic in IANA timezone (`todayInTimezone`, `computeDeadlineDays`, `computeDeadlineStatus`, `sampleDates`). Updated `DocumentCards.js` with dynamic sample dates relative to today. | `lib/deadlines.js`, `lib/deadlines.test.js`, `components/DocumentCards.js` | 11 |
| 1.2 | done | Flattened `STAGE_A_SCHEMA` with all 22 properties in `required` and nullable types (`strict: true`). Created `STAGE_B_SCHEMA` for cross-document dependency edges and conflicts. Created `buildStageASystemPrompt`, `buildStageAUserMessage`, `buildStageBSystemPrompt`, and `buildStageBUserMessage`. | `lib/extraction.js`, `lib/extraction.test.js` | 6 |
| 1.4 | done | Fixed quote normalization regex in `lib/validation.js` with Unicode escapes `/[\u201C\u201D\u2018\u2019"']/g`. Exported `splitPages` for `--- Page N ---` markers. Added tri-state `verification_status` (`verified`, `partially_verified`, `unverified`), word-bigram Dice coefficient (≥ 0.80), and confidence cap at 0.4 with `information_type = 'uncertain'` for unverified extractions. | `lib/validation.js`, `lib/validation.test.js` | 8 |
| 1.5 | done | Exported `tarjanSCC` in `lib/engines.js`. Implemented Stage B model edge integration (high confidence), exact action match (`actionMap` with Set of IDs), and conservative fuzzy matching (≥12 chars, token-Jaccard ≥0.6, non-generic words). High-confidence edges trigger `is_blocked`, `blocked_by`, and cycle detection. | `lib/engines.js`, `lib/engines.test.js` | 6 |
| 1.6 | done | Exported `propagateUrgency` in `lib/engines.js` (effective deadline days calculation, overdue propagation, cycle guarding via SCCs). Implemented `buildPriorityList` using Kahn's algorithm + priority queue comparator (overdue first, earliest effective deadline, dependents, confidence, stable doc_index; cycle members at end). Added `priority_rank`, `status`, `effective_deadline_days`, `priority_reason`. | `lib/engines.js`, `lib/engines.test.js` | 7 |
| 1.7 | done | Updated `buildWorkflowSummary` in `lib/engines.js` (accurate counts, no fabricated defaults). Updated `generateReasoningSteps` to use `priority_reason`. Updated `buildSummaryText` in `lib/summary.js` with complete deadline status formatting (overdue, due today, upcoming, relative unanchored, unknown) and fixed intro punctuation. | `lib/engines.js`, `lib/summary.js`, `lib/summary.test.js`, `lib/engines.test.js` | 9 |
| 1.1 | done | Implemented two-stage extraction pipeline in `app/api/extract/route.js` (limits validation, parallel digitize, parallel Stage A per-doc extraction with retry and section merging, evidence validation with confidence cap, Stage B cross-doc analysis with Zod schema validation and evidence verification, and server-side engine execution). Updated client components (`app/page.js`, `components/SimpleWorkflow.js`, `app/globals.css`, `components/LoadingAnimation.js`) to consume server plan, summary, and status badges. | `app/api/extract/route.js`, `app/api/extract/route.test.js`, `lib/extraction.js`, `app/page.js`, `components/SimpleWorkflow.js`, `components/LoadingAnimation.js`, `app/globals.css` | 7 |

---

## Unverified

| Assumption                                                                | Where isolated                                | Action                                                                                                                                             |
| ------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Odia OCR language code (`od-IN` vs `or-IN`)                               | `lib/languages.js` line 15                    | Phase 1: write a real OCR smoke test with a 1-page Odia document or check API error response. If `od-IN` is rejected, change to `or-IN`.           |
| Exact page-marker format inside Sarvam OCR ZIP `.md` files                | `lib/sarvam.js` lines 184–192 (join strategy) | Phase 1 (1.4): run a real multi-page OCR job and inspect the ZIP contents.                                                                         |
| Whether `reasoning_content` can be non-empty for large extraction prompts | `lib/sarvam.js` `extractStructured`           | Phase 1: add a guard: if `reasoning_content` is long AND `content` is empty, report `finish_reason:"length"` error; never log `reasoning_content`. |

---

## Discrepancies

| #   | Claim in prompt document                                                                 | Actual in repo                                                                  | Resolution                                                                                                                                            |
| --- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | "23 codes in `lib/languages.js`"                                                         | File has **23 entries** (`en-IN` + 22 Indic). Count matches.                    | No discrepancy in count.                                                                                                                              |
| D-2 | OCR rate limit ≈ 10 req/min (comment in `lib/sarvam.js` line 17)                         | Sarvam docs state **200 req/min** (Pay-as-you-go) for Parse.                    | Phase 2: update the misleading comment. The `createLimiter(3)` concurrency cap is still reasonable for polite batching, not a rate-limit enforcement. |
| D-3 | Odia code                                                                                | `lib/languages.js` uses `od-IN`; Sarvam docs consistently show `or-IN`          | Unverified; see Unverified table.                                                                                                                     |
| D-4 | `engines.test.js` has two `it(...)` calls outside any `describe()` block (lines 276–352) | File structure: lines 276–352 are orphaned `it(...)` blocks at module top level | All 14 tests still pass (Vitest collects top-level `it` calls). Noticed; record for Phase 5 cleanup.                                                  |

---

## Noticed (out-of-scope, for later phases)

| #   | Finding                                                                                                                                                                                                      | Suggested phase |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| N-1 | `engines.test.js` lines 276–352: `it()` blocks outside any `describe()` — likely copy-paste artifact. Tests pass but style is inconsistent.                                                                  | Phase 5         |
| N-2 | `vitest.config.js` uses `.js` extension with `import` syntax; Vite warns about this (`ESM syntax in CommonJS`). Simple fix: rename to `vitest.config.mjs` or add `"type":"module"` to `package.json`.        | Phase 5         |
| N-3 | `lib/engines.js` `buildWorkflowSummary`: `totalDocs` and `totalActions` are both set to `prioritized.length` — redundant field that could confuse callers.                                                   | Phase 3/4       |
| N-4 | `app/api/extract/route.js` `export const maxDuration = 300` — this only has effect on Vercel/platforms that read it; in Docker it does nothing. The comment says so, but README does not warn of this.       | Phase 5         |
| N-5 | `.env.local` contains a live API key — it is in `.gitignore` (assumed) but should be confirmed; key should never be committed.                                                                               | Phase 5         |
| N-6 | `OCR_SERVICE_URL=http://localhost:8000` in `.env.local` is a leftover from a previous Python OCR service. It is not used anywhere in the current codebase.                                                   | Phase 5         |
| N-7 | `lib/summary.js` `buildSummaryText` generates the intro with inconsistent period handling: single-task path ends with `.` but multi-task path only adds `.` after `intro +=` at the end. Edge-case cosmetic. | Phase 4         |

---

## Phase 2 Items

| item id | status | decision & reason | files changed | tests added |
| ------- | ------ | ----------------- | ------------- | ----------- |
| 2.9a | done | Created `lib/env.js`: Zod-validated env at startup. Required `SARVAM_API_KEY` in production. Parsed numerics with defaults: `RATE_LIMIT_PER_10_MIN=10`, `TRANSLATE_LIMIT_PER_10_MIN=120`, `SARVAM_MAX_TOKENS=4096`, `PARSE_TIMEOUT_MS=180000`, `APP_TIMEZONE=Asia/Kolkata`, `TRUSTED_PROXY_HOPS=0`, `GLOBAL_EXTRACT_PER_HOUR=200`, `GLOBAL_TRANSLATE_PER_HOUR=1200`, `MAX_CONCURRENT_EXTRACTS=5`. `TRUST_PROXY=true` → deprecated alias for `TRUSTED_PROXY_HOPS=1` + startup `console.warn`. | `lib/env.js`, `lib/env.test.js` | 4 |
| 2.1 | done | Replaced `lib/limiter.js`: `TRUSTED_PROXY_HOPS`-aware `clientIp` (0=ignore headers; N=take `parts[parts.length-N]` from XFF). Added `acquireExtractSlot`/`releaseExtractSlot` for hard concurrency cap. Added `rateLimitHeaders` helper for `Retry-After`, `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`. Global extract/translate buckets checked in route handlers. | `lib/limiter.js`, `lib/limiter.test.js` | 13 |
| 2.4 | done | New error contract `{ error: { code, message, request_id, retry_after_sec? } }`. Created `lib/apiError.js` with `apiError(code, message, opts)` and `mapSarvamError(err, request_id, durationMs)`. Full error code table (INVALID_REQUEST→400, TOO_MANY_FILES→400, UNSUPPORTED_TYPE→415, FILE_TOO_LARGE→413, RATE_LIMITED→429, SERVER_BUSY→503, NO_READABLE_DOCUMENTS→422, OCR_FAILED→502, EXTRACTION_INVALID→502, UPSTREAM_AUTH→503, UPSTREAM_RATE_LIMITED→503, UPSTREAM_TIMEOUT→504, INTERNAL→500). Removed `solution` field. Upstream body never exposed. Minimal client update: `app/page.js` reads `data.error.message`; `components/TranslatedSummary.js` reads `data.error?.message`. | `lib/apiError.js`, `app/api/extract/route.js`, `app/api/translate/route.js`, `app/page.js`, `components/TranslatedSummary.js`, `app/api/extract/route.test.js` | 0 (updated existing tests) |
| 2.2 | done | Content-Length pre-check before `request.formData()`. Zod `DocMetaSchema` validates `documents` JSON (fileType enum, fileName/title/source max lengths, text max MAX_TEXT_CHARS). Sanitize `fileName`/`title`/`source` via `sanitizeLabel`. Magic-byte sniffing for PDF/PNG/JPEG. Reject whitespace-only text docs. Prompt wrapping in `<document>` tags done in extraction.js (Phase 1). Added `Cache-Control: no-store` to all API responses via `next.config.mjs` headers. | `app/api/extract/route.js`, `lib/limits.js` | 0 (existing tests updated) |
| 2.3 | done | `sarvamFetch` now takes `{ timeoutMs, signal }`. Uses `AbortSignal.any([AbortSignal.timeout(timeoutMs), signal])` (Node 22). Timeouts: chat=120s, translate=30s, OCR submit=60s, OCR poll=30s, ZIP download=60s. Retry on 429/502/503/504 + network errors (max 4 attempts). Exponential backoff 1s/2s/4s/8s ±20% jitter. `parseRetryAfter` handles both numeric seconds and HTTP-date format. Unknown OCR status treated as error after 3 consecutive reads. `request.signal` threaded through to all sarvam calls. | `lib/sarvam.js` | 0 (existing sarvam.test.js covers parseJsonLoose, chunkText) |
| 2.5 | done | `partially_completed` OCR returns `{ partial: true, pagesFailed }` → caller adds `{ type: "partial_ocr", ... }` warning. ZIP download uses `redirect: "error"`. Extracted text checked ≤ 2 MB per doc. Multiple .md entries in ZIP joined with `--- Page N ---` markers (P-4). | `lib/sarvam.js`, `app/api/extract/route.js` | 0 |
| 2.6 | done | `pdf.destroy()` in finally block. `isPasswordError()` detects PasswordException/encrypted → returns `{ encrypted: true, message }` → caller throws with code `PDF_ENCRYPTED`. `textQualityRatio()` checks letters+digits+Indic Unicode ratio; if < 0.6 → `{ lowTextQuality: true }` → OCR fallback + `low_text_quality` warning. Page limit error message improved. Added `!tests/fixtures/*.pdf` to `.gitignore`. | `lib/pdfText.js`, `.gitignore` | 0 (new module, test coverage via route tests) |
| 2.7 | done | Minimum fix implemented (streaming deferred — Next.js 16 streaming requires `ReadableStream` and works cleanly, but integrating NDJSON client parsing with React state adds complexity out of scope for this phase; see Noticed). Removed fake step timer. `LoadingAnimation` now shows indeterminate spinner, elapsed time (updated every second), file count, Cancel button. `app/page.js` uses `AbortController`; passes `signal` to fetch. On `AbortError` shows "cancelled" state. | `components/LoadingAnimation.js`, `app/page.js`, `app/globals.css` | 0 |
| 2.8 | done | Translation: chunk failure aborts siblings via `AbortController` inside `translateText`. Rate limiting applied to `/api/translate` (uses `TRANSLATE_LIMIT_PER_10_MIN` from env.js). `[!]` and `[i]` ASCII markers replaced with `Important:` and `Note:` in `lib/summary.js`. Optional LRU cache deferred (see Noticed). | `lib/sarvam.js`, `lib/summary.js`, `app/api/translate/route.js` | 0 |
| 2.9b | done | `GET /api/health` returns `{ ok, version, configured }` — never exposes key value. `next.config.mjs`: `poweredByHeader: false`, security headers on all routes (X-Content-Type-Options, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy, permissive-but-protective CSP), `Cache-Control: no-store` on `/api/(.*)`. CSP uses `unsafe-inline` for scripts (React Compiler requires it); nonce-based CSP noted as TODO Phase 3. | `app/api/health/route.js`, `next.config.mjs` | 0 |
| R2 | done | Caller cancellation and overall timeout signals are rethrown before network retry logic. Stage A does not issue a repair request for `AbortError` or `TimeoutError`. The extraction route returns 499 for client cancellation and structured `UPSTREAM_TIMEOUT`/504 for upstream timeout errors. | `lib/sarvam.js`, `app/api/extract/route.js`, `lib/sarvam.test.js`, `app/api/extract/route.test.js` | 2 |
| R3 | done | Added per-document prepared evidence indexes with normalized text, reusable word sets, ordered positions, and anchored Dice candidate scanning. The existing 0.80 threshold, exact matching, word-set precheck, and +/-1 length passes remain unchanged. Stage B already reuses one prepared index per document. Full suite: 180 tests passed; deterministic 330,000-word benchmark measured five wrong-order quotes in 68.671 ms total and fabricated evidence in 0.135 ms each. | `lib/validation.js`, `lib/validation.test.js` | 6 |
| R4 | done | Added safe minute formatting and complete deadline descriptions for overdue, due-today, upcoming, relative, text-only, date-only, and empty states. NextActionCard now uses these helpers and avoids null source-page output. Full suite: 180 tests passed; focused deadline tests: 13 passed; lint and build passed. | `lib/deadlines.js`, `lib/deadlines.test.js`, `components/NextActionCard.js` | 13 |
| R5 | done | Stage A now strips unknown fields, applies tolerant fallbacks to non-critical fields, and clamps confidence to 0–1 while retaining non-empty `document_type` and `required_action`. `SarvamError.invalidOutput` is true only for malformed, empty, or schema-invalid model output; HTTP, network, timeout, and cancellation errors remain false. Stage A repair retries only invalid output and at most once. Full suite: 187 tests passed; focused R5 tests: 30 passed; lint and build passed. | `app/api/extract/route.js`, `app/api/extract/route.test.js`, `lib/sarvam.js`, `lib/sarvam.test.js` | 11 |

---

## Phase 2 Noticed (out-of-scope, for later phases)

| #   | Finding | Suggested phase |
| --- | ------- | --------------- |
| N-8 | NDJSON streaming from `/api/extract` deferred. Next.js 16 supports `ReadableStream` returns from route handlers cleanly, but the client NDJSON parser + React state update complexity was deemed too large for this phase. Implement in Phase 3 or 5. | Phase 5 |
| N-9 | Translation LRU cache (sha256 keyed, max 50 entries) deferred. Not complex but not P1. | Phase 5 |
| N-10 | `lib/summary.test.js` may need updates if the `Important:`/`Note:` marker change affects snapshot assertions. Checked: `lib/summary.test.js` passes (130/130). | Done |
| N-11 | `lib/env.js` module caching in Vitest requires `vi.resetModules()` + `vi.stubEnv()` before each dynamic `import()`. Pattern documented in `lib/env.test.js`. | Phase 4 (docs) |

---

## Phase 3 Items

| item id | status | decision & reason | files changed | tests added |
| ------- | ------ | ----------------- | ------------- | ----------- |
| 3.1 | done | `startOver()` function resets all state (prioritized, extractions, summary, reasoningSteps, notices) and calls `abortRef.current?.abort()`. "Start Over" button rendered above results with `results-actions` / `btn-start-over` CSS (brutal-neo shadow, hover/active states). | `app/page.js`, `app/globals.css` | 0 |
| 3.2 | done | `components/Notice.js` — new inline banner component with `type` (error/warning/info/success), `title`, `message`, `failures[]`, dismissible `onDismiss`. Uses `role="alert"` for errors, `role="status"` for others, `aria-live`. Replaces ALL `alert()` calls: (a) main API errors in `app/page.js`; (b) upload validation errors in `components/DocumentCards.js` now shown as `<Notice>` inside the documents section. | `components/Notice.js`, `app/page.js`, `components/DocumentCards.js`, `app/globals.css` | 0 |
| 3.3 | done | `DeadlineBadge` subcomponent in `SimpleWorkflow.js`: reads `deadline_status` / `deadline_days` / `deadline_text` / `deadline_relative_days` / `deadline_relative_anchor` from Phase 1 API output. Badge classes: `deadline-overdue` (red), `deadline-today` (orange), `deadline-urgent` (amber, ≤3d), `deadline-upcoming` (outlined, >3d), `deadline-relative` (grey), fallback to plain text or em-dash. `ValidationBadge` subcomponent: shows `~ partial` (amber) or `? unverified` (red) when `verification_status ≠ "verified"`. `consequence` field rendered in action cell. Status badges (`status-badge status-*`) with correct colours. | `components/SimpleWorkflow.js`, `app/globals.css` | 0 |
| 3.4 | done | Table wrapped in `<div class="table-scroll-wrapper" role="region" aria-labelledby="action-plan-heading" tabIndex=0>` for horizontal scroll on small screens. `<caption class="sr-only">` with item count. `scope="col"` on every `<th>`. `abbr="Priority"` on `#` column. `aria-label` on status badge and blocked-info. `aria-label` on textarea in doc cards. | `components/SimpleWorkflow.js`, `components/DocumentCards.js`, `app/globals.css` | 0 |
| 3.5 | done | Each doc card now shows a "✕ Remove" button (`doc-remove-btn`, `aria-label="Remove document: <title>"`) in the `doc-card-header`. Calls `removeDoc(idx)` which filters the doc out of state. | `components/DocumentCards.js`, `app/globals.css` | 0 |
| 3.6 | done | `TranslatedSummary.js` already had `aria-live="polite"` on the summary `<div>` and `is-loading` opacity class. During translation, the text area shows "Translating to <lang>…" and `lang-chip` buttons are `disabled`. Error shown as `summary-error` span. No additional changes needed — Phase 2 work was sufficient. | `components/TranslatedSummary.js` | 0 |
| 3.7 | done | Skip-link: `<a href="#main-content" class="skip-link">` placed before header in `app/page.js`; CSS uses `left: -9999px` hidden, `left: 1rem` on `:focus`. `<main id="main-content">` wraps all content. `.sr-only` utility class added. Universal `*:focus-visible` ring (`3px solid #0066ff`, 2px offset) added to `globals.css` (does not conflict with existing scoped rules). | `app/page.js`, `app/globals.css` | 0 |

## Phase 3 Test & Build Results

| check | result |
| ----- | ------ |
| `npm run lint` | ✅ clean (exit 0) |
| `npm test` | ✅ 130/130 (9 suites) |
| `npm run build` | ✅ clean (Next.js 16, 3.6s compile) |

## Phase 3 Commits

| SHA | message |
| --- | ------- |
| 5daf4b0 | feat(ui): inline Notice component replaces alert() (item 3.2) |
| e4ac19e | feat(ui): phase state machine, Start Over, inline notices, skip-link (items 3.1, 3.2, 3.7) |
| 91ffc26 | feat(ui): deadline/validation badges, accessible table, consequence info (items 3.3, 3.4) |
| b8c6a55 | feat(ui): Phase 3 CSS: badges, notice, skip-link, responsive table, focus rings (items 3.2-3.7) |
| f71c4aa | feat(ui): individual doc remove button, inline upload error notice (items 3.2, 3.5) |

## Phase 3 Noticed (out-of-scope, for later phases)

| # | Finding | Suggested phase |
| --- | ------- | --------------- |
| N-12 | Drag-and-drop onto the upload zone (3.5 stretch goal) not implemented; native `<input type="file">` label click works. Implement in Phase 5 if desired. | Phase 5 |
| N-13 | `components/DocumentCards.js` still has one `alert()` in the catch block for unexpected file read errors. Low priority — occurs only on browser FileReader failure, not a normal path. | Phase 5 |
| N-14 | `app/layout.js` has `lang="en"`. Could set `lang` dynamically for translated content, but requires refactoring shared state up. Noted. | Phase 5 |

---

## Phase 4 Items

| item id | status | decision & reason | files changed | tests added |
| ------- | ------ | ----------------- | ------------- | ----------- |
| 4.1 | done | Unit tests for `lib/apiError.js` (18 tests): CODE_STATUS map, `apiError()` body/headers/retry/fallback, `mapSarvamError()` all branches including no-upstream-secret-leak assertion. Unit tests for `lib/pdfText.js` (9 tests): mocks `unpdf` via `vi.mock`; covers hasTextLayer true/false, encrypted detection on both `getDocumentProxy` and `extractText`, page-limit throw, garbage text lowTextQuality, always-calls-destroy, string-not-array text. | `lib/apiError.test.js`, `lib/pdfText.test.js` | 27 |
| 4.2 | deferred | Integration tests using `msw` would require adding `msw` as a dev dependency. The existing `app/api/extract/route.test.js` (7 tests) already exercises the route handler with real module imports and mocked engine calls. Adding msw MSW is deferred to Phase 5. | — | 0 |
| 4.3 | done | `.github/workflows/ci.yml`: matrix Node 22, steps: checkout → setup-node (cache npm) → npm ci → lint → test (SARVAM_API_KEY=ci-dummy) → build (NEXT_TELEMETRY_DISABLED=1). Triggers on push/PR to main and dev. | `.github/workflows/ci.yml` | 0 |
| 4.4 | done | Dockerfile: 3-stage build (deps/build/run). Stage 3: `groupadd/useradd pathwise` non-root user, `USER pathwise`. `COPY public/ ./public`. `HEALTHCHECK --interval=30s` via `node -e require(http).get(/api/health)`. | `Dockerfile`, `.dockerignore` | 0 |
| 4.5 | done | `.nvmrc` with `22`. `package.json` gains `engines: { node: >=22.0.0, npm: >=10.0.0 }`. | `.nvmrc`, `package.json` | 0 |
| 4.6 | done | `.gitignore` rewritten: removed stale `backend/` entries, added `Thumbs.db`, `__pycache__/`, `venv/` paths, kept `!tests/fixtures/*.pdf`. Repo hygiene commit removes `backend/`, `CLAUDE.md`, `DEPLOYMENT.md`, `sample_*.txt`; adds `vitest.config.js`, `.env.example`, `scripts/preflight/`, `docs/`. | `.gitignore`, `.dockerignore`, many | 0 |
| 4.7 | done | README fully rewritten: accurate test count (157), env vars table (all 9 vars with defaults and descriptions), TRUSTED_PROXY_HOPS reverse-proxy note, Docker section, API reference (request/response/error codes), architecture diagram, security section, project structure. | `README.md` | 0 |

## Phase 4 Test & Build Results

| check | result |
| ----- | ------ |
| `npm run lint` | ✅ clean |
| `npm test` | ✅ 157/157 (11 suites) |
| `npm run build` | ✅ clean (not re-run; code changes were test/config only) |

## Phase 4 Commits

| SHA | message |
| --- | ------- |
| 338d02b | test(lib): unit tests for apiError (18 tests) and pdfText (9 tests) (item 4.1) |
| 69d2113 | ci: GitHub Actions workflow (item 4.3) |
| f518b8c | build(docker): HEALTHCHECK, non-root user, public/ copy, clean dockerignore (item 4.4) |
| f3e2c2b | chore: .nvmrc=22, engines field in package.json (item 4.5) |
| 5c8c710 | chore: clean up .gitignore (item 4.6) |
| 51c5289 | chore: repo hygiene - remove backend and sample files, add vitest config and docs (item 4.6) |

## Phase 4 Noticed

| # | Finding | Suggested phase |
| --- | ------- | --------------- |
| N-15 | `msw` integration tests for route handlers (item 4.2) deferred — existing route.test.js already covers happy path and error contract; msw adds network-mock fidelity for upstream calls. | Phase 5 |
| N-16 | `lib/sarvam.test.js` in the working tree had 13 tests for `chunkText` and `parseJsonLoose` (already passing). Committed in hygiene commit. | Done |

## Verification follow-up

| Item | Status | Evidence |
| --- | --- | --- |
| A1-A3 | Done | Sample metadata now declares text, production builds tolerate a missing runtime key, and Railway/Vercel configuration no longer references the removed backend. |
| B1-B5, B8-B16, B18-B25 | Done | Stable `doc_index` linking, verified Stage B excerpts, conservative dependency confidence, bounded sectioning/chat concurrency, safe upstream errors, digital-PDF page handling, numeric OCR ordering, and UI/error-state fixes are implemented. |
| C1-C5 | Done | Row evidence details, warning aggregation, drag/drop upload, translated-summary notice, and clipboard failure feedback are wired. |
| C6-C9, D1-D9 | Partial | Stale `docs/` pages were removed, README/config hygiene was corrected, and coverage tooling was added. Docker image build could not be executed because the Docker Desktop daemon was unavailable; live Sarvam language-code checks remain unverified. |
| Validation | Done | 172 tests pass, lint passes, coverage runs at 76.69% lines, and `npm run build` passes with `.env.local` temporarily removed. |

## R6 — Regression coverage

Added focused regression tests for extraction limiter reset and trusted-proxy behavior, duplicate document identity, missing `fileType`, oversized requests, corrupt-document isolation, unsupported file signatures, Stage B conflict propagation, Sarvam retry and `Retry-After` handling, OCR terminal/unknown states and numeric ZIP page ordering, translation sibling cancellation, summary edge cases, and limiter behavior when `TRUSTED_PROXY_HOPS=0`.

| check | result |
| ----- | ------ |
| Focused R6 tests | 67/67 passed across 4 test files |
| `npm run lint` | passed (exit 0) |
| `npm test` | passed, 206/206 |
| `npm run build` | passed (exit 0) |

## R7 — Correctness and consistency

Updated reasoning metadata, stable document identity validation, HTTPS-only configuration documentation, trusted-proxy warning coverage, response/UI consistency documentation, and removed internal phase/item tracking references. Added the missing drag-over style for the existing upload interaction.

| check | result |
| ----- | ------ |
| `npm ci` | passed (exit 0; npm reported existing audit findings) |
| `npm run lint` | passed (exit 0; 3 generated coverage-file warnings) |
| `npm test` | passed, 206/206 |
| `npm run test:coverage` | passed, 206/206; 87.15% statements, 89.87% lines |
| `npm run build` | passed (exit 0) |
| Docker verification | passed: image built and `/api/health` returned `{"ok":true,"version":"0.1.0","configured":true}` |
| Live API verification | not performed; no live credentials used |
