# Known limitations

An honest inventory of what is unmeasured, unverified, unimplemented, inconsistent or out of date. Each item states its evidence. Where an item is an inference from reading the code rather than an observed run, it says so.

Contents: [What is measured](#what-is-and-is-not-measured) · [Extraction quality](#extraction-quality) · [Reliability and latency](#reliability-and-latency) · [Architecture and operations](#architecture-and-operations) · [UI](#ui) · [Unverified assumptions](#unverified-assumptions) · [Unused or stale items](#unused-or-stale-items) · [Documentation drift](#documentation-drift) · [Suggested next steps](#suggested-next-steps)

## What is and is not measured

| Evidence                                                  | What it covers                                                                                                                    | What it does not                                                                                      |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Unit and route tests (about 260 `it()` call sites)        | Code handles a wide range of hand-written model, OCR and upstream-error shapes                                                    | Whether the model actually produces those shapes. Every model and OCR response in the suite is a mock |
| `PERFORMANCE-BENCHMARK.md` (24 live requests, 2026-11-03) | Latency, truncation and retry behaviour for single-document requests; field capture and evidence validity on one synthetic notice | Multi-document requests, Stage B, dependency detection, real documents, real scans, variety           |
| `scripts/preflight/*`                                     | Structured output shape, reasoning-content handling, English to Hindi translation behaviour                                       | Other languages, OCR                                                                                  |
| `FIX_LOG.md`                                              | A development history with test and build results                                                                                 | Anything after its last entry; it is not kept in sync with the code                                   |

## Extraction quality

### Dependency detection, the headline feature, has no live-model evidence

The benchmark sent one document per request, so Stage B (cross-document edges and conflicts) was never invoked ("Stage B was not invoked because every request contained one document"). The other tests mock Stage B output. There is therefore no measurement in the repository of how often the model proposes correct edges, misses real ones, invents plausible ones, or produces a quote that verifies. The two bundled sample documents are designed to exercise a dependency, but nothing records what a live model returns for them.

### Accuracy on real documents is unknown

The benchmark used a single synthetic notice repeated on every page. On 23 successful extractions: action, required documents, deadline and consequence were captured every time; the full conditional trigger was captured in 19; page citations were always page 1, which proves nothing about page-level extraction because the facts were identical on every page. No scanned real-world documents, tables, handwriting, multi-action documents or multilingual content have been measured.

### Strict evidence verification rejects most records in the benchmark

Evidence passed validation in 2 of 23 successful extractions. The model usually produced a snippet that joined the action and the deadline while skipping the text between them, which is not a contiguous quote and is correctly rejected. Under the current rules those records get `verification_status: unverified`, confidence capped at 0.4 and `information_type: uncertain`, and show a `? unverified` badge. Two readings are both plausible: the check is working as designed on a model that does not follow the "contiguous quote" instruction, or the check is too strict for the product. The repository does not decide between them. The check also proves only that text exists in the document; see [Security](security-and-privacy.md#prompt-injection).

Smaller points:

- The record-level `verification_status` depends on a single `evidence_snippet`. `field_evidence` and `conditional_requirements` are verified separately and reported, but do not affect that status or the confidence cap.
- OCR output without page delimiters limits page-level checks to `partially_verified`.

### One action per document

The schema has one `required_action`. A document with several independent tasks yields one row, and when a long document is split into sections the merged record keeps the highest-confidence section's action. There are no task-level dependencies, only document-level ones.

### Documents with no action still appear in the plan

A route test ("reproduces a tracking result with no stated action being planned as ready") pins the current behaviour: a delivery-status page with nothing to do becomes a plan item whose action is a placeholder such as "None stated", with status `ready`. The test describes it as a reproduction of a problem; it asserts the behaviour rather than fixing it.

### Stage B sees limited text, and conflicts are unchecked

- Stage B receives Stage A fields and a 1,500-character excerpt (first, middle and last 490 characters) per document, so a dependency stated elsewhere in a long document may be invisible to it.
- Edge quotes are verified; `conflicts` are not. Their descriptions are shown as the model wrote them.
- Exact-match dependency resolution requires two model-written strings to be identical after normalisation. Fuzzy matches only suggest. How often each path produces edges is unmeasured.

### Language and OCR

- Language codes come from documentation. Only English to Hindi translation was exercised live. Odia uses `od-IN` in the code while Sarvam's documentation shows `or-IN`; neither is confirmed.
- OCR quality on Indian-language scans has not been measured here.
- The page-delimiter format inside Sarvam's OCR markdown is undocumented; the code only inserts markers when the ZIP holds several markdown files.
- The 10-page OCR limit is applied to scanned PDFs before upload; mixed PDFs are treated as scans and fall under it, and the low-text-quality fallback skips the pre-check.

### Model-guessed numbers

`estimated_time_minutes` is a model estimate and the UI sums it. `confidence` is a self-reported model value (clamped, and capped by verification), not a calibrated probability.

## Reliability and latency

Benchmark figures (24 requests, three repetitions per case, synthetic fixtures; ranges describe that run only):

| Metric                                                                        | Value                                                              |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Requests that produced an extraction                                          | 23 of 24                                                           |
| Client-observed request time                                                  | median 30.34 s, range 20.53 to 95.64 s                             |
| Model call time                                                               | median 30.21 s, range 18.51 to 52.69 s (28 calls)                  |
| Stage A share of request time                                                 | dominant; median 28.34 s including repairs                         |
| OCR (scanned inputs)                                                          | median about 3.1 s total                                           |
| Upload parsing, validation, JSON parsing, dependency and priority computation | negligible (milliseconds)                                          |
| Model calls ending with `finish_reason: length`                               | 5 of 28 (4 initial, 1 repair)                                      |
| Output tokens per call                                                        | per-case medians between about 2,900 and 3,800 against a 4,096 cap |

Consequences and caveats:

- **Latency is a single long wait.** There is no streaming and no progress signal. The UI shows an indeterminate spinner, elapsed time and a cancel button.
- **Truncation is no longer retried (inference).** The benchmark's repair step recovered 3 of 4 truncated initial responses. The current code throws on truncation without a repair call, and a test pins that. Reading the code against the benchmark, the same 4 documents would have failed outright under the current behaviour. This is not a re-run; the sample is small and synthetic. The rate on real documents is unknown. `SARVAM_MAX_TOKENS` and `SARVAM_REASONING_EFFORT` are untested mitigations.
- **Truncation detail is hidden from users.** They see a generic "could not be analyzed"; the cause is only in the server log.
- **Empty model output is not repaired**, despite a test name implying otherwise (the test mocks an error without the classification production attaches).
- **Stage B upstream errors fail the whole request,** even when Stage A succeeded, while Stage B invalid output degrades to a warning. Stage A failures are per document.
- **Credential errors are opaque on `/api/extract`.** A bad key produces generic per-document failures rather than `UPSTREAM_AUTH`. Diagnose from logs.
- **Shared model queue.** All requests in a process share 4 concurrent chat slots. A large analysis (up to 30 Stage A calls) delays others.
- **Hard 285 s deadline** for the whole request, regardless of how much work is left.
- **Sarvam is a hard dependency** for OCR, extraction and translation. An outage or quota exhaustion takes the whole app down, apart from reading digital PDFs locally.

## Architecture and operations

- **No authentication or per-user quotas.** See [Security](security-and-privacy.md#controls-that-do-not-exist).
- **In-memory limits.** Rate-limit buckets, the hourly budgets and the concurrency cap are per process, reset on restart and are not shared between instances or serverless invocations.
- **Per-IP limiting is off by default** (`TRUSTED_PROXY_HOPS=0`), leaving only global limits that one client can exhaust.
- **Upload bodies are fully buffered** and the `Content-Length` pre-check can be bypassed by chunked requests; there is no streaming size limit.
- **CSP allows inline scripts and styles.** No nonce-based CSP.
- **Observability stops at structured logs.** No metrics endpoint, tracing or log shipping. Health checks do not exercise Sarvam.
- **Deployment verification is uneven.** `FIX_LOG.md` records one passing Docker build and health check and a later entry where it was deferred. Vercel and Railway configs exist with no record of a deployment.
- **Dependency hygiene.** `npm ci` has reported audit findings that are not triaged in the repository. `sharp` is installed but unused.
- **No data retention controls for Sarvam.** What the third party stores is governed by its terms.

## UI

- Only the English text summary is translated. The plan table, cards and reasoning panel stay in English, and `<html lang>` is fixed to `en` even while translated text is displayed.
- The "How PathWise decided" panel (component `AIReasoningPanel`) is templated text, not model reasoning.
- Two sample documents are preloaded on first load, and "Start over" clears everything after a `window.confirm`.
- Results are lost on refresh; there is no export, share or save.
- The page handles a `truncation` warning type that the server never emits (dead code).
- There are no component tests, so UI behaviour (cancellation, stale-response guards, translation caching and unmount handling) is verified only by reading and manual use.

## Unverified assumptions

| Assumption                                                                  | Status                                                                                                                           |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Odia language code (`od-IN` versus `or-IN`)                                 | Unresolved; flagged in `lib/languages.js` and `FIX_LOG.md`                                                                       |
| All 23 language codes work for OCR hints and translation                    | Only English to Hindi translation exercised live                                                                                 |
| Sarvam OCR page-marker format                                               | Unknown; code does not depend on it beyond joining multiple files                                                                |
| Larger `SARVAM_MAX_TOKENS` or a reasoning-effort setting reduces truncation | Not tested                                                                                                                       |
| `HTTPS_ONLY` takes effect when set only at container runtime                | Unlikely (Next.js resolves `headers()` at build), unverified                                                                     |
| `TRUSTED_PROXY_HOPS=1` is right for Railway or Render                       | Suggested by a code comment; unverified here                                                                                     |
| The Vercel configuration works                                              | No record of a deployment                                                                                                        |
| Sarvam Parse rate limit                                                     | Documentation states 200 requests per minute; the code limits concurrency (3) rather than rate, and does not enforce that figure |

## Unused or stale items

| Item                                           | Detail                                                                                                                                                      |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MAX_TOTAL_CHARS` in `lib/limits.js`           | Defined (150,000), not referenced anywhere                                                                                                                  |
| `CHAT_MODEL` export in `lib/sarvam.js`         | Hard-coded `"sarvam-105b"` "for import compat"; `getChatModel()` is what is used                                                                            |
| `sharp` in `package.json`                      | No imports and no `next/image` usage found                                                                                                                  |
| `test-validation.mjs` (repository root)        | Scratch script with an outdated copy of the Stage A Zod schema; not part of `npm test`                                                                      |
| `truncation` warning handling in `app/page.js` | The server never emits that warning type                                                                                                                    |
| `lib/apiError.js` header comment               | Lists a subset of the codes in `CODE_STATUS`                                                                                                                |
| Referenced but not in the reviewed export      | `.env.example` and `.github/workflows/ci.yml` (named in `.gitignore` and `FIX_LOG.md`), and the contents of `LICENSE`. These docs make no claims about them |

## Documentation drift

`FIX_LOG.md` is an append-only history. Where it disagrees with the code, the code wins. Known disagreements:

| `FIX_LOG.md` or `PERFORMANCE-BENCHMARK.md` says                                         | Current code                                                                                                           |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Evidence matching uses word-bigram Dice scoring at 0.80 with an anchored candidate scan | `lib/validation.js` does exact contiguous substring matching after NFC and whitespace normalisation; no fuzzy matching |
| Truncated Stage A output is repaired (benchmark)                                        | Truncation is not retried                                                                                              |
| Retry is "max 4 attempts"                                                               | `retries = 4`, so up to 5 attempts (1 initial + 4 retries)                                                             |
| Next.js 16.2.12, React 19.2.4, `engines.node >=22.0.0`                                  | `package.json`: Next.js 16.4.3, React 19.3.1, `engines.node >=22.13.0`                                                 |
| README fully rewritten, 157 tests                                                       | The exported README was empty; test totals are quoted as 157, 206, 224 and 227 in different entries                    |
| Docs pages "removed"                                                                    | Consistent, and `docs/` is excluded from the Docker context; these docs are new                                        |

## Suggested next steps

Suggestions drawn from the gaps above, in rough priority order. They are not planned work.

1. **Benchmark multi-document requests with realistic, sanitised documents** (at least five repetitions per case, including page-specific actions, tables and conditional rules), so that Stage B and dependency resolution have evidence behind them. The benchmark itself recommends this.
2. **Decide the truncation policy.** Test `SARVAM_MAX_TOKENS` and `SARVAM_REASONING_EFFORT`, decide whether truncation should be retried or the output budget reduced, and surface "response too long" to the user instead of a generic failure.
3. **Decide what "verified" should mean.** Either enforce shorter single-span quotes in the prompt and measure compliance, or accept multi-span quotes with per-span checks, and let field-level verification affect the record status.
4. **Make the failure model consistent.** Treat a Stage B upstream error like the other Stage B failures (warn and continue), and surface credential errors distinctly on `/api/extract`.
5. **Move limits to a shared store** and add authentication before any multi-user or public deployment.
6. **Add a minimal component test setup** for the stateful UI pieces, and a small live smoke test gated on an environment variable.
7. **Remove the dead code** listed above and refresh or archive `FIX_LOG.md`.
