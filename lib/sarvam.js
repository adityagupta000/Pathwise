import AdmZip from "adm-zip";
import { createLimiter } from "./limiter.js";
import { env } from "./env.js";
import { TRANSLATE_CHUNK } from "./limits.js";

// ─────────────────────────────────────────────────────────────
// Config (all overridable with environment variables via env.js)
// ─────────────────────────────────────────────────────────────
// D3: Read at call-time from env object (validated by env.js).
// env is loaded lazily to avoid circular imports in tests.
function getBaseUrl() { return env.SARVAM_BASE_URL || "https://api.sarvam.ai"; }
export function getChatModel() { return env.SARVAM_CHAT_MODEL || "sarvam-105b"; }
// Backward-compat alias used in extraction.js
export const CHAT_MODEL = "sarvam-105b"; // kept for import compat; real value from getChatModel()

// Note: SARVAM_MAX_TOKENS and PARSE_TIMEOUT_MS are read at call-time from env
// so hot-reload in tests is respected.

// Sarvam Document AI limits (docs.sarvam.ai)
export const MAX_PARSE_PAGES = 10; // Parse: 10 pages per PDF/ZIP
// TRANSLATE_CHUNK imported from limits.js (D2 fix)

// Note: Sarvam Parse rate limit is 200 req/min (Pay-as-you-go).
// We use a concurrency limiter (not a rate limiter) to batch politely.
const parseLimit = createLimiter(3);
const chatLimit = createLimiter(4);
const translateLimit = createLimiter(4);

export class SarvamError extends Error {
  constructor(message, status, invalidOutput = false) {
    super(message);
    this.name = "SarvamError";
    this.status = status;
    this.invalidOutput = invalidOutput;
  }
}

function apiKey() {
  const key = env.SARVAM_API_KEY;
  if (!key || key === "your_sarvam_api_key_here") {
    console.error("[PathWise] SARVAM_API_KEY is not configured for an API request.");
    throw new SarvamError(
      "The AI service is not configured on this server.",
      500
    );
  }
  return key;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Parse Retry-After header: supports both a numeric seconds value and
 * an HTTP-date string (RFC 7231).
 * Returns milliseconds to wait, or null if unparseable.
 */
function parseRetryAfter(header) {
  if (!header) return null;
  const numeric = Number(header);
  if (!isNaN(numeric) && isFinite(numeric) && numeric >= 0) {
    return numeric * 1000;
  }
  // Try HTTP-date
  const date = new Date(header);
  if (!isNaN(date.getTime())) {
    const ms = date.getTime() - Date.now();
    return ms > 0 ? ms : 0;
  }
  return null;
}

/**
 * sarvamFetch — fetch() with:
 *   - Timeout via AbortSignal (combined with caller's signal)
 *   - Retry on 429, 502, 503, 504 and network errors
 *   - Exponential backoff + ±20% jitter
 *   - Honours Retry-After (both seconds and HTTP-date)
 *   - Never retries 4xx (except 429)
 */
async function sarvamFetch(path, init = {}, { retries = 4, timeoutMs, signal } = {}) {
  const url = path.startsWith("http") ? path : `${getBaseUrl()}${path}`;

  // Combine caller signal + timeout signal
  const signals = [];
  if (signal) signals.push(signal);
  if (timeoutMs) signals.push(AbortSignal.timeout(timeoutMs));
  const combinedSignal =
    signals.length === 0
      ? undefined
      : signals.length === 1
      ? signals[0]
      : AbortSignal.any(signals);

  let attempt = 0;
  for (;;) {
    let res;
    try {
      res = await fetch(url, {
        ...init,
        signal: combinedSignal,
        headers: { "api-subscription-key": apiKey(), ...(init.headers || {}) },
      });
    } catch (err) {
      if (signal?.aborted) throw signal.reason ?? err;
      if (err.name === "AbortError" || err.name === "TimeoutError") throw err;
      if (attempt < retries) {
        const wait = jitteredBackoff(attempt);
        await sleep(wait);
        attempt++;
        continue;
      }
      throw new SarvamError(
        "Could not reach the AI service. Please check your connection and try again.",
        502
      );
    }

    // Retryable HTTP statuses
    const retryable =
      res.status === 429 ||
      res.status === 502 ||
      res.status === 503 ||
      res.status === 504;

    if (retryable && attempt < retries) {
      // Consume body to avoid socket leak
      await res.text().catch(() => {});
      const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
      const wait =
        retryAfterMs != null ? retryAfterMs : jitteredBackoff(attempt);
      await sleep(Math.min(wait, 30_000)); // cap at 30 s
      attempt++;
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new SarvamError(friendlyError(res.status, body), res.status);
    }
    return res;
  }
}

function jitteredBackoff(attempt) {
  const base = 1000 * 2 ** attempt; // 1s, 2s, 4s, 8s
  const jitter = base * 0.2 * (Math.random() * 2 - 1); // ±20%
  return base + jitter;
}

/**
 * Map upstream status to a safe message. NEVER expose key names or raw body.
 */
function friendlyError(status, _body) {
  if (status === 401 || status === 403)
    return "The AI service rejected the request (authentication error).";
  if (status === 413) return "File is too large for the AI service (max 200 MB).";
  if (status === 429) return "The AI service rate limit was reached. Please wait and try again.";
  if (status >= 500) return "The AI service is temporarily unavailable. Please try again shortly.";
  return `Upstream error ${status}.`;
}

// ─────────────────────────────────────────────────────────────
// 1. Document AI - Parse (OCR for scanned PDFs and images)
//    POST /doc-ai/v1/job/parse → poll /status → GET /download-url → ZIP
// ─────────────────────────────────────────────────────────────
const TERMINAL = new Set(["completed", "partially_completed", "failed", "rejected"]);
const DOWNLOAD_TIMEOUT_MS = 60_000; // 60 s
const MAX_DOWNLOAD_SIZE = 100 * 1024 * 1024; // 100 MB compressed
const MAX_DECOMPRESSED_SIZE = 500 * 1024 * 1024; // 500 MB
const MAX_OCR_TEXT_PER_DOC = 2 * 1024 * 1024; // 2 MB of extracted text

export function parseDocument({ buffer, fileName, mimeType, language = "en-IN", signal }) {
  return parseLimit(() => runParseJob({ buffer, fileName, mimeType, language, signal }));
}

async function runParseJob({ buffer, fileName, mimeType, language, signal }) {
  const PARSE_TIMEOUT_MS = env.PARSE_TIMEOUT_MS;

  // 1. Submit
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimeType }), fileName);
  form.append("language", language);
  form.append("output_format", "md");

  const submit = await sarvamFetch(
    "/doc-ai/v1/job/parse",
    { method: "POST", body: form },
    { timeoutMs: 60_000, signal }
  );
  const job = await submit.json();
  const jobId = job.job_id;
  if (!jobId) throw new SarvamError("Sarvam did not return a job id.", 502);

  // 2. Poll
  const started = Date.now();
  const intervals = [1500, 2000, 2000, 3000, 3000];
  let status;
  let attempts = 0;
  let unknownStatusCount = 0;

  for (let i = 0; ; i++) {
    if (signal?.aborted) throw new SarvamError("Request was cancelled.", 499);
    if (Date.now() - started > PARSE_TIMEOUT_MS) {
      throw new SarvamError("Document processing timed out. Try a smaller file.", 504);
    }

    await sleep(intervals[Math.min(i, intervals.length - 1)] + (i >= intervals.length ? 2000 : 0));
    attempts++;

    const res = await sarvamFetch(
      `/doc-ai/v1/job/${jobId}/status`,
      {},
      { timeoutMs: 30_000, signal }
    );
    status = await res.json();
    const st = String(status.status || "").toLowerCase();

    if (TERMINAL.has(st)) {
      unknownStatusCount = 0;
      break;
    }

    // Unknown/missing status: treat as transient, fail after 3 consecutive reads
    if (!st || !["queued", "processing", "pending"].includes(st)) {
      unknownStatusCount++;
      if (unknownStatusCount >= 3) {
        throw new SarvamError(
          `Unexpected OCR job status "${st}". Please try again.`,
          502
        );
      }
    } else {
      unknownStatusCount = 0;
    }
  }

  const state = String(status.status).toLowerCase();
  if (state !== "completed" && state !== "partially_completed") {
    const detail = status.error_message || status.error || status.message || state;
    throw new SarvamError(
      `Sarvam could not read "${fileName}" (${typeof detail === "string" ? detail : state}).`,
      422
    );
  }

  // 3. Download ZIP
  const dlRes = await sarvamFetch(
    `/doc-ai/v1/job/${jobId}/download-url`,
    {},
    { timeoutMs: 30_000, signal }
  );
  const dl = await dlRes.json();
  const downloadUrl = dl.url;

  if (!downloadUrl || typeof downloadUrl !== "string") {
    throw new SarvamError("Invalid download URL received from Sarvam.", 502);
  }
  try {
    new URL(downloadUrl);
  } catch {
    throw new SarvamError("Malformed download URL received from Sarvam.", 502);
  }
  const parsedDownloadUrl = new URL(downloadUrl);
  if (parsedDownloadUrl.protocol !== "https:") {
    throw new SarvamError("Download URL must use HTTPS.", 502);
  }
  if (parsedDownloadUrl.username || parsedDownloadUrl.password || parsedDownloadUrl.port) {
    throw new SarvamError("Download URL contains disallowed credentials or port.", 502);
  }
  const downloadHost = parsedDownloadUrl.hostname.toLowerCase();
  if (downloadHost !== "api.sarvam.ai" && !downloadHost.endsWith(".sarvam.ai")) {
    throw new SarvamError("Download URL host is not trusted.", 502);
  }

  const dlSignals = [AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)];
  if (signal) dlSignals.push(signal);
  const dlSignal = dlSignals.length === 1 ? dlSignals[0] : AbortSignal.any(dlSignals);

  let zipRes;
  try {
    zipRes = await fetch(downloadUrl, {
      signal: dlSignal,
      redirect: "error", // 2.5: reject redirects
    });
  } catch (err) {
    if (err.name === "AbortError") throw new SarvamError("Download timed out.", 504);
    if (err.message?.includes("redirect")) {
      throw new SarvamError("OCR download was redirected unexpectedly.", 502);
    }
    throw new SarvamError("Could not download OCR output.", 502);
  }

  if (!zipRes.ok) {
    throw new SarvamError(`Could not download OCR output (${zipRes.status}).`, 502);
  }

  // Check content length
  const contentLength = zipRes.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > MAX_DOWNLOAD_SIZE) {
    throw new SarvamError(
      `OCR output too large (${Math.round(parseInt(contentLength) / 1024 / 1024)} MB).`,
      502
    );
  }

  const arrayBuf = await zipRes.arrayBuffer();
  if (arrayBuf.byteLength > MAX_DOWNLOAD_SIZE) {
    throw new SarvamError("Downloaded OCR file exceeds size limit.", 502);
  }

  const zip = new AdmZip(Buffer.from(arrayBuf));
  const entries = zip.getEntries();
  const totalSize = entries.reduce((sum, e) => sum + (e.header?.size || 0), 0);
  if (totalSize > MAX_DECOMPRESSED_SIZE) {
    throw new SarvamError(
      `Decompressed OCR content too large (${Math.round(totalSize / 1024 / 1024)} MB).`,
      502
    );
  }

  const mdEntries = entries
    .filter((e) => !e.isDirectory && e.entryName.toLowerCase().endsWith(".md"))
    .sort((a, b) => {
      const aMatch = a.entryName.match(/(\d+)(?=\.[^.]+$)/);
      const bMatch = b.entryName.match(/(\d+)(?=\.[^.]+$)/);
      if (aMatch && bMatch && aMatch[1] !== bMatch[1]) {
        return Number(aMatch[1]) - Number(bMatch[1]);
      }
      return a.entryName < b.entryName ? -1 : a.entryName > b.entryName ? 1 : 0;
    });

  if (mdEntries.length === 0) {
    throw new SarvamError("OCR finished but returned no text.", 502);
  }

  // 2.5 (P-4): join multiple .md files with page markers
  let text;
  if (mdEntries.length === 1) {
    text = mdEntries[0].getData().toString("utf8").trim();
  } else {
    text = mdEntries
      .map((e, idx) => `--- Page ${idx + 1} ---\n${e.getData().toString("utf8").trim()}`)
      .join("\n\n");
  }

  // 2.5: reject oversized extracted text (2 MB per document)
  if (Buffer.byteLength(text, "utf8") > MAX_OCR_TEXT_PER_DOC) {
    throw new SarvamError(
      `OCR output for "${fileName}" is too large (> 2 MB of text). Please split the document.`,
      502
    );
  }

  const pages = status.usage?.pages_processed ?? status.usage?.pages_total ?? null;
  const pagesFailed = status.usage?.pages_failed ?? null;
  const partial = state === "partially_completed";

  if (partial) {
    // Caller (digitise) surfaces this as a warning
    console.warn(
      `[PathWise] OCR for "${fileName}" partially completed. ` +
        `pages_processed=${pages ?? "?"}, pages_failed=${pagesFailed ?? "?"}`
    );
  }

  return { text, pages, pagesFailed, partial };
}

// ─────────────────────────────────────────────────────────────
// 2. Chat completion — structured extraction across all documents
// ─────────────────────────────────────────────────────────────
export async function extractStructured({ systemPrompt, userMessage, schema, signal }) {
  const res = await chatLimit(() => sarvamFetch(
    "/v1/chat/completions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: getChatModel(),
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        response_format: { type: "json_schema", json_schema: schema },
        temperature: 0,
        max_tokens: env.SARVAM_MAX_TOKENS,
      }),
    },
    { timeoutMs: 120_000, signal }
  ));
  const data = await res.json();
  const choice = data.choices?.[0];
  const content = choice?.message?.content;
  // NOTE: reasoning_content (if present) is a separate field and must NEVER be logged.
  if (!content) {
    throw new SarvamError(
      choice?.finish_reason === "length"
        ? "The AI response was cut off. Upload fewer or shorter documents, or raise SARVAM_MAX_TOKENS."
        : "The AI service returned an empty response.",
      502,
      true
    );
  }
  if (choice.finish_reason === "length") {
    throw new SarvamError(
      "The AI response was cut off. Upload fewer or shorter documents, or raise SARVAM_MAX_TOKENS.",
      502,
      true
    );
  }
  return parseJsonLoose(content);
}

/** JSON.parse that tolerates ```json fences or stray text around the object. */
export function parseJsonLoose(raw) {
  const clean = String(raw).replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    const stripped = clean.replace(/```(?:json)?/gi, "").trim();
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(stripped.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    throw new SarvamError("The AI returned malformed JSON. Please try again.", 502, true);
  }
}

// ─────────────────────────────────────────────────────────────
// 3. Translation — sarvam-translate:v1 (all 22 scheduled languages)
// ─────────────────────────────────────────────────────────────

/**
 * Split text into chunks <= max chars, preferring paragraph then sentence boundaries.
 */
export function chunkText(text, max = TRANSLATE_CHUNK) {
  const chunks = [];
  let current = "";
  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  const pieces = [];
  for (const para of String(text).split(/\n{2,}/)) {
    if (para.length <= max) {
      pieces.push(para);
      continue;
    }
    const sentences = para.split(/(?<=[.!?।॥])\s+/);
    for (const s of sentences) {
      if (s.length <= max) {
        pieces.push(s);
      } else {
        for (let i = 0; i < s.length; i += max) pieces.push(s.slice(i, i + max));
      }
    }
  }

  for (const p of pieces) {
    if ((current + "\n\n" + p).length > max) push();
    current = current ? current + "\n\n" + p : p;
  }
  push();
  return chunks;
}

async function translateChunk(input, targetLanguageCode, sourceLanguageCode, signal) {
  const res = await sarvamFetch(
    "/translate",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        source_language_code: sourceLanguageCode,
        target_language_code: targetLanguageCode,
        model: "sarvam-translate:v1",
        mode: "formal",
        numerals_format: "international",
      }),
    },
    { timeoutMs: 30_000, signal }
  );
  const data = await res.json();
  if (typeof data.translated_text !== "string") {
    throw new SarvamError("Translation returned no text.", 502);
  }
  return data.translated_text;
}

/**
 * Translate `text` to `targetLanguageCode`.
 * On any chunk failure, aborts all sibling chunk translations immediately.
 */
export async function translateText(text, targetLanguageCode, sourceLanguageCode = "en-IN", signal) {
  if (targetLanguageCode === sourceLanguageCode) return text;
  const chunks = chunkText(text);

  // Use an AbortController so we can abort siblings on first failure
  const ac = new AbortController();
  // Also listen to caller's signal
  const onCallerAbort = () => ac.abort();
  signal?.addEventListener("abort", onCallerAbort);

  const combinedSignal = signal
    ? AbortSignal.any([signal, ac.signal])
    : ac.signal;

  try {
    const results = await Promise.all(
      chunks.map(async (c) => {
        try {
          return await translateLimit(() =>
            translateChunk(c, targetLanguageCode, sourceLanguageCode, combinedSignal)
          );
        } catch (err) {
          ac.abort(); // abort siblings
          throw err;
        }
      })
    );
    return results.join("\n\n");
  } finally {
    signal?.removeEventListener("abort", onCallerAbort);
  }
}
