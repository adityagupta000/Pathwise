# API reference

Three route handlers, all Node runtime, all responses `Cache-Control: no-store`. There is no authentication.

| Method and path                             | Purpose                                                        |
| ------------------------------------------- | -------------------------------------------------------------- |
| [`POST /api/extract`](#post-apiextract)     | Analyse 1 to 5 documents and return a prioritised plan         |
| [`POST /api/translate`](#post-apitranslate) | Translate English summary text into another supported language |
| [`GET /api/health`](#get-apihealth)         | Liveness and configuration check                               |

Contents: [extract](#post-apiextract) · [translate](#post-apitranslate) · [health](#get-apihealth) · [Error contract](#error-contract) · [Rate-limit headers](#rate-limit-headers) · [Limits](#limits) · [Languages](#languages)

## POST /api/extract

`Content-Type: multipart/form-data`. Maximum duration: the request is cut off at 285 s (`maxDuration = 300` is also exported for platforms that read it).

### Request

| Field       | Type        | Required              | Notes                                                                                                                             |
| ----------- | ----------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `documents` | JSON string | yes                   | Array of 1 to 5 document descriptors (below)                                                                                      |
| `file_<i>`  | file        | for `pdf` and `image` | The file for `documents[i]`, zero-based                                                                                           |
| `language`  | string      | no                    | Language of the documents, used as the OCR hint. Must be a code from [Languages](#languages); anything else falls back to `en-IN` |

Document descriptor:

| Field      | Type                           | Default         | Constraint                                                                               |
| ---------- | ------------------------------ | --------------- | ---------------------------------------------------------------------------------------- |
| `fileType` | `"text"`, `"pdf"` or `"image"` | `"text"`        |                                                                                          |
| `fileName` | string                         | none (required) | at most 255 chars. Extension must be `pdf`, `png`, `jpg` or `jpeg` for `pdf` and `image` |
| `title`    | string                         | `""`            | at most 255 chars                                                                        |
| `source`   | string                         | none            | at most 100 chars                                                                        |
| `text`     | string                         | none            | at most 1,000,000 chars. Used when `fileType` is `text`                                  |

`fileName`, `title` and `source` are sanitised (control characters, newlines, quotes, angle brackets and `---` removed) before reaching the model.

Notes:

- For `text` documents the server rejects whitespace-only `text`, but it does not reject a missing `text` field; such a document is analysed as empty.
- File bytes are checked against the extension. A `.pdf` whose bytes are not a PDF, or a PNG/JPEG mismatch, is rejected for that document.
- `.webp` is not accepted by the server. The bundled client converts WebP to PNG before upload.

### Examples

Text document:

```bash
curl -sS http://localhost:3000/api/extract \
  -F 'documents=[{"fileType":"text","fileName":"notice.txt","text":"Visit the branch within 10 days. Bring your PAN card."}]' \
  -F 'language=en-IN'
```

PDF:

```bash
curl -sS http://localhost:3000/api/extract \
  -F 'documents=[{"fileType":"pdf","fileName":"notice.pdf","title":"notice"}]' \
  -F 'file_0=@notice.pdf;type=application/pdf'
```

### Response: 200

Analysis time is typically tens of seconds. A 200 can still contain per-document `failures` and `warnings`; check both.

```jsonc
// Abridged and illustrative: shapes, not real output.
{
  "analysis_id": "6f1c…", // equals the request_id
  "generated_at": "2026-11-04T09:12:41.000Z",
  "timezone": "Asia/Kolkata",
  "extractions": [
    /* Extraction[] */
  ],
  "dependencies": [
    /* verified Stage B edges */
  ],
  "conflicts": [{ "doc_ids": ["doc1", "doc2"], "description": "…" }],
  "plan": [
    /* Extraction + ranking, ordered */
  ],
  "summary": {
    "documents": 2,
    "actions": 2,
    "dependencies": 1,
    "blocked": 1,
    "estimated_minutes": null,
  },
  "reasoning_steps": [
    {
      "type": "scan",
      "label": "Documents Uploaded",
      "detail": "2 of 2 documents analysed (0 could not be read)",
      "icon": "1",
    },
  ],
  "failures": [
    { "file_name": "scan.pdf", "code": "PDF_ENCRYPTED", "message": "…" },
  ],
  "warnings": [{ "type": "validation", "message": "…" }],
  "processing": [
    { "file_name": "notice.pdf", "method": "text-layer", "pages": 2, "ms": 41 },
  ],
}
```

| Field          | Notes                                                                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extractions`  | One per successfully analysed document, in upload order, after dependency resolution                                                                                  |
| `dependencies` | Stage B edges that survived validation. Each has `from_doc_id`, `depends_on_doc_id`, `reason`, `evidence_quote`, `evidence_doc_id`, `confidence` (`high` or `medium`) |
| `conflicts`    | Stage B conflicts. Not evidence-verified                                                                                                                              |
| `plan`         | The same records as `extractions` plus `priority_rank`, `status`, `effective_deadline_days`, `priority_reason`, in priority order                                     |
| `summary`      | `documents` is the number uploaded, not the number analysed                                                                                                           |
| `failures`     | Per-document failures from digitisation and Stage A                                                                                                                   |
| `warnings`     | See [warning types](#warning-types)                                                                                                                                   |
| `processing`   | `method` is `text`, `text-layer` or `sarvam-ocr`. `pages` may be `null`                                                                                               |

`blocked_by[]` and `blocks[]` inside each extraction embed whole extraction objects, so the payload contains repeated data.

### Extraction fields

The model-derived fields are described in [Extraction pipeline](extraction-pipeline.md#what-the-record-contains). The server adds:

| Field                                                                            | Meaning                                                                                                            |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `id`, `doc_id`                                                                   | `doc1`, `doc2`, ... in upload order. Stable within a response                                                      |
| `doc_index`                                                                      | Zero-based upload index                                                                                            |
| `file_name`                                                                      | Sanitised file name, or title, or `doc_N`                                                                          |
| `deadline_context`                                                               | `active`, `conditional`, `historical`, `unknown`                                                                   |
| `deadline_days`                                                                  | Whole calendar days from today in `timezone`; `null` unless the context is `active` and an absolute date was given |
| `deadline_status`                                                                | `overdue`, `due_today`, `upcoming`, `relative_unanchored`, `historical`, `conditional`, `unknown`                  |
| `verification_status`                                                            | `verified`, `partially_verified`, `unverified`                                                                     |
| `validation_status`                                                              | Detail behind `verification_status` (page and evidence status and reasons)                                         |
| `field_evidence_status[]`                                                        | `field_evidence` entries plus their individual verification status                                                 |
| `field_evidence_coverage`                                                        | `{ verified, required, ratio }`                                                                                    |
| `conflicts`                                                                      | Strings describing Stage B conflicts that involve this document                                                    |
| `is_blocked`, `is_fuzzy_only`, `blocked_by[]`, `blocks[]`, `fuzzy_suggestions[]` | Dependency results ([Planning engine](planning-engine.md#dependency-resolution))                                   |
| `cycle_detected`, `cycle_path`                                                   | Cycle membership                                                                                                   |

Plan items add `priority_rank` (1-based), `status` (`conditional`, `cycle`, `overdue`, `blocked`, `urgent`, `ready`), `effective_deadline_days` and `priority_reason`.

### Warning types

| `type`                           | Meaning                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| `partial_ocr`                    | OCR completed only partially; `pages_processed` and `pages_failed` are included when known |
| `low_text_quality`               | A PDF's text layer looked like garbage and was sent to OCR instead                         |
| `sectioned`                      | A long document was split into sections                                                    |
| `validation`                     | One or more extractions could not be fully verified; `details[]` lists them                |
| `invalid_dependency_edge`        | A Stage B edge referenced an unknown document and was dropped                              |
| `unverified_dependency_evidence` | A Stage B edge's quote could not be verified and the edge was dropped                      |
| `dependency_analysis_failed`     | Stage B failed or returned an invalid shape; the plan has no model edges                   |
| `conflicts`                      | Stage B reported conflicts; `count` is included                                            |

The bundled client also handles a `truncation` warning type, but the server never emits it.

## POST /api/translate

`Content-Type: application/json`. Maximum duration 60 s.

```bash
curl -sS http://localhost:3000/api/translate \
  -H 'Content-Type: application/json' \
  -d '{"text":"You have 1 task to complete.","target":"hi-IN"}'
```

| Field    | Type   | Constraint                           |
| -------- | ------ | ------------------------------------ |
| `text`   | string | Non-empty, at most 12,000 characters |
| `target` | string | A code from [Languages](#languages)  |

Source language is fixed at `en-IN`; if `target` is `en-IN` the text is returned unchanged.

Response `200`: `{ "translated": "…", "target": "hi-IN" }`.

Behaviour:

- Text is split into chunks of at most 1,800 characters, preferring paragraph, then sentence (including Devanagari danda marks), then hard boundaries. Chunks are translated with at most 4 in flight and rejoined with a blank line between them.
- Each chunk is sent with `model: "sarvam-translate:v1"`, `mode: "formal"`, `numerals_format: "international"`.
- If any chunk fails, the remaining in-flight chunks are aborted and the request fails.
- A `Content-Length` over 64 KB is rejected with `413 FILE_TOO_LARGE`. Requests without that header are not checked at the byte level; the 12,000-character check still applies.
- Client cancellation is reported as `500 INTERNAL` ("Request was cancelled."), unlike `/api/extract`, which returns `499`.
- Limits: per-IP `TRANSLATE_LIMIT_PER_10_MIN` (when the client IP is known) and `GLOBAL_TRANSLATE_PER_HOUR`.

## GET /api/health

```json
{ "ok": true, "version": "0.1.0", "configured": true }
```

- `version` comes from `package.json`.
- `configured` is true when a key is set and is not the placeholder `your_sarvam_api_key_here`. It does not call Sarvam, so it says nothing about whether the key is valid.
- In production, `lib/env.js` throws on import if the key is missing or the placeholder, and this route imports it, so a misconfigured production server returns an error here rather than `configured: false`.
- The Docker `HEALTHCHECK` and the Railway health check both use this path.

## Error contract

All error responses from `/api/extract` and `/api/translate` use this shape:

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests. Please try again in 8 minute(s).",
    "request_id": "6f1c…",
    "retry_after_sec": 480,
    "failures": [{ "file_name": "a.pdf", "code": "OCR_FAILED", "message": "…" }]
  }
}
```

`retry_after_sec` is present for rate limiting and busy responses and is mirrored in the `Retry-After` header. `failures` is present when per-document failures explain the error. Upstream response bodies and key names are never included. The same `request_id` appears in server logs.

| Code                    | HTTP | Raised when                                                                                      |
| ----------------------- | ---- | ------------------------------------------------------------------------------------------------ |
| `INVALID_REQUEST`       | 400  | Body is not multipart or JSON as expected, bad metadata, empty text, unsupported target language |
| `TOO_MANY_FILES`        | 400  | More than 5 documents                                                                            |
| `FILE_TOO_LARGE`        | 413  | A file over 25 MB, total over 60 MB, oversized `Content-Length`, or translate body over 64 KB    |
| `RATE_LIMITED`          | 429  | Per-IP limit exceeded. Includes `RateLimit-*` headers                                            |
| `SERVER_BUSY`           | 503  | Global hourly budget exhausted, or `MAX_CONCURRENT_EXTRACTS` reached                             |
| `NO_READABLE_DOCUMENTS` | 422  | Every document failed digitisation                                                               |
| `EXTRACTION_INVALID`    | 502  | Every document failed Stage A                                                                    |
| `UPSTREAM_AUTH`         | 503  | Sarvam returned 401/403 in a path that reaches the top-level handler (Stage B, translate)        |
| `UPSTREAM_RATE_LIMITED` | 503  | Sarvam returned 429 in such a path, after retries. `retry_after_sec` is 60                       |
| `UPSTREAM_TIMEOUT`      | 504  | The 285 s request deadline, an aborted upstream call, or a 504 from Sarvam                       |
| `UPSTREAM_ERROR`        | 502  | Other Sarvam failures in such a path                                                             |
| `INTERNAL`              | 500  | Anything unexpected                                                                              |

Per-document failure codes (inside `failures[]`, not top-level): `UNSUPPORTED_TYPE`, `PDF_ENCRYPTED`, `PAGE_LIMIT`, `OCR_FAILED`, `DOCUMENT_TOO_LONG`, `EXTRACTION_FAILED`. `lib/apiError.js` also lists some of these in its status map, but they are only used inside `failures[]`.

A client disconnect on `/api/extract` returns status `499` with an empty body.

## Rate-limit headers

Sent with per-IP `429` responses: `Retry-After` (seconds), `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (Unix epoch seconds). Global-budget and concurrency rejections (`503`) carry `Retry-After` only (60 s and 30 s respectively).

The per-IP limit only applies when the client IP can be determined, which requires `TRUSTED_PROXY_HOPS` to be set. See [Configuration](configuration.md#reverse-proxies-and-client-ip).

## Limits

| Limit                          | Value                                           | Source                               |
| ------------------------------ | ----------------------------------------------- | ------------------------------------ |
| Documents per analysis         | 5                                               | `MAX_FILES`                          |
| File size                      | 25 MB                                           | `MAX_FILE_BYTES`                     |
| Total upload                   | 60 MB (62 MB at the `Content-Length` pre-check) | `MAX_TOTAL_BYTES`                    |
| Text document size             | 1,000,000 characters                            | `MAX_TEXT_CHARS`                     |
| Characters per Stage A section | 50,000                                          | `MAX_CHARS_PER_SECTION`              |
| Sections per document          | 6 (about 300,000 characters)                    | `MAX_SECTIONS_PER_DOC`               |
| Scanned PDF pages              | 10                                              | `MAX_PARSE_PAGES` in `lib/sarvam.js` |
| OCR text per document          | 2 MB                                            | `MAX_OCR_TEXT_PER_DOC`               |
| Translate input                | 12,000 characters                               | `MAX_TRANSLATE_CHARS`                |
| Translate chunk                | 1,800 characters                                | `TRANSLATE_CHUNK`                    |

Constants live in `lib/limits.js` and are shared by the client and the server.

## Languages

Defined in `lib/languages.js`. The same 23 codes are used for the document-language hint and for translation targets:

`en-IN`, `hi-IN`, `bn-IN`, `ta-IN`, `te-IN`, `mr-IN`, `gu-IN`, `kn-IN`, `ml-IN`, `od-IN`, `pa-IN`, `as-IN`, `ur-IN`, `ne-IN`, `sa-IN`, `kok-IN`, `mai-IN`, `doi-IN`, `brx-IN`, `ks-IN`, `sd-IN`, `mni-IN`, `sat-IN`.

The codes come from Sarvam's published reference. Only English to Hindi translation has been exercised against the live API by the preflight scripts. Odia is flagged in the code: Sarvam's documentation shows `or-IN`, while this project uses `od-IN`, and neither has been confirmed against the live endpoint.
