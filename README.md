# PathWise

PathWise is a Next.js web application for turning a small set of user-provided documents into a suggested action plan. It uses Sarvam AI for document OCR, structured extraction, and on-demand translation of the generated summary.

The results are machine-generated interpretations, not verified instructions. Check actions, dates, dependencies, and cited evidence against the original documents before acting.

## What the current application does

- Accepts text, PDF, PNG, JPEG, and WebP input through the browser interface. WebP images are converted to PNG before submission.
- Extracts one primary action per document, checks extracted fields against available source evidence, and can analyze cross-document dependencies and conflicts.
- Builds an ordered plan with deadline and dependency details, plus an English summary and supporting evidence where available.
- Translates the summary on demand. The action table and the rest of the interface remain in English.

It does not execute actions, retain a document history, or provide user accounts. Documents are sent to Sarvam when its services are needed. See [data handling and limitations](./docs/operations.md#data-handling-and-operational-limitations) before using sensitive material.

## Run locally

Requirements: Node.js `>=22.13.0`, npm `>=10.0.0`, and a Sarvam API key for processing requests.

```powershell
npm ci
Copy-Item .env.example .env.local
# Set SARVAM_API_KEY in .env.local.
npm run dev
```

Open `http://localhost:3000`. The checked-in environment example contains stale setting names; consult [runtime configuration](./docs/operations.md#runtime-configuration) for the names the application actually reads.

## Validate

```powershell
npm run lint
npm test
npm run build
```

The repository's tests mock provider calls; passing them does not validate live Sarvam availability or output quality.

## Documentation

- [Documentation index](./docs/README.md)
- [Architecture](./docs/architecture.md)
- [Repository map](./docs/project-map.md)
- [API reference](./docs/api-reference.md)
- [Operations and development](./docs/operations.md)
- [Live benchmark report](./PERFORMANCE-BENCHMARK.md), with scope and quality caveats

## Source layout

```text
app/                  Next.js pages and API route handlers
components/           Upload, progress, notices, plan, and summary UI
lib/                  Extraction, validation, provider, planning, and date helpers
scripts/preflight/    Manual Sarvam preflight scripts
docs/                 Project, API, and operations documentation
```

The project is implemented in JavaScript. Deployment descriptors for Docker, Railway, and Vercel are present in the repository; their presence does not imply a live deployment.
