# Development

Local workflow, conventions the code follows, how the tests are organised, and the places where a change has to be made in more than one file.

Contents: [Setup](#setup) · [Conventions](#conventions) · [Testing](#testing) · [Common changes](#common-changes) · [Preflight scripts](#preflight-scripts) · [Repository notes](#repository-notes)

## Setup

Requirements: Node `>=22.13.0` (`.nvmrc` pins the major version, 22), npm `>=10`, a Sarvam API key.

```bash
nvm use
npm ci
echo 'SARVAM_API_KEY=your_key_here' > .env.local
npm run dev
```

The app runs at `http://localhost:3000`. Two sample documents are preloaded (`getDefaultDocs()` in `components/DocumentCards.js`). Their dates are generated relative to today so the demo always has a future appointment.

Before sending a change:

```bash
npm run lint
npm test
npm run build      # builds without a key; env validation skips the key check in the build phase
```

`AGENTS.md` at the repository root contains a note for AI coding agents that this project uses a Next.js version whose APIs may differ from their training data, and to read the docs shipped in `node_modules/next/dist/docs/` before writing code.

## Conventions

These are what the existing code consistently does. Follow them unless there is a reason not to.

- **Imports.** Use the `@/` alias (maps to the repository root) for cross-directory imports.
- **Configuration.** Import `env` from `lib/env.js`. Do not read `process.env` directly in new code. Add new variables to the Zod schema with a default or an explicit requirement.
- **Errors.** API routes return errors through `apiError(code, message, opts)` so the shape, `request_id` and `no-store` header are consistent. Add new codes to `CODE_STATUS` in `lib/apiError.js`. Never put an upstream response body, a key name or document text in a message.
- **Purity.** `lib/engines.js`, `lib/validation.js`, `lib/deadlines.js`, `lib/extraction.js`, `lib/summary.js` and `lib/insights.js` do no I/O. Keep it that way: it is why they are easy to test.
- **Dates.** Calendar-day arithmetic belongs in `lib/deadlines.js` and uses `APP_TIMEZONE`. Do not ask the model to compute days.
- **Identity.** Documents are identified by `doc_index`. File names are user-controlled and can repeat; never match on them.
- **Logging.** One JSON object per line via `console.info` / `console.error`. No document text, no extracted values, no keys, never `reasoning_content`. Use `sanitizeLabel` on anything user-controlled that you do log.
- **Cancellation.** Thread `AbortSignal` through anything that waits. Callers that cancel or time out must not trigger retries or repair calls.
- **Client state.** `app/page.js` owns document and result state. Components are controlled and receive setters.

## Testing

```bash
npm test                 # vitest run --config vitest.config.mjs
npm run test:watch
npm run test:coverage    # V8 coverage on lib/**, threshold 75% lines
npm run test:ui
```

Configuration (`vitest.config.mjs`): globals enabled, **Node** environment, alias `@` to the repository root, coverage limited to `lib/**` excluding tests.

### What is covered

A static count finds 262 `it()` call sites across 14 test files (not executed as part of writing these docs; run `npm test` for the current result). `FIX_LOG.md` records totals of 157, 206, 224 and 227 at different points, and about 87% statement coverage on `lib/` at one point.

| Area                        | File                                                                                                | Focus                                                                                                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extract route               | `app/api/extract/route.test.js`                                                                     | Admission and limits, upload validation, per-document isolation, Stage A retry and repair rules, truncation, sectioning, deadline context, Stage B edges and conflicts, error mapping, log redaction |
| Translate and health routes | `app/api/translate/route.test.js`, `app/api/health/route.test.js`                                   | Translate: happy path, empty text, unsupported target, oversized `Content-Length`, non-JSON body. Health: `ok`, `configured`, key never exposed, version, `no-store`                                 |
| Validation                  | `lib/validation.test.js`                                                                            | Evidence matching, page verification, confidence cap, evidence coverage, performance on large inputs                                                                                                 |
| Engines                     | `lib/engines.test.js`                                                                               | Dependency sources, Tarjan cycles, urgency propagation, ordering, reasoning steps                                                                                                                    |
| Sarvam client               | `lib/sarvam.test.js`                                                                                | Retry, backoff and `Retry-After`, cancellation, OCR states and ZIP handling, URL allow-list, chunking, loose JSON parsing                                                                            |
| Others                      | `lib/apiError`, `deadlines`, `env`, `extraction`, `insights`, `limiter`, `pdfText`, `summary` tests | Unit behaviour                                                                                                                                                                                       |

### How tests are built

- Route tests import the real `POST` handler and mock `@/lib/sarvam` (`parseDocument`, `extractStructured`) and `@/lib/pdfText`. They reset limiter state with `_resetBuckets()` and `_resetExtractSlots()`.
- Shared fixtures live in `lib/test-fixtures/extraction-quality.js`.
- `lib/env.js` caches at import. Tests that need different environments call `vi.resetModules()` and `vi.stubEnv()` before a dynamic `import()`; `lib/env.test.js` shows the pattern.

### What is not covered

- **No component or DOM tests.** The environment is Node and there is no testing-library setup, so React components, including the translation lifecycle guards in `TranslatedSummary`, are untested.
- **No end-to-end tests** and **no automated live-API tests.** Every model and OCR response in the suite is a hand-written mock, so the suite shows the code handles those shapes, not that the model produces them.
- **Cross-document dependency detection has no live-model evidence at all** (see [known limitations](known-limitations.md#extraction-quality)).
- `lib/languages.js`, `lib/limits.js` and `app/layout.js` have no tests, and the translate route has no route-level test for rate limiting or upstream error mapping.
- One test pair is imprecise: the route test "repairs empty model content exactly once" mocks an error without the classification the real client attaches, so it does not reflect production behaviour (see [Extraction pipeline](extraction-pipeline.md#validation-and-repair)).
- `FIX_LOG.md` notes a timing-sensitive evidence-matching benchmark test that failed once at 360 ms and passed on rerun. Expect it to be flaky on slow machines.

## Common changes

### Change the extracted fields (Stage A schema)

The Stage A shape is defined in several places that must be changed together. Nothing enforces that they agree.

| What                      | Where                                              | Purpose                                                                                                                                                                |
| ------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STAGE_A_SCHEMA`          | `lib/extraction.js`                                | JSON schema sent to the model. Strict mode requires every property to be in `required`, `additionalProperties: false`, and optional values expressed as nullable types |
| `buildStageASystemPrompt` | `lib/extraction.js`                                | Field-by-field instructions to the model                                                                                                                               |
| `StageAOutputSchema`      | `app/api/extract/route.js`                         | Zod schema the server accepts, with tolerant `.catch()` fallbacks for non-critical fields                                                                              |
| `expectedFieldEvidence`   | `lib/validation.js`                                | Which fields should have a verified citation                                                                                                                           |
| Engines, summary, UI      | `lib/engines.js`, `lib/summary.js`, `components/*` | Anything that reads the new field                                                                                                                                      |
| `test-validation.mjs`     | repository root                                    | A stale fourth copy of the Zod schema in a scratch script. Not part of `npm test`; update or delete it                                                                 |

Add fixtures and route tests with the change. Keep the output small: truncation at `SARVAM_MAX_TOKENS` fails a document, and every added field increases completion size.

### Add or change a language

Add an entry to `LANGUAGES` in `lib/languages.js` (`code`, `name`, `native`, and `rtl: true` for right-to-left scripts). The same list drives the document-language select, the translation chips and server-side validation. Confirm the code against the live Sarvam API; the existing codes are taken from documentation, and the Odia code is unresolved.

### Change a limit

Edit `lib/limits.js`. Client and server both import it, so the UI messages and server checks move together. Check `Content-Length` pre-check arithmetic (`MAX_TOTAL_BYTES` plus 2 MB) in the extract route and any proxy body limits.

### Change retry or timeout behaviour

`sarvamFetch` and the per-call `timeoutMs` values in `lib/sarvam.js`. Remember the request-level 285 s deadline in the extract route sits above all of them.

## Preflight scripts

`scripts/preflight/` holds three manual scripts used to check assumptions about Sarvam's API:

| Script                  | Checks                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `p1_p2_chat_schema.mjs` | Whether `sarvam-105b` honours `response_format: json_schema` with `strict`, and where reasoning content goes         |
| `p1_p2_extended.mjs`    | The same with larger `max_tokens`, and `reasoning_content` handling                                                  |
| `p6_translate.mjs`      | Whether translation keeps line breaks, and whether `numerals_format: "international"` is accepted (English to Hindi) |

```bash
node scripts/preflight/p6_translate.mjs
```

They read `SARVAM_API_KEY` from `.env.local` or the environment, hit `https://api.sarvam.ai` directly (they ignore `SARVAM_BASE_URL`) and consume API credits. They are excluded from the Docker image.

## Repository notes

- **`FIX_LOG.md` is a historical log, not a specification.** Its header says to append and never overwrite. Some entries describe behaviour that has since changed (see [known limitations](known-limitations.md#documentation-drift)). When the log and the code disagree, the code is right.
- **`PERFORMANCE-BENCHMARK.md`** records one 24-request run on 2026-11-03 against synthetic fixtures. Its numbers are reproduced in the docs where relevant and described honestly in the document itself as small-sample.
- **`README.md` at the root of the exported snapshot was empty.** The README in these docs replaces it.
- **`docs/` and all Markdown except `README.md` are excluded from the Docker build context.**
