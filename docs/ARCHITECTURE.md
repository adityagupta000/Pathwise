# Architecture Overview

PathWise is a single-service Next.js application that orchestrates document processing, AI extraction, dependency analysis, and translation.

## System Architecture

```mermaid
graph TB
    subgraph Client["Browser Client Layer"]
        direction LR
        UI1["Upload UI<br/><small>File selection<br/>5 files max, 60MB total</small>"]
        UI2["Workflow UI<br/><small>Action cards<br/>Dependencies graph<br/>Priority timeline</small>"]
        UI3["Translation UI<br/><small>22 Indian + English<br/>Real-time translation</small>"]
    end

    subgraph Server["Next.js Application Server - Node.js 22"]
        direction TB

        subgraph Routes["API Routes Layer"]
            direction LR
            R1["POST /api/extract<br/><small>Rate: 5 req/min/IP<br/>Timeout: 120s<br/>Returns JSON</small>"]
            R2["POST /api/translate<br/><small>Rate: 20 req/min/IP<br/>Chunk size: 2000 chars<br/>Returns JSON</small>"]
        end

        subgraph DocPipeline["Document Processing Pipeline"]
            direction TB
            D1["Text Extraction<br/><small>lib/pdfText.js<br/>unpdf library<br/>Local processing</small>"]
            D2["OCR Processing<br/><small>lib/sarvam.js<br/>parseDocument function<br/>Sarvam Parse API</small>"]
            D3["Structured Extraction<br/><small>lib/extraction.js<br/>extractStructured function<br/>sarvam-105b model</small>"]

            D1 -->|"Digital PDF text"| D3
            D1 -->|"Scanned pages detected"| D2
            D2 -->|"OCR text with coordinates"| D3
        end

        subgraph BizLogic["Business Logic Layer"]
            direction TB
            B1["Evidence Validation<br/><small>lib/validation.js<br/>validateExtractions function<br/>Page + snippet verification</small>"]
            B2["Dependency Resolution<br/><small>lib/engines.js<br/>resolveDependencies function<br/>8-char min, cycle detection</small>"]
            B3["Priority Sorting<br/><small>lib/engines.js<br/>buildPriorityList function<br/>Deadline + blocker analysis</small>"]

            B1 --> B2
            B2 --> B3
        end

        subgraph TransPipeline["Translation Pipeline"]
            direction TB
            T1["Summary Builder<br/><small>lib/summary.js<br/>buildSummaryText function<br/>English plaintext</small>"]
            T2["Text Chunker<br/><small>lib/sarvam.js<br/>chunkText function<br/>2000 char limit</small>"]
            T3["Batch Translator<br/><small>lib/sarvam.js<br/>translateChunk function<br/>Parallel processing</small>"]

            T1 --> T2
            T2 --> T3
        end

        R1 --> DocPipeline
        DocPipeline --> BizLogic
        R2 --> TransPipeline
    end

    subgraph External["Sarvam AI Platform - External Services"]
        direction TB
        E1["Document Parse API<br/><small>POST api.sarvam.ai/parse<br/>OCR + structure extraction<br/>10 pages max per call</small>"]
        E2["Chat Completion API<br/><small>POST api.sarvam.ai/chat<br/>Model: sarvam-105b<br/>JSON structured output</small>"]
        E3["Translation API<br/><small>POST api.sarvam.ai/translate<br/>Model: v1<br/>22 Indian languages</small>"]
    end

    Client <-->|"Multipart form-data<br/>application/json responses"| Routes
    BizLogic -->|"Validated JSON<br/>actions + warnings array"| Client
    TransPipeline -->|"JSON with translated text"| Client

    DocPipeline -.->|"HTTPS POST<br/>Authorization: Bearer"| E1
    DocPipeline -.->|"HTTPS POST<br/>Authorization: Bearer"| E2
    TransPipeline -.->|"HTTPS POST<br/>Authorization: Bearer"| E3

    classDef clientStyle fill:#e3f2fd,stroke:#1976d2,stroke-width:3px,color:#000
    classDef serverStyle fill:#f3e5f5,stroke:#7b1fa2,stroke-width:3px,color:#000
    classDef externalStyle fill:#fff3e0,stroke:#f57c00,stroke-width:3px,color:#000
    classDef pipelineStyle fill:#e8f5e9,stroke:#388e3c,stroke-width:2px,color:#000
    classDef routeStyle fill:#fff9c4,stroke:#f9a825,stroke-width:2px,color:#000

    class Client clientStyle
    class Server serverStyle
    class External externalStyle
    class DocPipeline,BizLogic,TransPipeline pipelineStyle
    class Routes routeStyle
```

## Component Breakdown

### 1. Frontend (React/Next.js)

**Location:** `/app` and `/components`

**Responsibilities:**

- Document upload and file handling
- Language selection
- Result visualization
- Translation interface

**Key Components:**

- `DocumentCards.js` - Upload and document management
- `SimpleWorkflow.js` - Action plan display
- `TranslatedSummary.js` - Multi-language output
- `LoadingAnimation.js` - Processing feedback

### 2. API Layer

**Location:** `/app/api`

**Routes:**

#### POST `/api/extract`

- Accepts multipart form data (files + metadata)
- Orchestrates document processing pipeline
- Returns structured extractions with validation

#### POST `/api/translate`

- Accepts text and target language
- Chunks long text automatically
- Returns translated content

### 3. Document Processing Pipeline

**Location:** `/lib`

#### Stage 1: Text Extraction (`pdfText.js`, `sarvam.js`)

- **Digital PDFs:** Extract text layer locally using `unpdf` (fast, free)
- **Scanned PDFs/Images:** Send to Sarvam Document AI Parse (OCR)
- Detects mixed PDFs (some digital, some scanned pages)
- Preserves page boundaries for evidence validation

#### Stage 2: Structured Extraction (`extraction.js`, `sarvam.js`)

- Sends all document texts to Sarvam chat model (sarvam-105b)
- Uses structured JSON schema for consistent output
- Extracts actions, deadlines, dependencies, evidence
- Returns confidence scores and source references

#### Stage 3: Validation (`validation.js`)

- Verifies page numbers exist in source documents
- Validates evidence snippets against source text
- Marks unverified extractions
- Generates validation warnings

#### Stage 4: Dependency Analysis (`engines.js`)

- Exact matching on action names
- Evidence-based fuzzy matching (8+ char minimum)
- Prevents false positives from generic terms
- Detects circular dependencies
- Tracks blocking relationships

#### Stage 5: Prioritization (`engines.js`)

- Unblocked tasks before blocked
- Tasks that unblock others prioritized
- Earlier deadlines first
- Unknown deadlines after known ones
- Confidence as tie-breaker

#### Stage 6: Summary & Translation (`summary.js`, `sarvam.js`)

- Builds plain-language English summary
- Chunks text for translation (2000 char limit)
- Translates to target language
- Preserves formatting and order

### 4. Utility Modules

**Rate Limiting** (`limiter.js`)

- In-memory fixed-window rate limiter
- Separate limits for extraction and translation
- Supports trusted proxy detection (X-Forwarded-For)
- Automatic bucket cleanup

**Language Support** (`languages.js`)

- 23 language definitions (22 Indian + English)
- RTL script detection
- Native and romanized names

## Data Flow

### Document Upload to Analysis

```mermaid
sequenceDiagram
    actor User
    participant UI as DocumentCards Component
    participant API as POST /api/extract
    participant Limit as Rate Limiter
    participant Dig as digitise()
    participant PDF as readPdfTextLayer()
    participant OCR as parseDocument()
    participant Build as buildUserMessage()
    participant Extract as extractStructured()
    participant Val as validateExtractions()
    participant Dep as resolveDependencies()
    participant Pri as buildPriorityList()

    User->>UI: Upload files (max 5, 60MB)
    UI->>UI: Validate file types and sizes
    UI->>API: POST FormData (files + metadata)
    API->>Limit: Check rate limit (5/min per IP)
    
    alt Rate limit exceeded
        Limit-->>API: 429 Too Many Requests
        API-->>UI: Error response
    else Within limit
        Limit->>Dig: Process files
        
        loop For each file
            alt PDF file
                Dig->>PDF: Try local text extraction
                alt Has digital text
                    PDF-->>Dig: Text with page numbers
                else Scanned pages detected
                    Dig->>OCR: Sarvam Parse API
                    OCR-->>Dig: OCR text + coordinates
                end
            else Image file (PNG/JPG)
                Dig->>OCR: Sarvam Parse API
                OCR-->>Dig: OCR text + coordinates
            else Text file
                Dig-->>Dig: Use content as-is
            end
        end
        
        Dig->>Build: All document texts
        Build->>Build: Format system + user prompt
        Build->>Build: Track truncations (10 pages max)
        Build->>Extract: POST to Sarvam Chat API
        
        Extract->>Extract: sarvam-105b structured output
        Extract-->>Val: Array of extracted actions
        
        Val->>Val: validateSourcePage() for each
        Val->>Val: validateEvidenceSnippet() for each
        Val->>Val: Mark unverified extractions
        Val-->>Dep: Validated extractions + warnings
        
        Dep->>Dep: Exact name matching
        Dep->>Dep: Fuzzy matching (8-char min)
        Dep->>Dep: Check for circular dependencies
        Dep-->>Pri: Dependency graph
        
        Pri->>Pri: Sort by unblocked first
        Pri->>Pri: Sort by deadline
        Pri->>Pri: Sort by confidence
        Pri-->>API: Priority ordered list
        
        API-->>UI: JSON (actions, warnings, metadata)
        UI->>User: Display workflow cards
    end
```

### Translation Flow

```mermaid
sequenceDiagram
    actor User
    participant UI as TranslatedSummary Component
    participant Sum as buildSummaryText()
    participant API as POST /api/translate
    participant Limit as Rate Limiter
    participant Chunk as chunkText()
    participant Trans as translateChunk()
    participant Sarvam as Sarvam Translate API

    User->>UI: Click "Translate to [Language]"
    UI->>Sum: Request English summary
    Sum->>Sum: Build plaintext from extractions
    Sum->>Sum: Include actions, deadlines, dependencies
    Sum->>Sum: Add warnings (cycles, conflicts)
    Sum-->>API: POST {text, target_language_code}
    
    API->>Limit: Check rate limit (20/min per IP)
    
    alt Rate limit exceeded
        Limit-->>API: 429 Too Many Requests
        API-->>UI: Error response
    else Within limit
        Limit->>Chunk: Process translation
        Chunk->>Chunk: Split at sentence boundaries
        Chunk->>Chunk: Max 2000 chars per chunk
        
        loop For each chunk
            Chunk->>Trans: Translate chunk
            Trans->>Sarvam: POST api.sarvam.ai/translate
            Note over Sarvam: Model: v1<br/>Source: en-IN<br/>Target: language_code
            Sarvam-->>Trans: Translated chunk
        end
        
        Trans->>API: Join all translated chunks
        API-->>UI: JSON {translated, target}
        UI->>User: Display translated plan
    end
```

## Key Design Decisions

### Single-Service Architecture

- **Why:** Simplicity, easier deployment, lower latency
- **Trade-off:** No independent scaling of document processing vs web UI
- **Mitigation:** Horizontal scaling via load balancer if needed

### Client-Side File Handling

- **Why:** Avoid file size limits in serverless environments
- **Implementation:** Files sent as multipart form data, processed in API route
- **Benefit:** Supports large scanned PDFs

### Eager Text Extraction

- **Why:** Digital PDF text extraction is instant and free
- **Implementation:** Try local extraction first, only OCR if needed
- **Benefit:** 10-50x faster for digital documents

### One LLM Call Per Upload

- **Why:** Cross-document reasoning requires seeing all documents together
- **Trade-off:** Longer response time for first result
- **Benefit:** Better dependency detection

### Evidence Validation Post-Extraction

- **Why:** LLMs can hallucinate page numbers and quotes
- **Implementation:** Validate after extraction, mark confidence
- **Benefit:** Transparency about unverified claims

### In-Memory Rate Limiting

- **Why:** Simple, fast, no external dependencies
- **Trade-off:** State lost on restart, doesn't work across multiple instances
- **When to upgrade:** Use Redis when scaling horizontally

## Scalability Considerations

### Current Limits

- **Single instance:** Handles ~50-100 concurrent analyses
- **Rate limiting:** Per-IP, in-memory (resets on restart)
- **File storage:** No persistence (processed on-the-fly)

### Scaling Strategies

**Horizontal Scaling:**

1. Add Redis for distributed rate limiting
2. Use load balancer (sticky sessions not needed)
3. Set `TRUST_PROXY=true` in environment

**Vertical Scaling:**

- Increase Node.js memory limit
- More CPU cores = more concurrent Sarvam API calls

**Optimization:**

- Cache Sarvam Parse results (if same file uploaded repeatedly)
- Pre-warm model with common document types
- Stream results as they become available

## Security Architecture

### Input Validation

- File type checking (MIME + extension)
- File size limits (25 MB per file, 60 MB total)
- Document count limits (5 files max)

### API Protection

- Rate limiting per IP
- Trusted proxy configuration
- API key validation
- Request timeout enforcement

### Data Privacy

- No document storage
- No logging of document contents
- Transient processing only
- Clear warning about external API usage

### Error Handling

- Never expose API keys in responses
- Sanitize error messages
- No stack traces in production

## Performance Characteristics

### Typical Response Times

- **Digital PDF (2 pages):** 5-8 seconds
- **Scanned PDF (5 pages):** 15-25 seconds
- **Mixed documents (3 files):** 20-35 seconds
- **Translation:** 2-5 seconds

### Bottlenecks

1. **Sarvam Parse OCR:** 3-8 seconds per page
2. **Structured extraction:** 5-15 seconds (depends on document count)
3. **Translation:** 1-3 seconds per chunk

### Optimization Opportunities

- Parallel document processing (already implemented)
- Streaming extraction results (not yet implemented)
- Client-side preview while processing (not yet implemented)

## Technology Stack

- **Framework:** Next.js 16 (React 19)
- **Runtime:** Node.js 22
- **PDF Processing:** unpdf
- **AI Models:** Sarvam AI (sarvam-105b, sarvam-vision, sarvam-translate:v1)
- **Testing:** Vitest
- **Deployment:** Docker (standalone output)

## File Structure

```
sarvam.ai/
├── app/
│   ├── api/              # API routes
│   │   ├── extract/
│   │   └── translate/
│   ├── layout.js         # Root layout
│   ├── page.js           # Main page
│   └── globals.css       # Styles
├── components/           # React components
├── lib/                  # Business logic
│   ├── engines.js        # Dependency & priority
│   ├── extraction.js     # Schema & prompts
│   ├── validation.js     # Evidence validation
│   ├── sarvam.js         # API client
│   ├── summary.js        # Summary builder
│   ├── limiter.js        # Rate limiting
│   ├── languages.js      # Language definitions
│   └── pdfText.js        # PDF text extraction
├── docs/                 # Documentation
├── public/               # Static assets
├── tests/                # Test files (*.test.js)
├── Dockerfile            # Container config
├── package.json          # Dependencies
└── vitest.config.js      # Test config
```

## Next Steps

- [How It Works](HOW_IT_WORKS.md) - Detailed processing walkthrough
- [Development Guide](DEVELOPMENT.md) - Set up local development
- [API Reference](API_REFERENCE.md) - Endpoint specifications
