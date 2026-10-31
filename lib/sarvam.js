import AdmZip from "adm-zip";
import { createLimiter } from "./limiter.js";

// ─────────────────────────────────────────────────────────────
// Config (all overridable with environment variables)
// ─────────────────────────────────────────────────────────────
const BASE_URL = process.env.SARVAM_BASE_URL || "https://api.sarvam.ai";
export const CHAT_MODEL = process.env.SARVAM_CHAT_MODEL || "sarvam-105b";
const CHAT_MAX_TOKENS = Number(process.env.SARVAM_MAX_TOKENS || 4096);
const PARSE_TIMEOUT_MS = Number(process.env.SARVAM_PARSE_TIMEOUT_MS || 180_000);

// Sarvam Document AI limits (docs.sarvam.ai - Languages, Formats & Limits)
// Source: https://docs.sarvam.ai/api-reference-docs/getting-started/models/sarvam-vision
export const MAX_PARSE_PAGES = 10; // Parse: 10 pages per PDF/ZIP
export const TRANSLATE_CHUNK = 1800; // sarvam-translate:v1 accepts up to 2000 chars

// Document AI allows only 10 req/min on every plan, so don't fire a burst of jobs.
const parseLimit = createLimiter(3);
const translateLimit = createLimiter(4);

export class SarvamError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "SarvamError";
    this.status = status;
  }
}

function apiKey() {
  const key = process.env.SARVAM_API_KEY;
  if (!key || key === "your_sarvam_api_key_here") {
    throw new SarvamError("SARVAM_API_KEY is not configured on the server.", 500);
  }
  return key;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch() with retry on 429 / 503 (Sarvam's documented rate-limit and overload responses).
 * Exponential backoff with jitter; honours Retry-After when present.
 */
async function sarvamFetch(path, init = {}, { retries = 4 } = {}) {
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  let attempt = 0;
  for (;;) {
    const res = await fetch(url, {
      ...init,
      headers: { "api-subscription-key": apiKey(), ...(init.headers || {}) },
    });
    if ((res.status === 429 || res.status === 503) && attempt < retries) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = retryAfter > 0 ? retryAfter * 1000 : 1500 * 2 ** attempt + Math.random() * 500;
      await sleep(wait);
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

function friendlyError(status, body) {
  if (status === 401 || status === 403) return "Sarvam rejected the API key (check SARVAM_API_KEY).";
  if (status === 413) return "File is too large for Sarvam (max 200 MB).";
  if (status === 429) return "Sarvam rate limit reached. Please wait a minute and try again.";
  if (status >= 500) return "Sarvam is temporarily unavailable. Please try again shortly.";
  return `Sarvam error ${status}: ${String(body).slice(0, 300)}`;
}

// ─────────────────────────────────────────────────────────────
// 1. Document AI - Parse (OCR for scanned PDFs and images)
//    POST /doc-ai/v1/job/parse -> poll /status -> GET /download-url -> ZIP
// ─────────────────────────────────────────────────────────────
const TERMINAL = new Set(["completed", "partially_completed", "failed", "rejected"]);
const DOWNLOAD_TIMEOUT_MS = 60_000; // 60 seconds for download
const MAX_DOWNLOAD_SIZE = 100 * 1024 * 1024; // 100MB compressed
const MAX_DECOMPRESSED_SIZE = 500 * 1024 * 1024; // 500MB decompressed
const POLLING_MAX_ATTEMPTS = 40; // With intervals, ~2-3 minutes max

export function parseDocument({ buffer, fileName, mimeType, language = "en-IN" }) {
  return parseLimit(() => runParseJob({ buffer, fileName, mimeType, language }));
}

async function runParseJob({ buffer, fileName, mimeType, language }) {
  // 1. Submit. Raw HTTP is used (not the JS SDK) because the SDK's parse() doesn't send
  //    output_format, which would force HTML output.
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimeType }), fileName);
  form.append("language", language);
  form.append("output_format", "md");

  const submit = await sarvamFetch("/doc-ai/v1/job/parse", { method: "POST", body: form });
  const job = await submit.json();
  const jobId = job.job_id;
  if (!jobId) throw new SarvamError("Sarvam did not return a job id.", 502);

  // 2. Poll with a short interval first (small docs finish fast), then back off.
  const started = Date.now();
  const intervals = [1500, 2000, 2000, 3000, 3000];
  let status;
  let attempts = 0;
  
  for (let i = 0; ; i++) {
    if (Date.now() - started > PARSE_TIMEOUT_MS) {
      throw new SarvamError("Document processing timed out. Try a smaller file.", 504);
    }
    
    if (attempts >= POLLING_MAX_ATTEMPTS) {
      throw new SarvamError("Document processing took too long (exceeded maximum polling attempts).", 504);
    }
    
    await sleep(intervals[Math.min(i, intervals.length - 1)] + (i >= intervals.length ? 2000 : 0));
    attempts++;
    
    const res = await sarvamFetch(`/doc-ai/v1/job/${jobId}/status`);
    status = await res.json();
    if (TERMINAL.has(String(status.status).toLowerCase())) break;
  }

  const state = String(status.status).toLowerCase();
  if (state !== "completed" && state !== "partially_completed") {
    const detail = status.error_message || status.error || status.message || state;
    throw new SarvamError(`Sarvam could not read "${fileName}" (${typeof detail === "string" ? detail : state}).`, 422);
  }

  // 3. Download the ZIP with safety checks
  const dlRes = await sarvamFetch(`/doc-ai/v1/job/${jobId}/download-url`);
  const dl = await dlRes.json();
  const downloadUrl = dl.url;
  
  // Validate download URL
  if (!downloadUrl || typeof downloadUrl !== 'string') {
    throw new SarvamError("Invalid download URL received from Sarvam.", 502);
  }
  
  try {
    new URL(downloadUrl); // Validate URL format
  } catch {
    throw new SarvamError("Malformed download URL received from Sarvam.", 502);
  }
  
  // Require HTTPS
  if (!downloadUrl.startsWith('https://')) {
    throw new SarvamError("Download URL must use HTTPS.", 502);
  }
  
  // Download with timeout and size limits
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  
  try {
    const zipRes = await fetch(downloadUrl, { signal: controller.signal });
    clearTimeout(timeout);
    
    if (!zipRes.ok) {
      throw new SarvamError(`Could not download OCR output (${zipRes.status}).`, 502);
    }
    
    // Check content length if provided
    const contentLength = zipRes.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > MAX_DOWNLOAD_SIZE) {
      throw new SarvamError(`OCR output too large (${Math.round(parseInt(contentLength) / 1024 / 1024)}MB).`, 502);
    }
    
    const arrayBuf = await zipRes.arrayBuffer();
    
    if (arrayBuf.byteLength > MAX_DOWNLOAD_SIZE) {
      throw new SarvamError(`Downloaded file exceeds size limit.`, 502);
    }
    
    const zip = new AdmZip(Buffer.from(arrayBuf));
    
    // Check decompressed size
    const entries = zip.getEntries();
    const totalSize = entries.reduce((sum, e) => sum + (e.header?.size || 0), 0);
    if (totalSize > MAX_DECOMPRESSED_SIZE) {
      throw new SarvamError(`Decompressed content too large (${Math.round(totalSize / 1024 / 1024)}MB).`, 502);
    }
    
    const mdEntries = entries
      .filter((e) => !e.isDirectory && e.entryName.toLowerCase().endsWith(".md"))
      .sort((a, b) => a.entryName.localeCompare(b.entryName));
      
    if (mdEntries.length === 0) {
      throw new SarvamError("OCR finished but returned no text.", 502);
    }

    const text = mdEntries.map((e) => e.getData().toString("utf8")).join("\n\n").trim();
    const pages = status.usage?.pages_processed ?? status.usage?.pages_total ?? null;
    const partial = state === "partially_completed";
    
    // Warn if partial results
    if (partial) {
      console.warn(`[PathWise] OCR for "${fileName}" partially completed. Some pages may be missing.`);
    }
    
    return { text, pages, partial };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new SarvamError("Download timed out.", 504);
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────
// 2. Chat completion — structured extraction across all documents
// ─────────────────────────────────────────────────────────────
export async function extractStructured({ systemPrompt, userMessage, schema }) {
  const res = await sarvamFetch("/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      response_format: { type: "json_schema", json_schema: schema },
      temperature: 0,
      max_tokens: CHAT_MAX_TOKENS,
    }),
  });
  const data = await res.json();
  const choice = data.choices?.[0];
  const content = choice?.message?.content;
  if (!content) throw new SarvamError("Sarvam returned an empty response.", 502);
  if (choice.finish_reason === "length") {
    throw new SarvamError(
      "The AI response was cut off. Upload fewer or shorter documents, or raise SARVAM_MAX_TOKENS.",
      502
    );
  }
  return parseJsonLoose(content);
}

/** JSON.parse that tolerates ```json fences, <think> tags, or stray text around the object. */
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
    throw new SarvamError("The AI returned malformed JSON. Please try again.", 502);
  }
}

// ─────────────────────────────────────────────────────────────
// 3. Translation — sarvam-translate:v1 (all 22 scheduled languages)
//    Requests are limited to 2000 characters, so long text is chunked.
// ─────────────────────────────────────────────────────────────

/**
 * Split text into chunks <= max chars, preferring paragraph, then sentence boundaries.
 * Handles the Devanagari danda (।, ॥) as well as . ? !
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
    // Paragraph too long - sentence split
    const sentences = para.split(/(?<=[.!?।॥])\s+/);
    for (const s of sentences) {
      if (s.length <= max) {
        pieces.push(s);
      } else {
        for (let i = 0; i < s.length; i += max) pieces.push(s.slice(i, i + max)); // last resort
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

async function translateChunk(input, targetLanguageCode, sourceLanguageCode) {
  const res = await sarvamFetch("/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input,
      source_language_code: sourceLanguageCode,
      target_language_code: targetLanguageCode,
      model: "sarvam-translate:v1",
      mode: "formal",
      numerals_format: "international", // keep 0-9 so dates, fees and reference numbers stay exact
    }),
  });
  const data = await res.json();
  if (typeof data.translated_text !== "string") {
    throw new SarvamError("Translation returned no text.", 502);
  }
  return data.translated_text;
}

export async function translateText(text, targetLanguageCode, sourceLanguageCode = "en-IN") {
  if (targetLanguageCode === sourceLanguageCode) return text;
  const chunks = chunkText(text);
  const out = await Promise.all(
    chunks.map((c) => translateLimit(() => translateChunk(c, targetLanguageCode, sourceLanguageCode)))
  );
  return out.join("\n\n");
}
