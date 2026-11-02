import { z } from "zod";
import crypto from "crypto";
import { readPdfTextLayer } from "@/lib/pdfText";
import { parseDocument, extractStructured, MAX_PARSE_PAGES, SarvamError } from "@/lib/sarvam";
import {
  STAGE_A_SCHEMA,
  STAGE_B_SCHEMA,
  buildStageASystemPrompt,
  buildStageAUserMessage,
  buildStageBSystemPrompt,
  buildStageBUserMessage,
  sectionDocument,
  sanitizeLabel,
} from "@/lib/extraction";
import { rateLimit, rateLimitHeaders, clientIp, acquireExtractSlot, releaseExtractSlot } from "@/lib/limiter";
import { LANGUAGE_CODES } from "@/lib/languages";
import { validateExtractions, validateEvidenceSnippet, getValidationWarnings, prepareSource } from "@/lib/validation";
import { MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES, MAX_CHARS_PER_SECTION, MAX_TEXT_CHARS } from "@/lib/limits";
import { computeDeadlineDays, computeDeadlineStatus } from "@/lib/deadlines";
import { apiError, mapSarvamError } from "@/lib/apiError";
import { env } from "@/lib/env";
import {
  resolveDependencies,
  buildPriorityList,
  buildWorkflowSummary,
  generateReasoningSteps,
} from "@/lib/engines";

export const runtime = "nodejs";
export const maxDuration = 300; // seconds (only matters on platforms that enforce it)

// ── Magic bytes for file-type verification ────────────────────────────────────
const MAGIC = {
  pdf: [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpeg: [0xff, 0xd8, 0xff],
};

function detectMime(buf) {
  // Use subarray to safely handle buffers shorter than 12 bytes.
  const b = buf.subarray ? buf.subarray(0, Math.min(12, buf.length)) : new Uint8Array(buf.buffer ?? buf, 0, Math.min(12, buf.byteLength ?? buf.length));
  if (b.length < 3) return null; // too short to identify
  if (MAGIC.pdf.every((v, i) => b[i] === v)) return "application/pdf";
  if (b.length >= 8 && MAGIC.png.every((v, i) => b[i] === v)) return "image/png";
  if (MAGIC.jpeg.every((v, i) => b[i] === v)) return "image/jpeg";
  return null;
}

const DECLARED_MIME = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

// ── Zod schema for `documents` JSON field ────────────────────────────────────
const DocMetaSchema = z.object({
  fileType: z.enum(["text", "pdf", "image"]).default("text"),
  fileName: z.string().max(255),
  title: z.string().max(255).optional().default(""),
  source: z.string().max(100).optional(),
  text: z.string().max(MAX_TEXT_CHARS).optional(),
});
const DocsSchema = z.array(DocMetaSchema).min(1).max(MAX_FILES);

// ── Stage B Zod schema ────────────────────────────────────────────────────────
const EdgeSchema = z.object({
  from_doc_id: z.string(),
  depends_on_doc_id: z.string(),
  reason: z.string(),
  evidence_quote: z.string().nullable().optional(),
  evidence_doc_id: z.string().nullable().optional(),
});
const StageBOutputSchema = z.object({
  edges: z.array(EdgeSchema),
  conflicts: z.array(
    z.object({
      doc_ids: z.array(z.string()),
      description: z.string(),
    })
  ),
});

const StageAOutputSchema = z.object({
  document_type: z.string().min(1),
  organization: z.string().nullable().catch(null),
  government_department: z.string().nullable().catch(null),
  title: z.string().catch(""),
  required_action: z.string().min(1),
  required_documents: z.array(z.string()).catch([]),
  prerequisites: z.array(z.string()).catch([]),
  deadline_text: z.string().nullable().catch(null),
  deadline_date: z.string().nullable().catch(null),
  deadline_relative_days: z.number().int().nullable().catch(null),
  deadline_relative_anchor: z.string().nullable().catch(null),
  appointment_date: z.string().nullable().catch(null),
  appointment_time: z.string().nullable().catch(null),
  office_location: z.string().nullable().catch(null),
  estimated_time_minutes: z.number().int().nullable().catch(null),
  fees: z.string().nullable().catch(null),
  reference_number: z.string().nullable().catch(null),
  consequence: z.string().nullable().catch(null),
  confidence: z.number().transform((value) => Math.max(0, Math.min(1, value))).catch(0.5),
  source_page: z.number().int().nullable().catch(null),
  evidence_snippet: z.string().nullable().catch(null),
  information_type: z.enum(["explicitly_stated", "clearly_inferred", "uncertain"]).catch("uncertain"),
});

// ── Common headers for all responses ─────────────────────────────────────────
const NO_STORE = { "Cache-Control": "no-store" };

function ok(body, extraHeaders = {}) {
  return Response.json(body, { status: 200, headers: { ...NO_STORE, ...extraHeaders } });
}

// ── Merge Stage A sections ────────────────────────────────────────────────────
function mergeStageASections(sections) {
  if (!sections || sections.length === 0) return null;
  if (sections.length === 1) return sections[0];

  const sortedByConf = [...sections].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  const bestSection = sortedByConf[0];
  const avgConf =
    sections.reduce((sum, s) => sum + (typeof s.confidence === "number" ? s.confidence : 0.5), 0) /
    sections.length;

  const reqDocsSet = new Set();
  sections.forEach((s) => {
    if (Array.isArray(s.required_documents))
      s.required_documents.forEach((d) => d && reqDocsSet.add(d.trim()));
  });
  const prereqsSet = new Set();
  sections.forEach((s) => {
    if (Array.isArray(s.prerequisites))
      s.prerequisites.forEach((p) => p && prereqsSet.add(p.trim()));
  });

  let earliestDeadline = null, earliestDeadlineText = null, earliestRelDays = null, earliestRelAnchor = null;
  let deadlineSection = null;
  for (const s of sections) {
    if (s.deadline_date && (!earliestDeadline || s.deadline_date < earliestDeadline)) {
      earliestDeadline = s.deadline_date;
      earliestDeadlineText = s.deadline_text;
      earliestRelDays = s.deadline_relative_days;
      earliestRelAnchor = s.deadline_relative_anchor;
      deadlineSection = s;
    }
  }
  if (!earliestDeadline) {
    const withText = sections.find((s) => s.deadline_text);
    if (withText) {
      earliestDeadlineText = withText.deadline_text;
      earliestRelDays = withText.deadline_relative_days;
      earliestRelAnchor = withText.deadline_relative_anchor;
      deadlineSection = withText;
    }
  }

  const anyUncertain = sections.some((s) => s.information_type === "uncertain");
  const informationType = anyUncertain
    ? "uncertain"
    : sections.some((s) => s.information_type === "clearly_inferred")
    ? "clearly_inferred"
    : "explicitly_stated";

  // Fill null scalar fields from lower-confidence sections.
  const FILL_FIELDS = ["consequence", "fees", "office_location", "appointment_date", "appointment_time"];
  const filledScalars = {};
  for (const field of FILL_FIELDS) {
    if (bestSection[field] != null) {
      filledScalars[field] = bestSection[field];
    } else {
      // Find first non-null value in descending confidence order
      for (const s of sortedByConf) {
        if (s[field] != null) {
          filledScalars[field] = s[field];
          break;
        }
      }
      if (filledScalars[field] === undefined) {
        filledScalars[field] = null;
      }
    }
  }

  return {
    ...bestSection,
    ...filledScalars,
    required_documents: Array.from(reqDocsSet),
    prerequisites: Array.from(prereqsSet),
    deadline_date: earliestDeadline,
    deadline_text: earliestDeadlineText || bestSection.deadline_text || null,
    deadline_relative_days: earliestRelDays ?? bestSection.deadline_relative_days ?? null,
    deadline_relative_anchor: earliestRelAnchor ?? bestSection.deadline_relative_anchor ?? null,
    confidence: Number(avgConf.toFixed(2)),
    information_type: informationType,
    evidence_snippet: deadlineSection
      ? deadlineSection.evidence_snippet || null
      : bestSection.evidence_snippet || null,
  };
}

// ── Stage A with retry ────────────────────────────────────────────────────────
async function runStageAWithRetry(docSection, systemPrompt, signal) {
  const userMsg = buildStageAUserMessage(docSection);
  try {
    const result = await extractStructured({ systemPrompt, userMessage: userMsg.message, schema: STAGE_A_SCHEMA, signal });
    const parsed = StageAOutputSchema.safeParse(result);
    if (!parsed.success) throw new SarvamError("Invalid Stage A extraction output structure", 502, true);
    return parsed.data;
  } catch (err) {
    if (!(err instanceof SarvamError && err.invalidOutput === true)) {
      throw err;
    }
    const repairPrompt = `${systemPrompt}\n\nIMPORTANT: Return ONLY a valid JSON object matching the schema. No markdown formatting.`;
    const repaired = await extractStructured({ systemPrompt: repairPrompt, userMessage: userMsg.message, schema: STAGE_A_SCHEMA, signal });
    const parsed = StageAOutputSchema.safeParse(repaired);
    if (!parsed.success) throw new SarvamError("Invalid Stage A extraction output structure", 502, true);
    return parsed.data;
  }
}

// ── Digitise one file ─────────────────────────────────────────────────────────
async function digitise(meta, file, language, signal) {
  const t0 = Date.now();

  if (meta.fileType !== "pdf" && meta.fileType !== "image") {
    return { ...meta, method: "text", ms: 0 };
  }
  if (!file) throw new Error("File data is missing from the upload.");

  const buffer = Buffer.from(await file.arrayBuffer());

  // Verify detected bytes against the declared extension.
  const detectedMime = detectMime(buffer);
  const ext = (meta.fileName || file.name || "").toLowerCase().split(".").pop();
  const declaredMime = DECLARED_MIME[ext];
  if (!["pdf", "png", "jpg", "jpeg"].includes(ext)) {
    const err = new Error(`Unsupported file extension ".${ext}". Use PDF, PNG or JPG.`);
    err.code = "UNSUPPORTED_TYPE";
    throw err;
  }

  // Short files that can't be identified
  if (buffer.length < 5) {
    const err = new Error(`File "${meta.fileName}" is too small to be a valid document.`);
    err.code = "UNSUPPORTED_TYPE";
    throw err;
  }

  if (detectedMime && declaredMime && detectedMime !== declaredMime) {
    const err = new Error(`File "${meta.fileName}" has a .${ext} extension but its contents are not a valid ${ext.toUpperCase()} file.`);
    err.code = "UNSUPPORTED_TYPE";
    throw err;
  }
  if (!detectedMime && meta.fileType !== "text") {
    const err = new Error(`File "${meta.fileName}" could not be identified as a PDF, PNG or JPEG.`);
    err.code = "UNSUPPORTED_TYPE";
    throw err;
  }

  // Use the detected MIME type to route processing.
  const mimeType = detectedMime || declaredMime;
  if (!mimeType) {
    const err = new Error(`Unsupported file type ".${ext}". Use PDF, PNG or JPG.`);
    err.code = "UNSUPPORTED_TYPE";
    throw err;
  }

  if (meta.fileType === "pdf" || detectedMime === "application/pdf") {
    let layer = null;
    try {
      layer = await readPdfTextLayer(buffer);
    } catch (err) {
      /* encrypted or unusual PDF: let Sarvam try */
    }

    if (layer?.encrypted) {
      const e = new Error(layer.message);
      e.code = "PDF_ENCRYPTED";
      throw e;
    }
    if (layer?.lowTextQuality) {
      // Fall through to OCR, but record the warning
      meta = { ...meta, _lowTextQuality: true };
    } else if (layer?.hasTextLayer) {
      // Digital PDF with text layer — no page limit, return directly
      return { ...meta, text: layer.text, pages: layer.pages, method: "text-layer", ms: Date.now() - t0 };
    } else if (layer && layer.pages > MAX_PARSE_PAGES) {
      // Scanned PDF without text layer — enforce OCR page limit
      const error = new Error(
        `Scanned PDF has ${layer.pages} pages; OCR accepts up to ${MAX_PARSE_PAGES}. Split it and upload the parts.`
      );
      error.code = "PAGE_LIMIT";
      throw error;
    }
  }

  const parsed = await parseDocument({
    buffer,
    fileName: meta.fileName || file.name,
    mimeType,
    language,
    signal,
  });

  const warnings = [];
  if (parsed.partial) {
    warnings.push({
      type: "partial_ocr",
      file_name: meta.fileName || file.name,
      pages_processed: parsed.pages,
      pages_failed: parsed.pagesFailed,
      message: `OCR for "${meta.fileName || file.name}" completed only partially. Some pages may be missing.`,
    });
  }
  if (meta._lowTextQuality) {
    warnings.push({
      type: "low_text_quality",
      file_name: meta.fileName || file.name,
      message: `PDF "${meta.fileName || file.name}" had low-quality embedded text; sent to OCR instead.`,
    });
  }

  return {
    ...meta,
    text: parsed.text,
    pages: parsed.pages,
    method: "sarvam-ocr",
    ms: Date.now() - t0,
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/extract
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(request) {
  const request_id = crypto.randomUUID();
  const t0 = Date.now();
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(285_000)]);

  // ── 2.2: Content-Length pre-check (before reading body) ────────────────────
  const cl = request.headers.get("content-length");
  if (cl && parseInt(cl) > MAX_TOTAL_BYTES + 2 * 1024 * 1024) {
    return apiError("FILE_TOO_LARGE", `Upload exceeds maximum allowed size of ${MAX_TOTAL_BYTES / 1024 / 1024} MB.`, {
      request_id,
      durationMs: Date.now() - t0,
    });
  }

  // ── 2.1: Rate limit ─────────────────────────────────────────────────────────
  const ip = clientIp(request);
  const rlKey = `extract:${ip}`;
  // When IP is "unknown" (TRUSTED_PROXY_HOPS=0), skip per-IP bucket —
  // rely on global hourly + concurrency cap instead
  if (ip !== "unknown") {
    const rl = rateLimit(rlKey, { limit: env.RATE_LIMIT_PER_10_MIN, windowMs: 10 * 60 * 1000 });
    if (!rl.ok) {
      return apiError("RATE_LIMITED", `Too many requests. Please try again in ${Math.ceil(rl.retryAfterSec / 60)} minute(s).`, {
        request_id,
        retry_after_sec: rl.retryAfterSec,
        extraHeaders: rateLimitHeaders(rl, env.RATE_LIMIT_PER_10_MIN),
        durationMs: Date.now() - t0,
      });
    }
  }

  // Global extract budget
  const globalRl = rateLimit("global:extract", {
    limit: env.GLOBAL_EXTRACT_PER_HOUR,
    windowMs: 60 * 60 * 1000,
  });
  if (!globalRl.ok) {
    return apiError("SERVER_BUSY", "The service is temporarily at capacity. Please try again shortly.", {
      request_id,
      retry_after_sec: 60,
      durationMs: Date.now() - t0,
    });
  }

  // Concurrency cap
  if (!acquireExtractSlot()) {
    return apiError("SERVER_BUSY", "Too many jobs are running simultaneously. Please try again in a moment.", {
      request_id,
      retry_after_sec: 30,
      durationMs: Date.now() - t0,
    });
  }

  try {
    // ── Parse form ──────────────────────────────────────────────────────────────
    let form;
    try {
      form = await request.formData();
    } catch {
      return apiError("INVALID_REQUEST", "Send the documents as multipart form data.", { request_id, durationMs: Date.now() - t0 });
    }

    // ── Validate `documents` JSON ───────────────────────────────────────────────
    let rawMetas;
    try {
      rawMetas = JSON.parse(form.get("documents") || "[]");
    } catch {
      return apiError("INVALID_REQUEST", "The 'documents' field must be valid JSON.", { request_id, durationMs: Date.now() - t0 });
    }

    const parsed = DocsSchema.safeParse(rawMetas);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => i.message).join("; ");
      const code = Array.isArray(rawMetas) && rawMetas.length > MAX_FILES ? "TOO_MANY_FILES" : "INVALID_REQUEST";
      return apiError(code, `Invalid document metadata: ${msg}`, { request_id, durationMs: Date.now() - t0 });
    }

    // Sanitize string fields to strip control chars / newlines
    const metas = parsed.data.map((m) => ({
      ...m,
      fileName: sanitizeLabel(m.fileName),
      title: sanitizeLabel(m.title),
      source: m.source ? sanitizeLabel(m.source) : undefined,
    }));

    // Reject whitespace-only text documents
    for (const m of metas) {
      if (m.fileType === "text" && m.text != null && !m.text.trim()) {
        return apiError("INVALID_REQUEST", `Document "${m.fileName}" is empty or contains only whitespace.`, {
          request_id,
          durationMs: Date.now() - t0,
        });
      }
    }

    const language = LANGUAGE_CODES.has(form.get("language")) ? form.get("language") : "en-IN";

    // ── Per-file size checks ────────────────────────────────────────────────────
    let totalBytes = 0;
    for (let i = 0; i < metas.length; i++) {
      const f = form.get(`file_${i}`);
      if (f && typeof f !== "string") {
        if (f.size > MAX_FILE_BYTES) {
          return apiError("FILE_TOO_LARGE", `"${f.name}" is over ${MAX_FILE_BYTES / 1024 / 1024} MB.`, {
            request_id,
            durationMs: Date.now() - t0,
          });
        }
        totalBytes += f.size;
      }
    }
    if (totalBytes > MAX_TOTAL_BYTES) {
      return apiError("FILE_TOO_LARGE", `Total upload is over ${MAX_TOTAL_BYTES / 1024 / 1024} MB.`, {
        request_id,
        durationMs: Date.now() - t0,
      });
    }

    // ── Step 1: Digitise all docs in parallel ───────────────────────────────────
    const digitizeResults = await Promise.all(
      metas.map(async (meta, i) => {
        try {
          const file = form.get(`file_${i}`);
          const digitized = await digitise(meta, typeof file === "string" ? null : file, language, signal);
          return { ok: true, doc_index: i, doc: digitized };
        } catch (err) {
          const code = err.code === "UNSUPPORTED_TYPE" ? "UNSUPPORTED_TYPE"
            : err.code === "PDF_ENCRYPTED" ? "PDF_ENCRYPTED"
            : err.code === "PAGE_LIMIT" ? "PAGE_LIMIT"
            : "OCR_FAILED";
          return {
            ok: false,
            doc_index: i,
            failure: {
              file_name: meta.fileName || meta.title || `doc_${i + 1}`,
              code,
              message: code === "UNSUPPORTED_TYPE" || code === "PDF_ENCRYPTED" || code === "PAGE_LIMIT"
                ? err.message
                : "This document could not be processed.",
            },
          };
        }
      })
    );

    const digitizedDocs = digitizeResults.filter((r) => r.ok).map((r) => ({ ...r.doc, doc_index: r.doc_index }));
    const digitizeFailures = digitizeResults.filter((r) => !r.ok).map((r) => r.failure);

    // Collect OCR warnings (partial, low_text_quality)
    const warnings = [];
    for (const r of digitizeResults) {
      if (r.ok && Array.isArray(r.doc.warnings)) {
        warnings.push(...r.doc.warnings);
      }
    }

    if (digitizedDocs.length === 0) {
      return apiError("NO_READABLE_DOCUMENTS", "Could not read any of the uploaded documents.", {
        request_id,
        durationMs: Date.now() - t0,
        failures: digitizeFailures,
      });
    }

    // ── Step 2: Stage A extraction per document ─────────────────────────────────
    const systemPromptStageA = buildStageASystemPrompt();
    const stageAResults = await Promise.all(
      digitizedDocs.map(async (doc) => {
        const effectiveIndex = typeof doc.doc_index === "number" ? doc.doc_index : 0;
        try {
          let mergedExtraction;
          const text = doc.text || "";
          if (text.length > MAX_CHARS_PER_SECTION) {
            const sections = sectionDocument(doc);
            // Warn if truncation happened (sections were capped)
            if (sections.length > 0 && sections[0]._truncated) {
              warnings.push({
                type: "truncation",
                file_name: doc.fileName || doc.title || `doc_${effectiveIndex + 1}`,
                message: `Document was very long and was split into ${sections.length} sections for analysis. Some content in the middle may be omitted.`,
                sections: sections.length,
                original_length: text.length,
              });
            } else if (sections.length > 1) {
              warnings.push({
                type: "sectioned",
                file_name: doc.fileName || doc.title || `doc_${effectiveIndex + 1}`,
                message: `Document split into ${sections.length} sections for processing.`,
                sections: sections.length,
              });
            }
            const sectionExtractions = await Promise.all(
              sections.map((sec) => runStageAWithRetry(sec, systemPromptStageA, signal))
            );
            mergedExtraction = mergeStageASections(sectionExtractions);
          } else {
            mergedExtraction = await runStageAWithRetry(doc, systemPromptStageA, signal);
          }

          mergedExtraction = {
            ...mergedExtraction,
            confidence: Math.max(0, Math.min(1, mergedExtraction.confidence)),
            required_documents: mergedExtraction.required_documents || [],
            prerequisites: mergedExtraction.prerequisites || [],
          };

          const deadline_days = computeDeadlineDays(mergedExtraction.deadline_date);
          const deadline_status = computeDeadlineStatus(
            deadline_days,
            mergedExtraction.deadline_relative_days !== null &&
              mergedExtraction.deadline_relative_days !== undefined &&
              deadline_days === null
          );

          return {
            ok: true,
            doc_index: effectiveIndex,
            extraction: {
              ...mergedExtraction,
              id: `doc${effectiveIndex + 1}`,
              doc_id: `doc${effectiveIndex + 1}`,
              doc_index: effectiveIndex,
              file_name: doc.fileName || doc.title || `doc_${effectiveIndex + 1}`,
              deadline_days,
              deadline_status,
            },
          };
        } catch (err) {
          if (err?.name === "AbortError" || signal.aborted) throw err;
          return {
            ok: false,
            doc_index: effectiveIndex,
            failure: {
              file_name: doc.fileName || doc.title || `doc_${effectiveIndex + 1}`,
              code: "EXTRACTION_FAILED",
              message: "This document could not be analyzed.",
            },
          };
        }
      })
    );

    stageAResults.sort((a, b) => a.doc_index - b.doc_index);
    const stageASuccesses = stageAResults.filter((r) => r.ok).map((r) => r.extraction);
    const stageAFailures = stageAResults.filter((r) => !r.ok).map((r) => r.failure);
    const allFailures = [...digitizeFailures, ...stageAFailures];

    if (stageASuccesses.length === 0) {
      return apiError("EXTRACTION_INVALID", "All document extractions failed.", {
        request_id,
        durationMs: Date.now() - t0,
        failures: allFailures,
      });
    }

    // ── Step 3: Validate evidence ───────────────────────────────────────────────
    const validatedExtractions = validateExtractions(stageASuccesses, digitizedDocs);
    const validationWarnings = getValidationWarnings(validatedExtractions);
    if (validationWarnings.length > 0) {
      warnings.push({
        type: "validation",
        message: `${validationWarnings.length} extraction(s) could not be fully verified against source documents.`,
        details: validationWarnings,
      });
    }

    // ── Step 4: Stage B — cross-document relationships ──────────────────────────
    let validatedEdges = [];
    let validatedConflicts = [];

    if (validatedExtractions.length >= 2) {
      const validDocIds = new Set(validatedExtractions.map((d) => d.id));
      const docTextById = new Map();
      const preparedTextById = new Map();
      digitizedDocs.forEach((d) => {
        const matchExt = validatedExtractions.find((e) => e.doc_index === d.doc_index);
        if (matchExt) {
          docTextById.set(matchExt.id, d.text || "");
          preparedTextById.set(matchExt.id, prepareSource(d.text || ""));
        }
      });

      const stageBInput = validatedExtractions.map((ext) => ({
        ...ext,
        text: docTextById.get(ext.id) || "",
      }));
      const stageBMsg = buildStageBUserMessage(stageBInput);
      const stageBSystem = buildStageBSystemPrompt();

      let stageBOutput = null;
      try {
        stageBOutput = await extractStructured({
          systemPrompt: stageBSystem,
          userMessage: stageBMsg.message,
          schema: STAGE_B_SCHEMA,
          signal,
        });
      } catch (err) {
        if (err.name === "AbortError" || signal.aborted) throw err;
        if (err instanceof SarvamError && !err.invalidOutput) {
          throw err;
        }
        if (err instanceof SarvamError && err.invalidOutput || !(err instanceof SarvamError)) {
          try {
            const repairPrompt = `${stageBSystem}\n\nIMPORTANT: Return ONLY a valid JSON object matching the schema. No markdown formatting.`;
            stageBOutput = await extractStructured({
              systemPrompt: repairPrompt,
              userMessage: stageBMsg.message,
              schema: STAGE_B_SCHEMA,
              signal,
            });
          } catch {
            warnings.push({ type: "dependency_analysis_failed", message: "Failed to complete Stage B dependency analysis" });
          }
        }
      }

      if (stageBOutput) {
        const parsedB = StageBOutputSchema.safeParse(stageBOutput);
        if (parsedB.success) {
          const seenEdges = new Set();
          for (const edge of parsedB.data.edges) {
            if (!validDocIds.has(edge.from_doc_id) || !validDocIds.has(edge.depends_on_doc_id)) {
              warnings.push({ type: "invalid_dependency_edge", message: `Dependency edge references unknown doc id: ${edge.from_doc_id} -> ${edge.depends_on_doc_id}` });
              continue;
            }
            if (edge.from_doc_id === edge.depends_on_doc_id) continue;
            const edgeKey = `${edge.from_doc_id}->${edge.depends_on_doc_id}`;
            if (seenEdges.has(edgeKey)) continue;
            seenEdges.add(edgeKey);

            if (edge.evidence_quote && typeof edge.evidence_quote === "string" && edge.evidence_quote.trim()) {
              let isVerified = false;
              if (edge.evidence_doc_id === edge.from_doc_id) {
                const v = validateEvidenceSnippet(edge.evidence_quote, docTextById.get(edge.evidence_doc_id) || "", preparedTextById.get(edge.evidence_doc_id));
                if (v?.valid) isVerified = true;
              }
              if (!isVerified) {
                warnings.push({ type: "unverified_dependency_evidence", message: `Dependency evidence quote from ${edge.from_doc_id} to ${edge.depends_on_doc_id} could not be verified in document` });
                continue;
              }
              // Verified evidence → high confidence (blocking)
              validatedEdges.push({
                from_doc_id: edge.from_doc_id,
                depends_on_doc_id: edge.depends_on_doc_id,
                reason: edge.reason,
                evidence_quote: edge.evidence_quote,
                evidence_doc_id: edge.evidence_doc_id || null,
                confidence: "high",
              });
            } else {
              // No evidence quote → medium confidence (informational, not blocking)
              validatedEdges.push({
                from_doc_id: edge.from_doc_id,
                depends_on_doc_id: edge.depends_on_doc_id,
                reason: edge.reason,
                evidence_quote: null,
                evidence_doc_id: null,
                confidence: "medium",
              });
            }
          }
          validatedConflicts = (parsedB.data.conflicts || []).filter(
            (c) => Array.isArray(c.doc_ids) && c.doc_ids.every((id) => validDocIds.has(id))
          );
          // B7: Add conflict notice to warnings so UI can surface it
          if (validatedConflicts.length > 0) {
            warnings.push({
              type: "conflicts",
              message: `${validatedConflicts.length} conflict(s) detected between documents.`,
              count: validatedConflicts.length,
            });
          }
        } else {
          warnings.push({ type: "dependency_analysis_failed", message: "Stage B output did not match expected schema" });
        }
      }
    }

    // ── Step 5: Run engines server-side ─────────────────────────────────────────
    const withConflicts = validatedExtractions.map((extraction) => ({
      ...extraction,
      conflicts: validatedConflicts
        .filter((conflict) => conflict.doc_ids.includes(extraction.id))
        .map((conflict) => conflict.description),
    }));
    const withDeps = resolveDependencies(withConflicts, validatedEdges);
    const plan = buildPriorityList(withDeps);
    const summary = buildWorkflowSummary(plan, metas.length);
    const reasoningSteps = generateReasoningSteps(plan, metas.length, allFailures.length);

    return ok({
      analysis_id: request_id,
      generated_at: new Date().toISOString(),
      timezone: env.APP_TIMEZONE,
      extractions: withDeps,
      dependencies: validatedEdges,
      conflicts: validatedConflicts,
      plan,
      summary,
      reasoning_steps: reasoningSteps,
      failures: allFailures,
      warnings,
      processing: digitizedDocs.map((d) => ({
        file_name: d.fileName,
        method: d.method,
        pages: d.pages ?? null,
        ms: d.ms,
      })),
    });
  } catch (err) {
    if (request.signal.aborted) {
      return new Response(null, { status: 499 });
    }
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      return apiError("UPSTREAM_TIMEOUT", "The analysis took too long. Try fewer or shorter documents.", {
        request_id,
        durationMs: Date.now() - t0,
      });
    }
    if (err instanceof SarvamError) {
      return mapSarvamError(err, request_id, Date.now() - t0);
    }
    console.error("[PathWise] extract unhandled:", err.message);
    return apiError("INTERNAL", "An unexpected error occurred. Please try again.", { request_id, durationMs: Date.now() - t0 });
  } finally {
    releaseExtractSlot();
  }
}
