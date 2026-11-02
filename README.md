# PathWise — AI-Powered Document Workflow Planner

> **Turn multiple government notices into one clear, prioritised action plan — in 23 Indian languages.**

PathWise uses Sarvam AI to process PDFs, scanned images and text files, extract structured actions with deadline detection, resolve cross-document dependencies, and produce a ranked workflow translated on demand.

Built for the **Sarvam AI Hackathon 2026**.

[![CI](https://github.com/adityagupta000/Sarvam-epoch/actions/workflows/ci.yml/badge.svg)](https://github.com/adityagupta000/Sarvam-epoch/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-205%20passing-brightgreen)]()
[![Build](https://img.shields.io/badge/build-passing-brightgreen)]()
[![License](https://img.shields.io/badge/license-MIT-blue)]()

---

## Features

| Feature            | Detail                                                                        |
| ------------------ | ----------------------------------------------------------------------------- |
| **Document types** | Digital PDFs, scanned PDFs (OCR), images (PNG/JPG/WebP), plain text           |
| **Extraction**     | Structured JSON via `sarvam-105b` with strict schema; evidence validated      |
| **Deadlines**      | ISO date parsed → overdue / due-today / upcoming / relative badges            |
| **Dependencies**   | Blocking graph with cycle detection; plan sorted by Kahn's algorithm          |
| **Prioritisation** | Unblocked first, then deadline urgency                                        |
| **Languages**      | 23 languages (22 scheduled Indian languages + English) via Sarvam Translate   |
| **Validation**     | LLM claims cross-checked against source text; `partial` / `unverified` badges |

---

## Quick Start

### Prerequisites

- Node.js ≥ 22 (see `.nvmrc`)
- A [Sarvam AI](https://www.sarvam.ai/) API key

### Local development

```bash
# 1. Clone and install
git clone https://github.com/adityagupta000/Sarvam-epoch.git
cd pathwise
npm ci

# 2. Copy .env.example to .env.local and set the key — never commit this file
cp .env.example .env.local
# Edit .env.local and set SARVAM_API_KEY

# 3. Start dev server
npm run dev
# → http://localhost:3000
```

### Run checks

```bash
npm run lint      # ESLint
npm test          # Vitest (205 tests, ~1 s)
npm run test:coverage
npm run build     # Next.js production build
```

---

## Environment Variables

| Variable                     | Required | Default                 | Description                                                                                                         |
| ---------------------------- | -------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `SARVAM_API_KEY`             | **Yes**  | —                       | Sarvam AI secret key (`sk_…`)                                                                                       |
| `APP_TIMEZONE`               | No       | `Asia/Kolkata`          | IANA timezone for deadline calculations                                                                             |
| `TRUSTED_PROXY_HOPS`         | No       | `0`                     | Number of reverse-proxy hops to trust for `X-Forwarded-For`. Set to `1` when running behind a single load balancer. |
| `RATE_LIMIT_PER_10_MIN`      | No       | `10`                    | Max `/api/extract` requests per IP per 10 minutes                                                                   |
| `TRANSLATE_LIMIT_PER_10_MIN` | No       | `120`                   | Max `/api/translate` requests per IP per 10 minutes                                                                 |
| `GLOBAL_EXTRACT_PER_HOUR`    | No       | `200`                   | Global extract cap across all IPs                                                                                   |
| `GLOBAL_TRANSLATE_PER_HOUR`  | No       | `1200`                  | Global translation cap across all IPs                                                                               |
| `MAX_CONCURRENT_EXTRACTS`    | No       | `5`                     | Hard concurrency cap for long-running extractions                                                                   |
| `PARSE_TIMEOUT_MS`           | No       | `180000`                | OCR job polling timeout (ms)                                                                                        |
| `SARVAM_MAX_TOKENS`          | No       | `4096`                  | Max output tokens for LLM calls                                                                                     |
| `SARVAM_BASE_URL`            | No       | `https://api.sarvam.ai` | Sarvam API base URL                                                                                                 |
| `SARVAM_CHAT_MODEL`          | No       | `sarvam-105b`           | Structured extraction model                                                                                         |
| `HTTPS_ONLY`                 | No       | —                     | Set to `true` when TLS is terminated in front of the application; then CSP adds `upgrade-insecure-requests`.        |

> **Tip — reverse proxy:** If you deploy behind nginx or a cloud load balancer, set `TRUSTED_PROXY_HOPS=1` so IP-based rate limiting uses the real client IP from `X-Forwarded-For` rather than the proxy IP.
>
> Configure proxy limits for OCR uploads with `client_max_body_size 64m` and `proxy_read_timeout` of at least 330 seconds.

---

## Docker Deployment

```bash
# Build
docker build -t pathwise .

# Run (supply your API key at runtime — never bake it into the image)
docker run -p 3000:3000 \
  -e SARVAM_API_KEY=sk_your_key_here \
  -e TRUSTED_PROXY_HOPS=1 \
  pathwise
```

The image:

- Uses **Node.js 22 slim** base
- Runs as a **non-root** `pathwise` user
- Exposes the Next.js standalone server on port `3000`
- Includes a `HEALTHCHECK` against `/api/health`

### Quick smoke test

```bash
# Start the container
docker run -d --name pathwise-test \
  -e SARVAM_API_KEY=sk_your_key_here \
  -p 3000:3000 \
  pathwise

# Wait for it to be ready, then check health
sleep 5
curl http://localhost:3000/api/health
# Expected: {"ok":true,"version":"0.1.0","configured":true}

# Cleanup
docker stop pathwise-test && docker rm pathwise-test
```

### Health endpoint

```bash
curl http://localhost:3000/api/health
# {"ok":true,"version":"0.1.0","configured":true}
```

---

## API Reference

### `POST /api/extract`

Accepts a `multipart/form-data` body with:

| Field                 | Type        | Description                                               |
| --------------------- | ----------- | --------------------------------------------------------- |
| `documents`           | JSON string | Array of `{ title, source, text?, fileType?, fileName? }` |
| `language`            | string      | BCP-47 code of the document language (e.g. `hi-IN`)       |
| `file_0`, `file_1`, … | binary      | File blobs for PDF/image documents                        |

**Limits:** 5 files max, 25 MB per file, 60 MB total.

**Success response** (`200`):

```json
{
  "extractions": [ { "required_action": "...", "deadline_date": "2026-11-10", ... } ],
  "plan":        [ { ...sorted by dependency + priority... } ],
  "failures":    [ { "file_name": "scan.pdf", "message": "OCR failed" } ],
  "warnings":    [ { "type": "partial_ocr", "message": "..." } ],
  "summary":     { "documents": 2, "actions": 2, "dependencies": 1, "blocked": 1, "estimated_minutes": 30 },
  "analysis_id": "uuid",
  "dependencies": [],
  "conflicts": [],
  "reasoning_steps": [],
  "processing": []
}
```

**Error response** (4xx / 5xx):

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "...",
    "request_id": "uuid",
    "retry_after_sec": 60
  }
}
```

Error codes: `INVALID_REQUEST` · `TOO_MANY_FILES` · `UNSUPPORTED_TYPE` · `FILE_TOO_LARGE` · `RATE_LIMITED` · `SERVER_BUSY` · `NO_READABLE_DOCUMENTS` · `OCR_FAILED` · `PDF_ENCRYPTED` · `PAGE_LIMIT` · `EXTRACTION_INVALID` · `UPSTREAM_AUTH` · `UPSTREAM_ERROR` · `UPSTREAM_RATE_LIMITED` · `UPSTREAM_TIMEOUT` · `INTERNAL`

### `POST /api/translate`

```json
// Request
{ "text": "Complete your action plan", "target": "hi-IN" }

// Response
{ "translated": "अपनी कार्य योजना पूरी करें", "target": "hi-IN" }
```

### `GET /api/health`

Returns `{ ok, version, configured }`. `configured` is `true` when `SARVAM_API_KEY` is set.

---

## Architecture

```
Browser
  │ multipart/form-data (PDF, image, text)
  ▼
Next.js Route Handler  (/api/extract)
  ├─ Input validation (Zod, magic-byte sniff, size limits)
  ├─ Rate limiting (per-IP + global buckets, concurrency cap)
  ├─ Text extraction
  │    ├─ Digital PDF → unpdf text layer
  │    └─ Scanned PDF / image → Sarvam Document AI (OCR)
  ├─ LLM extraction  → sarvam-105b  (structured JSON schema)
  ├─ Evidence validation
  ├─ Dependency graph (Kahn's topo sort + cycle detection)
  ├─ Priority engine
  └─ Summary generation
        │
        ▼
    Sarvam AI APIs
    ├─ Document AI  (OCR)
    ├─ sarvam-105b  (structured extraction)
    └─ sarvam-translate:v1  (23 languages)
```

---

## Security

- **No document storage** — documents are processed in memory and never written to disk
- **No logging of content** — document text, API key, and `reasoning_content` are never logged
- **Rate limiting** — per-IP and global caps with `Retry-After` headers
- **Reverse-proxy aware** — `TRUSTED_PROXY_HOPS` controls XFF trust
- **Security headers** — `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, CSP
- **Non-root Docker user** — runs as `pathwise:pathwise` in the container
- **Env validation** — Zod validates environment variables on first import (the first request in a server process); requests that need Sarvam fail safely when no key is configured

> **Never commit `.env.local`** — it is listed in `.gitignore`.

---

## Testing

```bash
npm test                   # run all 205 unit tests
npm run test:watch         # watch mode
npm run test:coverage      # run with v8 coverage
```

Test files mirror their source modules (`lib/foo.test.js` → `lib/foo.js`). Route handler tests live in `app/api/extract/route.test.js`.

---

## Project Structure

```
app/
  api/extract/route.js    POST /api/extract — main orchestration
  api/translate/route.js  POST /api/translate
  api/health/route.js     GET  /api/health
  page.js                 Client UI shell (phase state machine)
  globals.css             Global styles (neo-brutal design)
  layout.js               Root layout
components/               React components
lib/
  apiError.js             Error response factory
  deadlines.js            Deadline computation (no LLM date maths)
  engines.js              Dependency graph, priority, plan builder
  env.js                  Zod-validated environment configuration on first import/request
  extraction.js           Prompt builder, extraction helpers
  limits.js               Shared constants (MAX_FILES, MAX_FILE_BYTES …)
  limiter.js              Rate limiter (XFF-aware, global buckets)
  pdfText.js              PDF text layer extraction (unpdf)
  sarvam.js               Sarvam API client (OCR, chat, translate)
  summary.js              Plain-text summary builder
  validation.js           Evidence validation engine
```

---

## Acknowledgements

- [Sarvam AI](https://www.sarvam.ai/) — Document AI, LLM, and Translation APIs
- [Next.js](https://nextjs.org/) — App Router, streaming, standalone output
- [unpdf](https://github.com/unjs/unpdf) — Lightweight PDF text extraction
- [Zod](https://zod.dev/) — Runtime schema validation

---

_Built for the Sarvam AI Hackathon 2026_

## Known Limitations

- **One action per document**: The extraction pipeline produces one primary action per uploaded document.
- **In-memory rate limiting**: Rate limits are tracked per-process. In multi-instance deployments (e.g., Kubernetes) use a shared Redis store instead (contribution welcome).
- **English-only UI chrome**: Interface labels, error messages, and notifications are in English. Translated output via the Summary Translation feature supports all 22 Indic languages.
- **Non-streaming responses**: `/api/extract` returns a single JSON response after full processing. NDJSON streaming is planned but not yet implemented.
- **OCR page limit**: scanned PDFs sent to Sarvam Document AI accept up to 10 pages; split larger scanned files before uploading. Digital PDFs with a text layer are not subject to this OCR limit.
- **No persistent storage**: Documents and results are processed in memory and never saved. Refreshing the page resets the app.
