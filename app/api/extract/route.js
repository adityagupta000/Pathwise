import { NextResponse } from "next/server";
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
} from "@/lib/extraction";
import { rateLimit, clientIp } from "@/lib/limiter";
import { LANGUAGE_CODES } from "@/lib/languages";
import { validateExtractions, validateEvidenceSnippet, getValidationWarnings } from "@/lib/validation";
import { MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES, MAX_CHARS_PER_SECTION } from "@/lib/limits";
import { computeDeadlineDays, computeDeadlineStatus } from "@/lib/deadlines";
import {
  resolveDependencies,
  buildPriorityList,
  buildWorkflowSummary,
  generateReasoningSteps,
} from "@/lib/engines";

export const runtime = "nodejs";
export const maxDuration = 300; // seconds (only matters on platforms that enforce it)

const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_10_MIN || 10);

const MIME = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

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

const fail = (status, error, details, extra = {}) =>
  NextResponse.json({ error, details, ...extra }, { status });

/**
 * Merge deterministic sectioned extractions for a single document.
 */
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
    if (Array.isArray(s.required_documents)) {
      s.required_documents.forEach((d) => d && reqDocsSet.add(d.trim()));
    }
  });

  const prereqsSet = new Set();
  sections.forEach((s) => {
    if (Array.isArray(s.prerequisites)) {
      s.prerequisites.forEach((p) => p && prereqsSet.add(p.trim()));
    }
  });

  let earliestDeadline = null;
  let earliestDeadlineText = null;
  let earliestRelDays = null;
  let earliestRelAnchor = null;
  for (const s of sections) {
    if (s.deadline_date) {
      if (!earliestDeadline || s.deadline_date < earliestDeadline) {
        earliestDeadline = s.deadline_date;
        earliestDeadlineText = s.deadline_text;
        earliestRelDays = s.deadline_relative_days;
        earliestRelAnchor = s.deadline_relative_anchor;
      }
    }
  }
  if (!earliestDeadline) {
    const withText = sections.find((s) => s.deadline_text);
    if (withText) {
      earliestDeadlineText = withText.deadline_text;
      earliestRelDays = withText.deadline_relative_days;
      earliestRelAnchor = withText.deadline_relative_anchor;
    }
  }

  const anyUncertain = sections.some((s) => s.information_type === "uncertain");
  const informationType = anyUncertain
    ? "uncertain"
    : sections.some((s) => s.information_type === "clearly_inferred")
    ? "clearly_inferred"
    : "explicitly_stated";

  return {
    ...bestSection,
    required_documents: Array.from(reqDocsSet),
    prerequisites: Array.from(prereqsSet),
    deadline_date: earliestDeadline,
    deadline_text: earliestDeadlineText || bestSection.deadline_text || null,
    deadline_relative_days: earliestRelDays ?? bestSection.deadline_relative_days ?? null,
    deadline_relative_anchor: earliestRelAnchor ?? bestSection.deadline_relative_anchor ?? null,
    confidence: Number(avgConf.toFixed(2)),
    information_type: informationType,
    evidence_snippet: bestSection.evidence_snippet || null,
  };
}

/**
 * Run Stage A LLM extraction with a single retry on error.
 */
async function runStageAWithRetry(docSection, systemPrompt) {
  const userMsg = buildStageAUserMessage(docSection);
  try {
    return await extractStructured({
      systemPrompt,
      userMessage: userMsg.message,
      schema: STAGE_A_SCHEMA,
    });
  } catch (err) {
    const repairPrompt = `${systemPrompt}\n\nIMPORTANT: Return ONLY a valid JSON object matching the schema. No markdown formatting.`;
    return await extractStructured({
      systemPrompt: repairPrompt,
      userMessage: userMsg.message,
      schema: STAGE_A_SCHEMA,
    });
  }
}

/**
 * Digitise one uploaded file.
 */
async function digitise(meta, file, language) {
  const t0 = Date.now();

  if (meta.fileType !== "pdf" && meta.fileType !== "image") {
    return { ...meta, method: "text", ms: 0 };
  }
  if (!file) throw new Error("File data is missing from the upload.");

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = (meta.fileName || file.name || "").toLowerCase().split(".").pop();
  const mimeType = MIME[ext];
  if (!mimeType) {
    throw new Error(`Unsupported file type ".${ext}". Use PDF, PNG or JPG.`);
  }

  if (meta.fileType === "pdf") {
    let layer = null;
    try {
      layer = await readPdfTextLayer(buffer);
    } catch {
      /* encrypted or unusual PDF: let Sarvam try */
    }
    if (layer?.hasTextLayer) {
      return { ...meta, text: layer.text, pages: layer.pages, method: "text-layer", ms: Date.now() - t0 };
    }
    if (layer && layer.pages > MAX_PARSE_PAGES) {
      throw new Error(`Scanned PDF has ${layer.pages} pages; OCR accepts up to ${MAX_PARSE_PAGES}. Split it and upload the parts.`);
    }
  }

  const parsed = await parseDocument({ buffer, fileName: meta.fileName || file.name, mimeType, language });
  return { ...meta, text: parsed.text, pages: parsed.pages, method: "sarvam-ocr", ms: Date.now() - t0 };
}

export async function POST(request) {
  try {
    // Rate limit
    const rl = rateLimit(`extract:${clientIp(request)}`, { limit: RATE_LIMIT, windowMs: 10 * 60 * 1000 });
    if (!rl.ok) {
      return fail(429, "Too many requests", `Please try again in ${Math.ceil(rl.retryAfterSec / 60)} minute(s).`);
    }

    let form;
    try {
      form = await request.formData();
    } catch {
      return fail(400, "Invalid upload", "Send the documents as multipart form data.");
    }

    let metas;
    try {
      metas = JSON.parse(form.get("documents") || "[]");
    } catch {
      return fail(400, "Invalid request", "The 'documents' field must be valid JSON.");
    }
    if (!Array.isArray(metas) || metas.length === 0) {
      return fail(400, "No documents provided", "Please upload at least one document to analyze.");
    }
    if (metas.length > MAX_FILES) {
      return fail(400, "Too many documents", `Upload at most ${MAX_FILES} documents at a time.`);
    }

    const language = LANGUAGE_CODES.has(form.get("language")) ? form.get("language") : "en-IN";

    // Size checks
    let totalBytes = 0;
    for (let i = 0; i < metas.length; i++) {
      const f = form.get(`file_${i}`);
      if (f && typeof f !== "string") {
        if (f.size > MAX_FILE_BYTES) {
          return fail(413, "File too large", `${f.name} is over ${MAX_FILE_BYTES / 1024 / 1024} MB.`, {
            failures: [
              {
                file_name: f.name,
                fileName: f.name,
                code: "SIZE_EXCEEDED",
                message: `File exceeds limit of ${MAX_FILE_BYTES / 1024 / 1024} MB.`,
              },
            ],
          });
        }
        totalBytes += f.size;
      }
    }
    if (totalBytes > MAX_TOTAL_BYTES) {
      return fail(413, "Upload too large", `Total upload is over ${MAX_TOTAL_BYTES / 1024 / 1024} MB.`, {
        failures: [
          {
            file_name: "upload",
            fileName: "upload",
            code: "SIZE_EXCEEDED",
            message: `Total upload exceeds limit of ${MAX_TOTAL_BYTES / 1024 / 1024} MB.`,
          },
        ],
      });
    }

    // Step 1: Digitize all docs in parallel
    const digitizeResults = await Promise.all(
      metas.map(async (meta, i) => {
        try {
          const file = form.get(`file_${i}`);
          const digitized = await digitise(meta, typeof file === "string" ? null : file, language);
          return { ok: true, doc_index: i, doc: digitized };
        } catch (err) {
          return {
            ok: false,
            doc_index: i,
            failure: {
              file_name: meta.fileName || meta.title || `doc_${i + 1}`,
              fileName: meta.fileName || meta.title || `doc_${i + 1}`,
              code: "DIGITIZE_FAILED",
              message: err.message,
            },
          };
        }
      })
    );

    const digitizedDocs = digitizeResults.filter((r) => r.ok).map((r) => r.doc);
    const digitizeFailures = digitizeResults.filter((r) => !r.ok).map((r) => r.failure);

    if (digitizedDocs.length === 0) {
      return fail(400, "Document Processing Failed", "Could not read any of the uploaded documents.", {
        failures: digitizeFailures,
      });
    }

    // Step 2: Stage A extraction per document (in parallel)
    const systemPromptStageA = buildStageASystemPrompt();
    const stageAResults = await Promise.all(
      digitizedDocs.map(async (doc) => {
        const docIndex = metas.findIndex((m) => m === doc || m.fileName === doc.fileName);
        const effectiveIndex = docIndex >= 0 ? docIndex : 0;
        try {
          let mergedExtraction;
          const text = doc.text || "";
          if (text.length > MAX_CHARS_PER_SECTION) {
            const sections = sectionDocument(doc);
            const sectionExtractions = await Promise.all(
              sections.map((sec) => runStageAWithRetry(sec, systemPromptStageA))
            );
            mergedExtraction = mergeStageASections(sectionExtractions);
          } else {
            mergedExtraction = await runStageAWithRetry(doc, systemPromptStageA);
          }

          if (!mergedExtraction || typeof mergedExtraction !== "object") {
            throw new Error("Invalid Stage A extraction output structure");
          }

          const deadline_days = computeDeadlineDays(mergedExtraction.deadline_date);
          const deadline_status = computeDeadlineStatus(
            deadline_days,
            Boolean(mergedExtraction.deadline_relative_days)
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
          return {
            ok: false,
            doc_index: effectiveIndex,
            failure: {
              file_name: doc.fileName || doc.title || `doc_${effectiveIndex + 1}`,
              fileName: doc.fileName || doc.title || `doc_${effectiveIndex + 1}`,
              code: "EXTRACTION_FAILED",
              message: err.message,
            },
          };
        }
      })
    );

    // Keep stable sorting by doc_index
    stageAResults.sort((a, b) => a.doc_index - b.doc_index);

    const stageASuccesses = stageAResults.filter((r) => r.ok).map((r) => r.extraction);
    const stageAFailures = stageAResults.filter((r) => !r.ok).map((r) => r.failure);
    const allFailures = [...digitizeFailures, ...stageAFailures];

    if (stageASuccesses.length === 0) {
      return fail(400, "Extraction Failed", "All document extractions failed.", {
        failures: allFailures,
      });
    }

    // Step 3: Validate evidence (lib/validation.js)
    const validatedExtractions = validateExtractions(stageASuccesses, digitizedDocs);
    const validationWarnings = getValidationWarnings(validatedExtractions);

    const warnings = [];
    if (validationWarnings.length > 0) {
      warnings.push({
        type: "validation",
        message: `${validationWarnings.length} extraction(s) could not be fully verified against source documents.`,
        details: validationWarnings,
      });
    }

    // Step 4: Stage B — cross-document relationships (if >= 2 Stage A successes)
    let validatedEdges = [];
    let validatedConflicts = [];

    if (validatedExtractions.length >= 2) {
      const validDocIds = new Set(validatedExtractions.map((d) => d.id));
      const docTextById = new Map();
      digitizedDocs.forEach((d) => {
        const matchExt = validatedExtractions.find(
          (e) => e.file_name === d.fileName || e.file_name === d.title
        );
        if (matchExt) {
          docTextById.set(matchExt.id, d.text || "");
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
        });
      } catch (err) {
        // Retry once
        try {
          const repairPrompt = `${stageBSystem}\n\nIMPORTANT: Return ONLY a valid JSON object matching the schema. No markdown formatting.`;
          stageBOutput = await extractStructured({
            systemPrompt: repairPrompt,
            userMessage: stageBMsg.message,
            schema: STAGE_B_SCHEMA,
          });
        } catch {
          warnings.push({
            type: "dependency_analysis_failed",
            message: "Failed to complete Stage B dependency analysis",
          });
        }
      }

      if (stageBOutput) {
        const parsedB = StageBOutputSchema.safeParse(stageBOutput);
        if (parsedB.success) {
          const seenEdges = new Set();
          for (const edge of parsedB.data.edges) {
            // Check IDs exist
            if (!validDocIds.has(edge.from_doc_id) || !validDocIds.has(edge.depends_on_doc_id)) {
              warnings.push({
                type: "invalid_dependency_edge",
                message: `Dependency edge references unknown doc id: ${edge.from_doc_id} -> ${edge.depends_on_doc_id}`,
              });
              continue;
            }

            // Drop self edges
            if (edge.from_doc_id === edge.depends_on_doc_id) {
              continue;
            }

            // Deduplicate
            const edgeKey = `${edge.from_doc_id}->${edge.depends_on_doc_id}`;
            if (seenEdges.has(edgeKey)) {
              continue;
            }
            seenEdges.add(edgeKey);

            // Validate evidence quote if present
            if (edge.evidence_quote && typeof edge.evidence_quote === "string" && edge.evidence_quote.trim()) {
              let isVerified = false;
              if (edge.evidence_doc_id && validDocIds.has(edge.evidence_doc_id)) {
                const targetText = docTextById.get(edge.evidence_doc_id) || "";
                const v = validateEvidenceSnippet(edge.evidence_quote, targetText);
                if (v && v.valid) isVerified = true;
              }
              if (!isVerified) {
                const text1 = docTextById.get(edge.from_doc_id) || "";
                const text2 = docTextById.get(edge.depends_on_doc_id) || "";
                const v1 = validateEvidenceSnippet(edge.evidence_quote, text1);
                const v2 = validateEvidenceSnippet(edge.evidence_quote, text2);
                if ((v1 && v1.valid) || (v2 && v2.valid)) isVerified = true;
              }

              if (!isVerified) {
                warnings.push({
                  type: "unverified_dependency_evidence",
                  message: `Dependency evidence quote from ${edge.from_doc_id} to ${edge.depends_on_doc_id} could not be verified in document`,
                });
                continue; // drop edge
              }
            }

            validatedEdges.push({
              from_doc_id: edge.from_doc_id,
              depends_on_doc_id: edge.depends_on_doc_id,
              reason: edge.reason,
              evidence_quote: edge.evidence_quote || null,
              evidence_doc_id: edge.evidence_doc_id || null,
            });
          }

          // Validate conflicts
          validatedConflicts = (parsedB.data.conflicts || []).filter(
            (c) => Array.isArray(c.doc_ids) && c.doc_ids.every((id) => validDocIds.has(id))
          );
        } else {
          warnings.push({
            type: "dependency_analysis_failed",
            message: "Stage B output did not match expected schema",
          });
        }
      }
    }

    // Step 5: Run engines server-side
    const withDeps = resolveDependencies(validatedExtractions, validatedEdges);
    const plan = buildPriorityList(withDeps);
    const summary = buildWorkflowSummary(plan, metas.length);
    const reasoningSteps = generateReasoningSteps(plan);

    return NextResponse.json({
      analysis_id: crypto.randomUUID(),
      generated_at: new Date().toISOString(),
      timezone: process.env.APP_TIMEZONE || "Asia/Kolkata",
      extractions: withDeps,
      dependencies: validatedEdges,
      conflicts: validatedConflicts,
      plan,
      summary,
      reasoning_steps: reasoningSteps,
      failures: allFailures,
      warnings,
      processing: digitizedDocs.map((d) => ({
        fileName: d.fileName,
        method: d.method,
        pages: d.pages ?? null,
        ms: d.ms,
      })),
    });
  } catch (err) {
    console.error("[PathWise] extract failed:", err.message);
    const status = err instanceof SarvamError && err.status >= 400 && err.status < 600 ? err.status : 500;
    return fail(status === 401 ? 502 : status, "Processing Error", err.message || "An unexpected error occurred.");
  }
}
