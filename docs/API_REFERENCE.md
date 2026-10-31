# API Reference

PathWise exposes two main API endpoints for document analysis and translation.

## Base URL

```
Local Development: http://localhost:3000
Production: https://your-domain.com
```

## Authentication

PathWise uses server-side API keys for Sarvam AI. Client-side requests do not require authentication, but are rate-limited by IP address.

## Endpoints

### POST /api/extract

Analyzes multiple documents and returns a prioritized action plan.

#### Request

**Content-Type:** `multipart/form-data`

**Parameters:**

| Field                   | Type        | Required    | Description                               |
| ----------------------- | ----------- | ----------- | ----------------------------------------- |
| `documents`             | JSON string | Yes         | Array of document metadata (see below)    |
| `language`              | String      | No          | Document language code (default: `en-IN`) |
| `file_0`, `file_1`, ... | File        | Conditional | Actual file data for PDFs and images      |

**Document Metadata Schema:**

```json
[
  {
    "id": "unique-id",
    "title": "Document Title",
    "fileName": "file.pdf",
    "fileType": "pdf", // "pdf", "image", or "text"
    "text": "Document content for text files",
    "source": "Upload"
  }
]
```

**Example Request:**

```javascript
const formData = new FormData();

// Add metadata
const metadata = [
  { id: "doc1", title: "Notice", fileName: "notice.pdf", fileType: "pdf" },
  { id: "doc2", title: "Form", text: "Form content...", fileType: "text" },
];
formData.append("documents", JSON.stringify(metadata));
formData.append("language", "en-IN");

// Add files
formData.append("file_0", pdfFile, "notice.pdf");
// file_1 not needed for text-type documents

const response = await fetch("/api/extract", {
  method: "POST",
  body: formData,
});

const result = await response.json();
```

#### Response

**Success (200 OK):**

```json
{
  "extractions": [
    {
      "id": "doc1",
      "document_type": "Notice",
      "organization": "Organization Name",
      "title": "Document Title",
      "required_action": "Complete action",
      "required_documents": ["Document 1", "Document 2"],
      "prerequisites": ["Other action"],
      "deadline": "2025-03-15",
      "deadline_days": 30,
      "appointment_date": "2025-03-10",
      "appointment_time": "10:00",
      "office_location": "Address",
      "estimated_time": "30 minutes",
      "fees": "Rs. 500",
      "reference_number": "REF123",
      "government_department": null,
      "consequence": "Penalty applies",
      "confidence": 0.95,
      "source_document": "notice.pdf",
      "source_page": "Page 1",
      "dependency_reason": "Requires completion of...",
      "evidence_snippet": "Quote from document",
      "information_type": "explicitly_stated",
      "conflicts": [],
      "is_blocked": false,
      "blocked_by": [],
      "blocks": [],
      "cycle_detected": false,
      "validation_status": {
        "source_page_valid": true,
        "evidence_valid": true,
        "source_page_reason": "Page 1 exists",
        "evidence_reason": "Evidence found in source",
        "overall_verified": true
      }
    }
  ],
  "source": "sarvam",
  "failures": [
    {
      "fileName": "corrupted.pdf",
      "error": "Could not read PDF"
    }
  ],
  "processing": [
    {
      "fileName": "notice.pdf",
      "method": "text-layer",
      "pages": 2,
      "ms": 150
    }
  ],
  "warnings": [
    {
      "type": "truncation",
      "fileName": "large.pdf",
      "message": "Document was truncated..."
    },
    {
      "type": "validation",
      "message": "2 extraction(s) could not be fully verified...",
      "details": [...]
    }
  ]
}
```

**Error Responses:**

| Status | Error                        | Description                          |
| ------ | ---------------------------- | ------------------------------------ |
| 400    | Invalid upload               | Malformed request or invalid files   |
| 400    | No documents provided        | Empty upload                         |
| 400    | Too many documents           | Exceeds 5 file limit                 |
| 413    | File too large               | Individual file >25MB or total >60MB |
| 413    | Upload too large             | Total exceeds size limit             |
| 422    | Document Processing Failed   | All documents failed to process      |
| 429    | Too many requests            | Rate limit exceeded (10 per 10 min)  |
| 500    | Processing Error             | Server error                         |
| 502    | Invalid Extraction Structure | AI returned malformed data           |

**Error Response Format:**

```json
{
  "error": "Error title",
  "details": "Detailed error message",
  "solution": "Suggested fix (optional)",
  "failures": [
    {
      "fileName": "file.pdf",
      "error": "Specific error"
    }
  ]
}
```

#### Rate Limiting

- **Limit:** 10 requests per 10 minutes per IP
- **Header:** None (handled server-side)
- **Retry:** Wait time shown in error message

#### Processing Time

- **Digital PDFs:** 5-15 seconds
- **Scanned PDFs:** 15-40 seconds (depends on page count)
- **Multiple documents:** Processed in parallel

#### Limits

- **Max files:** 5 per request
- **Max file size:** 25 MB per file
- **Max total size:** 60 MB per request
- **Max pages (scanned):** 10 pages per PDF
- **Max text per document:** 60,000 characters (truncated with warning)

---

### POST /api/translate

Translates text into a target Indian language.

#### Request

**Content-Type:** `application/json`

**Body:**

```json
{
  "text": "Text to translate",
  "target": "hi-IN"
}
```

**Parameters:**

| Field    | Type   | Required | Description                                    |
| -------- | ------ | -------- | ---------------------------------------------- |
| `text`   | String | Yes      | Text to translate (max 12,000 chars)           |
| `target` | String | Yes      | Target language code (see supported languages) |

**Supported Language Codes:**

| Code     | Language  | Native    |
| -------- | --------- | --------- |
| `en-IN`  | English   | English   |
| `hi-IN`  | Hindi     | हिन्दी    |
| `bn-IN`  | Bengali   | বাংলা     |
| `ta-IN`  | Tamil     | தமிழ்     |
| `te-IN`  | Telugu    | తెలుగు    |
| `mr-IN`  | Marathi   | मराठी     |
| `gu-IN`  | Gujarati  | ગુજરાતી   |
| `kn-IN`  | Kannada   | ಕನ್ನಡ     |
| `ml-IN`  | Malayalam | മലയാളം    |
| `od-IN`  | Odia      | ଓଡ଼ିଆ     |
| `pa-IN`  | Punjabi   | ਪੰਜਾਬੀ    |
| `as-IN`  | Assamese  | অসমীয়া   |
| `ur-IN`  | Urdu      | اردو      |
| `ne-IN`  | Nepali    | नेपाली    |
| `sa-IN`  | Sanskrit  | संस्कृतम् |
| `kok-IN` | Konkani   | कोंकणी    |
| `mai-IN` | Maithili  | मैथिली    |
| `doi-IN` | Dogri     | डोगरी     |
| `brx-IN` | Bodo      | बर'       |
| `ks-IN`  | Kashmiri  | کٲشُر     |
| `sd-IN`  | Sindhi    | سنڌي      |
| `mni-IN` | Manipuri  | মৈতৈলোন্  |
| `sat-IN` | Santali   | ᱥᱟᱱᱛᱟᱲᱤ   |

#### Response

**Success (200 OK):**

```json
{
  "translated": "अनुवादित पाठ",
  "target": "hi-IN"
}
```

**Error Responses:**

| Status | Error                | Description                          |
| ------ | -------------------- | ------------------------------------ |
| 400    | Invalid request      | Malformed JSON body                  |
| 400    | Nothing to translate | Empty text field                     |
| 400    | Unsupported language | Invalid language code                |
| 413    | Text too long        | Exceeds 12,000 characters            |
| 429    | Too many requests    | Rate limit exceeded (120 per 10 min) |
| 500    | Translation Error    | Server error                         |
| 502    | Translation Error    | Sarvam API error                     |

#### Rate Limiting

- **Limit:** 120 requests per 10 minutes per IP
- **Retry:** Wait time shown in error message

#### Processing Details

- **Chunking:** Automatic splitting at 1,800 chars per chunk
- **Chunk boundaries:** Preserves paragraphs and sentences
- **Special characters:** Handles Devanagari sentence terminators (।, ॥)
- **Numerals:** Uses international format (0-9) to preserve numbers
- **Response time:** 2-5 seconds typical

---

## Error Handling

### General Error Response Format

```json
{
  "error": "Error Title",
  "details": "Human-readable error message"
}
```

### HTTP Status Code Summary

| Code | Meaning               | Action                  |
| ---- | --------------------- | ----------------------- |
| 200  | Success               | Process response        |
| 400  | Bad Request           | Fix request format      |
| 413  | Payload Too Large     | Reduce file size        |
| 422  | Unprocessable Entity  | Check file content      |
| 429  | Too Many Requests     | Wait and retry          |
| 500  | Internal Server Error | Retry or report         |
| 502  | Bad Gateway           | Sarvam API issue, retry |

### Retry Strategy

**Rate Limiting (429):**

- Wait time provided in error message
- Typically 1-10 minutes

**Server Errors (500, 502):**

- Exponential backoff: 1s, 2s, 4s
- Max 3 retries
- Report if persistent

**Client Errors (400, 413, 422):**

- Do not retry
- Fix request and resubmit

---

## Rate Limiting Details

### Configuration

Set via environment variables:

```env
RATE_LIMIT_PER_10_MIN=10           # /api/extract limit
TRANSLATE_LIMIT_PER_10_MIN=120     # /api/translate limit
TRUST_PROXY=false                   # Set true behind reverse proxy
```

### Implementation

- **Algorithm:** Fixed window
- **Storage:** In-memory (resets on server restart)
- **Identifier:** Client IP address
- **Window:** 10 minutes

### Trusted Proxy Mode

When `TRUST_PROXY=true`:

- Uses `X-Forwarded-For` header (first IP)
- Required for Railway, Render, Vercel deployments
- **Security:** Only enable behind trusted reverse proxy

When `TRUST_PROXY=false` (default):

- Does NOT trust `X-Forwarded-For` (prevents spoofing)
- Safer for direct deployments

---

## Testing the API

### Using cURL

**Extract documents:**

```bash
curl -X POST http://localhost:3000/api/extract \
  -F 'documents=[{"id":"doc1","title":"Test","fileName":"test.txt","fileType":"text","text":"Sample text"}]' \
  -F 'language=en-IN'
```

**Translate text:**

```bash
curl -X POST http://localhost:3000/api/translate \
  -H 'Content-Type: application/json' \
  -d '{"text":"Hello world","target":"hi-IN"}'
```

### Using JavaScript

See [Development Guide](DEVELOPMENT.md) for integration examples.

---

## Webhook/Callback Support

PathWise does not currently support webhooks. Processing is synchronous with long-polling.

**Future consideration:** Async processing with webhook callbacks for large batches.

---

## SDK / Client Libraries

**Official SDK:** None currently

**Community SDKs:** None currently

**Integration:** Use standard HTTP client (fetch, axios, etc.)

---

## Versioning

**Current version:** v1 (implied in routes)

**Breaking changes:** Will be announced with new major version routes (e.g., `/api/v2/extract`)

---

## Support

- [Troubleshooting Guide](TROUBLESHOOTING.md)
- [FAQ](FAQ.md)
- [GitHub Issues](https://github.com/your-org/pathwise/issues)
