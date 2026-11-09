# Configuration

All runtime configuration is read through `lib/env.js`, which validates `process.env` with Zod when the module is first imported and throws a descriptive error on a bad value. Code should import `env` instead of reading `process.env` directly. (Two small exceptions exist; see [APP_TIMEZONE](#app_timezone).)

Contents: [Environment variables](#environment-variables) · [Notes](#notes-on-specific-variables) · [Reverse proxies](#reverse-proxies-and-client-ip) · [Compile-time limits](#compile-time-limits) · [Retry and timeout policy](#retry-and-timeout-policy) · [Example](#example-envlocal)

## Environment variables

Integer variables must be non-negative integers; an empty string counts as unset.

| Variable                     | Default                 | Description                                                                                                                                                                                                                    |
| ---------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SARVAM_API_KEY`             | none                    | Sarvam API key. Required at runtime when `NODE_ENV=production`; the placeholder `your_sarvam_api_key_here` is rejected there. Optional in development and tests, and during `next build` (`NEXT_PHASE=phase-production-build`) |
| `SARVAM_BASE_URL`            | `https://api.sarvam.ai` | API base URL                                                                                                                                                                                                                   |
| `SARVAM_CHAT_MODEL`          | `sarvam-105b`           | Model for Stage A and Stage B                                                                                                                                                                                                  |
| `SARVAM_MAX_TOKENS`          | `4096`                  | `max_tokens` for every chat call                                                                                                                                                                                               |
| `SARVAM_REASONING_EFFORT`    | unset                   | One of `none`, `low`, `high`, `max`. When unset, the parameter is not sent                                                                                                                                                     |
| `PARSE_TIMEOUT_MS`           | `180000`                | Maximum time spent polling one OCR job                                                                                                                                                                                         |
| `RATE_LIMIT_PER_10_MIN`      | `10`                    | Per-IP limit for `/api/extract` in a 10-minute fixed window                                                                                                                                                                    |
| `TRANSLATE_LIMIT_PER_10_MIN` | `120`                   | Per-IP limit for `/api/translate`                                                                                                                                                                                              |
| `GLOBAL_EXTRACT_PER_HOUR`    | `200`                   | Process-wide hourly cap on `/api/extract` requests                                                                                                                                                                             |
| `GLOBAL_TRANSLATE_PER_HOUR`  | `1200`                  | Process-wide hourly cap on `/api/translate` requests                                                                                                                                                                           |
| `MAX_CONCURRENT_EXTRACTS`    | `5`                     | Maximum analyses in flight in one process                                                                                                                                                                                      |
| `TRUSTED_PROXY_HOPS`         | `0`                     | Number of trusted reverse proxies in front of the app. See [below](#reverse-proxies-and-client-ip)                                                                                                                             |
| `TRUST_PROXY`                | unset                   | Deprecated alias. `true` with `TRUSTED_PROXY_HOPS=0` sets hops to 1 and logs a warning                                                                                                                                         |
| `APP_TIMEZONE`               | `Asia/Kolkata`          | IANA timezone defining "today" for deadline arithmetic; also injected into the Stage A prompt and returned as `timezone`                                                                                                       |
| `HTTPS_ONLY`                 | unset                   | Set to the string `true` to add `upgrade-insecure-requests` to the CSP                                                                                                                                                         |
| `NODE_ENV`                   | `development`           | Standard. Affects key requirement and CSP                                                                                                                                                                                      |

Set by the Dockerfile rather than the application: `PORT=3000`, `HOSTNAME=0.0.0.0`, `NEXT_TELEMETRY_DISABLED=1`.

## Notes on specific variables

### `SARVAM_API_KEY`

- Never logged. It is only attached as the `api-subscription-key` request header to Sarvam.
- `GET /api/health` reports whether it is set, not whether it is valid. A wrong key shows up as failed analyses; see [Deployment](deployment.md#troubleshooting).
- `vercel.json` maps it from a Vercel secret named `sarvam-api-key`.

### `SARVAM_MAX_TOKENS` and `SARVAM_REASONING_EFFORT`

The model can spend its completion budget on internal reasoning. In the preflight run, a 100-token budget produced empty content with `finish_reason: "length"`, and strict JSON-schema output worked in the preflight tests at 512 tokens and above. In the benchmark at 4096 tokens, 5 of 28 model calls still hit `length`. A truncated response fails the document and is not retried.

Raising `SARVAM_MAX_TOKENS` or setting `SARVAM_REASONING_EFFORT` are the obvious levers. Their effect on truncation rate, latency and cost has not been measured in this repository.

### Rate limits and `0`

A value of `0` passes validation and means "reject everything", not "unlimited". The same holds for `MAX_CONCURRENT_EXTRACTS=0`.

### `APP_TIMEZONE`

Read through `env.js` for the response `timezone` field, but `lib/deadlines.js` and `lib/extraction.js` read `process.env.APP_TIMEZONE` directly. Both read the same variable, so they agree. The value is not validated: an invalid IANA name makes `Intl.DateTimeFormat` throw at request time rather than at startup.

### `HTTPS_ONLY`

`next.config.mjs` reads it while building the security headers. Next.js resolves `headers()` when the app is built, so the variable most likely has to be present when `next build` runs (in Docker, in the build stage), not just when the container starts. This has not been verified against this Dockerfile, which does not pass it to the build stage.

### `SARVAM_BASE_URL`

Changing it affects chat, translate and OCR submission. The OCR download URL returned by Sarvam is separately validated against a fixed allow-list (`api.sarvam.ai`, `appsprodaksharpublicsa.blob.core.windows.net`, any `*.sarvam.ai`), so pointing the base URL at a mock or a different host will fail at the download step unless the returned URL is on that list.

## Reverse proxies and client IP

Per-client rate limiting needs the client IP. Next.js 15 removed `NextRequest.ip`, so the app derives it from `X-Forwarded-For` and trusts that header only when told how many proxies sit in front of it.

| `TRUSTED_PROXY_HOPS` | Behaviour                                                                                                                                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0` (default)        | No forwarding header is trusted. Every request's IP is `unknown`, the per-IP limiter is skipped, and a warning is logged once in production. Only the global hourly budget and the concurrency cap protect the service |
| `N` greater than 0   | The client IP is the Nth entry from the right of `X-Forwarded-For`. If there are fewer than N entries the IP is `unknown`. With no `X-Forwarded-For`, `X-Real-IP` is used                                              |

Each trusted proxy appends the address of the peer it received the request from, so the number of proxies equals the number of entries the proxy chain adds:

| Topology                              | `X-Forwarded-For` seen by the app | Set hops to | Client IP taken      |
| ------------------------------------- | --------------------------------- | ----------- | -------------------- |
| Client, one proxy, app                | `client`                          | 1           | `client`             |
| Client, forged header, one proxy, app | `forged, client`                  | 1           | `client` (rightmost) |
| Client, CDN, load balancer, app       | `client, cdn`                     | 2           | `client`             |

Get this wrong in either direction and the limiter misbehaves. Too low: all clients share the proxy's address and one bucket. Too high: the IP is `unknown` and per-IP limiting silently turns off. Check your platform's actual header behaviour before relying on it.

## Compile-time limits

Not environment-configurable; change them in code. All shared by client and server unless noted.

| Constant                                                   | Value                                              | File                                           |
| ---------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------- |
| `MAX_FILES`                                                | 5                                                  | `lib/limits.js`                                |
| `MAX_FILE_BYTES`                                           | 25 MB                                              | `lib/limits.js`                                |
| `MAX_TOTAL_BYTES`                                          | 60 MB                                              | `lib/limits.js`                                |
| `MAX_CHARS_PER_SECTION`                                    | 50,000                                             | `lib/limits.js`                                |
| `MAX_SECTIONS_PER_DOC`                                     | 6                                                  | `lib/limits.js`                                |
| `MAX_TEXT_CHARS`                                           | 1,000,000                                          | `lib/limits.js`                                |
| `MAX_TRANSLATE_CHARS`                                      | 12,000                                             | `lib/limits.js`                                |
| `TRANSLATE_CHUNK`                                          | 1,800                                              | `lib/limits.js`                                |
| `MAX_TOTAL_CHARS`                                          | 150,000                                            | `lib/limits.js`. Defined but not used anywhere |
| `STAGE_B_EXCERPT_CHARS`                                    | 1,500                                              | `lib/extraction.js`                            |
| `MAX_PARSE_PAGES`                                          | 10                                                 | `lib/sarvam.js`                                |
| OCR concurrency / chat concurrency / translate concurrency | 3 / 4 / 4                                          | `lib/sarvam.js`                                |
| Confidence cap for unverified records                      | 0.4                                                | `lib/validation.js`                            |
| Text-layer thresholds                                      | 40 chars per page, 80% of pages, 0.6 quality ratio | `lib/pdfText.js`                               |
| Fuzzy dependency threshold                                 | Jaccard 0.6, 12 chars minimum                      | `lib/engines.js`                               |
| Rate-limit window (per IP)                                 | 10 minutes, fixed window                           | route handlers                                 |
| Request deadline for `/api/extract`                        | 285 s                                              | `app/api/extract/route.js`                     |

## Retry and timeout policy

Implemented in `sarvamFetch` (`lib/sarvam.js`). It wraps every Sarvam HTTP call except the final ZIP download.

- Retries on HTTP 429, 502, 503, 504 and on network errors. Never retries other 4xx.
- Up to 4 retries (5 attempts in total).
- Backoff is 1 s, 2 s, 4 s, 8 s with plus or minus 20% jitter. A `Retry-After` header (seconds or HTTP-date) overrides it. Any wait is capped at 30 s.
- Waits are interruptible: cancellation or the request deadline aborts the wait and preserves the original abort reason.
- Cancellation and timeout errors are never retried.
- The `timeoutMs` is one budget per call and covers all attempts and backoff waits for that call, not each attempt.

| Call                                        | `timeoutMs`                            |
| ------------------------------------------- | -------------------------------------- |
| Chat completion (Stage A, Stage B, repairs) | 120,000                                |
| Translate chunk                             | 30,000                                 |
| OCR submit                                  | 60,000                                 |
| OCR status poll (each poll)                 | 30,000                                 |
| OCR download-url request                    | 30,000                                 |
| OCR ZIP download                            | 60,000, no retries, redirects rejected |
| Whole OCR job (polling)                     | `PARSE_TIMEOUT_MS` (180,000)           |
| Whole `/api/extract` request                | 285,000                                |

The 285 s request deadline overrides everything below it.

## Example `.env.local`

```bash
# Required in production; optional for local development
SARVAM_API_KEY=your_key_here

# Optional tuning
# SARVAM_MAX_TOKENS=4096
# SARVAM_REASONING_EFFORT=low
# APP_TIMEZONE=Asia/Kolkata

# Behind exactly one reverse proxy
# TRUSTED_PROXY_HOPS=1
```

`.env*` files are ignored by git and excluded from the Docker build context.
