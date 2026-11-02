"use client";

import { useState, useRef, useEffect } from "react";
import DocumentCards from "@/components/DocumentCards";
import { getDefaultDocs } from "@/components/DocumentCards";
import LoadingAnimation from "@/components/LoadingAnimation";
import SimpleWorkflow from "@/components/SimpleWorkflow";
import TranslatedSummary from "@/components/TranslatedSummary";
import Notice from "@/components/Notice";
import NextActionCard from "@/components/NextActionCard";
import WorkflowSummary from "@/components/WorkflowSummary";
import AIReasoningPanel from "@/components/AIReasoningPanel";
import DocumentInsights from "@/components/DocumentInsights";

export default function Home() {
  const [phase, setPhase] = useState("upload"); // "upload" | "loading" | "results" | "cancelled"
  const [prioritized, setPrioritized] = useState([]);
  const [reasoningSteps, setReasoningSteps] = useState([]);
  const [extractions, setExtractions] = useState([]);
  const [summary, setSummary] = useState(null);
  const [analysisId, setAnalysisId] = useState(0);
  const [notices, setNotices] = useState([]); // { id, type, title, message, failures }
  const [fileCount, setFileCount] = useState(0);

  // Lifted document state (item 3.1) — DocumentCards is now a controlled component.
  const [documents, setDocuments] = useState(() => getDefaultDocs());
  const [docLanguage, setDocLanguage] = useState("en-IN");

  const abortRef = useRef(null);
  const analysisRunRef = useRef(0);
  const resultsHeadingRef = useRef(null);

  // Focus results heading when phase transitions to "results" (item 3.1 — focus management).
  useEffect(() => {
    if (phase === "results") {
      resultsHeadingRef.current?.focus();
    }
  }, [phase]);

  function cancelAnalysis() {
    abortRef.current?.abort();
  }

  function addNotice(notice) {
    const id = Date.now() + Math.random();
    setNotices((prev) => [...prev, { id, ...notice }]);
    return id;
  }

  function removeNotice(id) {
    setNotices((prev) => prev.filter((n) => n.id !== id));
  }

  function clearNotices() {
    setNotices([]);
  }

  function startOver() {
    if (documents.length > 0) {
      const confirmed = window.confirm("This will clear all documents and results. Continue?");
      if (!confirmed) return;
    }
    analysisRunRef.current += 1;
    abortRef.current?.abort();
    setPhase("upload");
    setPrioritized([]);
    setExtractions([]);
    setSummary(null);
    setReasoningSteps([]);
    setDocuments([]);
    clearNotices();
  }

  function editDocuments() {
    analysisRunRef.current += 1;
    abortRef.current?.abort();
    clearNotices();
    setPhase("upload");
    // Documents are preserved — user can edit and re-analyze.
  }

  // Cleanup abort on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  async function handleAnalyze(docs, lang) {
    const docsToUse = docs !== undefined ? docs : documents;
    const langToUse = lang !== undefined ? lang : docLanguage;

    clearNotices();
    setPhase("loading");
    setFileCount(docsToUse.length);

    const ac = new AbortController();
    abortRef.current = ac;
    const runId = ++analysisRunRef.current;

    try {
      const form = new FormData();
      const metas = docsToUse.map(({ file, ...meta }, i) => {
        if (file) {
          form.append(`file_${i}`, file, file.name);
          const { text, sizeBytes, ...fileMeta } = meta;
          return fileMeta;
        }
        return meta;
      });
      form.append("documents", JSON.stringify(metas));
      form.append("language", langToUse);

      const res = await fetch("/api/extract", {
        method: "POST",
        body: form,
        signal: ac.signal,
      });

      // Guard: non-JSON proxy errors (item 3.2).
      const ct = res.headers.get("content-type") || "";
      const data = ct.includes("application/json") ? await res.json() : {};
      if (runId !== analysisRunRef.current) return;

      // 2.4 error contract: data.error is an object.
      if (!res.ok || data.error) {
        const errObj = typeof data.error === "object" ? data.error : {};
        const errMsg = errObj.message || (typeof data.error === "string" ? data.error : null);
        const errCode = errObj.code;
        const reqId = errObj.request_id;

        // Map status codes to user-friendly messages (item 3.2).
        let friendlyMsg = errMsg || "An unexpected error occurred.";
        if (res.status === 413 || errCode === "FILE_TOO_LARGE" || errCode === "TOO_MANY_FILES") {
          friendlyMsg = errMsg || "Files too large. Maximum 25 MB per file, 60 MB total.";
        } else if (res.status === 429 || errCode === "RATE_LIMITED") {
          const retryAfter = errObj.retry_after_sec;
          friendlyMsg = retryAfter
            ? `Too many requests — please wait ${retryAfter} seconds and try again.`
            : "Too many requests. Please wait a moment and try again.";
        } else if (
          res.status === 502 || res.status === 503 || res.status === 504 ||
          errCode === "UPSTREAM_RATE_LIMITED" || errCode === "UPSTREAM_TIMEOUT" || errCode === "SERVER_BUSY"
        ) {
          friendlyMsg = errMsg || "Service is busy — please retry in a moment.";
        }

        setPhase("upload");
        addNotice({
          type: "error",
          title:
            errCode === "RATE_LIMITED" ? "Too Many Requests"
            : errCode === "SERVER_BUSY" || res.status >= 502 ? "Service Busy"
            : errCode === "NO_READABLE_DOCUMENTS" ? "No Readable Content"
            : errCode === "FILE_TOO_LARGE" || errCode === "TOO_MANY_FILES" || res.status === 413 ? "File Size Error"
            : "Processing Error",
          message: reqId
            ? `${friendlyMsg}\n\nRequest ID: ${reqId}`
            : friendlyMsg,
          failures: data.error?.failures || data.failures,
        });
        return;
      }

      const extracted = Array.isArray(data.extractions) ? data.extractions : [];
      if (extracted.length === 0) {
        setPhase("upload");
        addNotice({
          type: "error",
          title: "Nothing Extracted",
          message:
            "No information could be extracted from the documents. Please check that your documents contain readable text and try again.",
        });
        return;
      }

      const validExtractions = extracted.filter(
        (ext) => ext && typeof ext === "object" && ext.required_action && ext.document_type
      );
      if (validExtractions.length === 0) {
        setPhase("upload");
        addNotice({
          type: "error",
          title: "Incomplete Data",
          message:
            "Extracted data is incomplete or malformed. Please try uploading your documents again.",
        });
        return;
      }

      setExtractions(validExtractions);
      const plan = Array.isArray(data.plan) && data.plan.length > 0 ? data.plan : validExtractions;
      setPrioritized(plan);
      setReasoningSteps(Array.isArray(data.reasoning_steps) ? data.reasoning_steps : []);
      setSummary(data.summary || null);
      setAnalysisId((n) => n + 1);

      // Surface non-critical notices on results screen.
      if (Array.isArray(data.failures) && data.failures.length > 0) {
        addNotice({
          type: "warning",
          title: "Some files could not be read",
          failures: data.error?.failures || data.failures,
        });
      }
      if (Array.isArray(data.warnings) && data.warnings.length > 0) {
        const ocrWarnings = data.warnings.filter(
          (w) => w.type === "partial_ocr" || w.type === "low_text_quality"
        );
        if (ocrWarnings.length > 0) {
          addNotice({
            type: "info",
            title: "OCR quality notice",
            message: ocrWarnings.map((w) => w.message).join(" "),
          });
        }
        const truncWarnings = data.warnings.filter((w) => w.type === "truncation");
        if (truncWarnings.length > 0) {
          addNotice({
            type: "warning",
            title: "Documents truncated",
            message: `Some documents were very long and truncated: ${truncWarnings.map((w) => w.file_name || w.fileName).join(", ")}`,
          });
        }
        // C2: sectioned warning
        const sectionedWarnings = data.warnings.filter((w) => w.type === "sectioned");
        if (sectionedWarnings.length > 0) {
          addNotice({
            type: "info",
            title: "Long documents split for analysis",
            message: `${sectionedWarnings.length} document(s) were split into sections for analysis: ${sectionedWarnings.map((w) => w.file_name || w.fileName).join(", ")}`,
          });
        }
        // C2: validation warnings
        const validationWarnings = data.warnings.filter((w) => w.type === "validation");
        if (validationWarnings.length > 0) {
          addNotice({
            type: "info",
            title: "Verification notice",
            message: `Some extracted details could not be fully verified: ${validationWarnings.map((w) => {
              const details = Array.isArray(w.details)
                ? w.details.flatMap((detail) => detail.issues || []).join(", ")
                : "";
              return [w.message || w.file_name, details].filter(Boolean).join(" — ");
            }).filter(Boolean).join("; ")}`,
          });
        }
        // C2: conflicts warning
        const conflictWarnings = data.warnings.filter((w) => w.type === "conflicts");
        if (conflictWarnings.length > 0) {
          addNotice({
            type: "warning",
            title: "Conflicting information detected",
            message: conflictWarnings.map((w) => w.message).filter(Boolean).join("; "),
          });
        }
        // C2: dependency edge warnings — aggregate
        const edgeDropped = data.warnings.filter(
          (w) => w.type === "invalid_dependency_edge" || w.type === "unverified_dependency_evidence"
        );
        if (edgeDropped.length > 0) {
          addNotice({
            type: "info",
            title: "Dependency suggestions",
            message: `${edgeDropped.length} suggested link${edgeDropped.length !== 1 ? "s" : ""} dropped because they could not be verified.`,
          });
        }
        // C2: dependency_analysis_failed
        const depFailed = data.warnings.filter((w) => w.type === "dependency_analysis_failed");
        if (depFailed.length > 0) {
          addNotice({
            type: "warning",
            title: "Dependency analysis incomplete",
            message: "Some dependency relationships could not be determined. Results may be incomplete.",
          });
        }
      }

      setPhase("results");
      setTimeout(() => {
        const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        document.getElementById("output-section")?.scrollIntoView({
          behavior: prefersReduced ? "instant" : "smooth",
          block: "start",
        });
      }, 100);
    } catch (err) {
      if (runId !== analysisRunRef.current) return;
      if (err.name === "AbortError") {
        setPhase("cancelled");
        return;
      }
      console.error("Analysis error:", err.message);
      setPhase("upload");
      addNotice({
        type: "error",
        title: "Network Error",
        message: `Could not connect to the analysis service: ${err.message}. Please check your connection and try again.`,
      });
    }
  }

  return (
    <>
      {/* Skip-link for keyboard users (item 3.7 a11y) */}
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      {/* Header */}
      <header>
        <div className="container">
          <div className="logo">
            <div className="logo-icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                width="22"
                height="22"
                aria-hidden="true"
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
            </div>
            <div className="logo-text">
              Path<span>Wise</span>
            </div>
          </div>
          <p className="tagline">
            AI Government Workflow Planner &mdash; Turn multiple government notices into one clear
            action plan by finding dependencies between them.
          </p>
        </div>
      </header>

      <main id="main-content">
        {/* Upload / cancelled phase */}
        {(phase === "upload" || phase === "cancelled") && (
          <>
            {/* Inline notices (replace alert() — item 3.2) */}
            {notices.length > 0 && (
              <div className="container" style={{ marginTop: "1rem" }}>
                {notices.map((n) => (
                  <Notice
                    key={n.id}
                    type={n.type}
                    title={n.title}
                    message={n.message}
                    failures={n.failures}
                    onDismiss={() => removeNotice(n.id)}
                  />
                ))}
              </div>
            )}
            {phase === "cancelled" && notices.length === 0 && (
              <div className="container" style={{ marginTop: "1rem" }}>
                <Notice
                  type="info"
                  title="Analysis cancelled"
                  message="You can upload documents and try again."
                />
              </div>
            )}
            {/* Controlled DocumentCards — documents/docLanguage state lives here (item 3.1) */}
            <DocumentCards
              documents={documents}
              setDocuments={setDocuments}
              docLanguage={docLanguage}
              setDocLanguage={setDocLanguage}
              onDocumentsReady={handleAnalyze}
            />
          </>
        )}

        {/* Loading phase */}
        <LoadingAnimation
          visible={phase === "loading"}
          fileCount={fileCount}
          onCancel={cancelAnalysis}
        />

        {/* Results phase */}
        {phase === "results" && (
          <section className="output-section visible" id="output-section">
            <div className="container">
              {/* Results heading — focus target for phase transition (item 3.1) */}
              <h2
                ref={resultsHeadingRef}
                tabIndex={-1}
                className="sr-only"
                aria-label="Analysis results"
              >
                Analysis Results
              </h2>

              {/* Action buttons (item 3.1) */}
              <div className="results-actions">
                <button
                  type="button"
                  className="btn-start-over"
                  onClick={startOver}
                  aria-label="Start over and clear all documents"
                >
                  &#8635; Start Over
                </button>
                <button
                  type="button"
                  className="btn-edit-docs"
                  onClick={editDocuments}
                  aria-label="Edit documents and re-analyze"
                >
                  &#9998; Edit Documents
                </button>
              </div>

              {/* Result-screen notices */}
              {notices.length > 0 && (
                <div style={{ marginBottom: "1.5rem" }}>
                  {notices.map((n) => (
                    <Notice
                      key={n.id}
                      type={n.type}
                      title={n.title}
                      message={n.message}
                      failures={n.failures}
                      onDismiss={() => removeNotice(n.id)}
                    />
                  ))}
                </div>
              )}

              {/* Hero: first priority action (item 3.3) */}
              {prioritized.length > 0 && <NextActionCard action={prioritized[0]} />}

              {/* Workflow stats summary (item 3.3) */}
              {summary && <WorkflowSummary summary={summary} />}

              {/* AI reasoning chain — collapsible (item 3.3) */}
              {reasoningSteps.length > 0 && (
                <details style={{ marginBottom: "1.5rem" }}>
                  <summary
                    style={{ cursor: "pointer", fontWeight: 700, fontSize: "0.9rem", marginBottom: "0.5rem" }}
                  >
                    How PathWise decided
                  </summary>
                  <AIReasoningPanel steps={reasoningSteps} />
                </details>
              )}

              {/* Document insights (item 3.3) */}
              {extractions.length > 0 && <DocumentInsights prioritized={extractions} />}

              {/* Main action-plan table */}
              <SimpleWorkflow prioritized={prioritized} />

              {/* Translation (key resets cache per analysis) */}
              <TranslatedSummary key={analysisId} prioritized={prioritized} />
            </div>
          </section>
        )}
      </main>
    </>
  );
}
