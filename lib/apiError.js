/**
 * lib/apiError.js — Canonical API error response factory for all route handlers.
 *
 * Error contract: { "error": { "code", "message", "retry_after_sec"?, "request_id" } }
 *
 * Codes and their HTTP statuses:
 *   INVALID_REQUEST        → 400
 *   TOO_MANY_FILES         → 400
 *   UNSUPPORTED_TYPE       → 415
 *   FILE_TOO_LARGE         → 413
 *   RATE_LIMITED           → 429
 *   SERVER_BUSY            → 503
 *   NO_READABLE_DOCUMENTS  → 422
 *   OCR_FAILED             → 502
 *   EXTRACTION_INVALID     → 502
 *   UPSTREAM_AUTH          → 503  (generic; never expose key name or upstream body)
 *   UPSTREAM_RATE_LIMITED  → 503
 *   UPSTREAM_TIMEOUT       → 504
 *   INTERNAL               → 500
 */

import crypto from "crypto";

/** Map from error code to HTTP status. */
export const CODE_STATUS = {
  INVALID_REQUEST: 400,
  TOO_MANY_FILES: 400,
  UNSUPPORTED_TYPE: 415,
  FILE_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  SERVER_BUSY: 503,
  NO_READABLE_DOCUMENTS: 422,
  OCR_FAILED: 502,
  EXTRACTION_INVALID: 502,
  UPSTREAM_AUTH: 503,
  UPSTREAM_RATE_LIMITED: 503,
  UPSTREAM_TIMEOUT: 504,
  INTERNAL: 500,
};

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Build and return a standardised error Response.
 *
 * @param {string} code        - One of CODE_STATUS keys
 * @param {string} message     - Human-readable message (NEVER include key names or upstream bodies)
 * @param {object} [opts]
 * @param {string}  [opts.request_id]       - pre-generated request id (uses crypto.randomUUID() if absent)
 * @param {number}  [opts.retry_after_sec]  - set for RATE_LIMITED / SERVER_BUSY / UPSTREAM_RATE_LIMITED
 * @param {object}  [opts.extraHeaders]     - additional response headers
 * @param {number}  [opts.durationMs]       - elapsed time for server log
 */
export function apiError(code, message, opts = {}) {
  const status = CODE_STATUS[code] ?? 500;
  const request_id = opts.request_id ?? crypto.randomUUID();

  // Server-side structured log (no secrets, no document content)
  console.error(
    JSON.stringify({
      request_id,
      code,
      status,
      ms: opts.durationMs ?? null,
    })
  );

  const body = {
    error: {
      code,
      message,
      request_id,
      ...(opts.retry_after_sec != null ? { retry_after_sec: opts.retry_after_sec } : {}),
    },
  };

  const headers = {
    ...NO_STORE,
    ...(opts.extraHeaders || {}),
    ...(opts.retry_after_sec != null
      ? { "Retry-After": String(opts.retry_after_sec) }
      : {}),
  };

  return Response.json(body, { status, headers });
}

/**
 * Map a SarvamError (or any upstream error) to the appropriate API error code.
 * NEVER includes the upstream response body in the returned message.
 */
export function mapSarvamError(err, request_id, durationMs) {
  const status = err?.status;

  if (status === 401 || status === 403) {
    return apiError(
      "UPSTREAM_AUTH",
      "The AI service is temporarily unavailable. Please try again later.",
      { request_id, durationMs }
    );
  }
  if (status === 429) {
    return apiError(
      "UPSTREAM_RATE_LIMITED",
      "The AI service is busy. Please try again in a moment.",
      { request_id, retry_after_sec: 60, durationMs }
    );
  }
  if (status === 504 || err?.name === "AbortError" || /timeout/i.test(err?.message || "")) {
    return apiError(
      "UPSTREAM_TIMEOUT",
      "The AI service took too long to respond. Try uploading fewer or shorter documents.",
      { request_id, durationMs }
    );
  }
  if (status === 502 || status === 503) {
    return apiError(
      "UPSTREAM_AUTH",
      "The AI service is temporarily unavailable. Please try again later.",
      { request_id, durationMs }
    );
  }

  return apiError(
    "INTERNAL",
    "An unexpected error occurred. Please try again.",
    { request_id, durationMs }
  );
}

