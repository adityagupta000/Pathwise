"use client";

import { useState, useRef, useEffect } from "react";
import DocumentCards from "@/components/DocumentCards";
import LoadingAnimation from "@/components/LoadingAnimation";
import SimpleWorkflow from "@/components/SimpleWorkflow";
import TranslatedSummary from "@/components/TranslatedSummary";
import Notice from "@/components/Notice";

export default function Home() {
  const [phase, setPhase] = useState("upload"); // "upload" | "loading" | "results" | "cancelled"
  const [prioritized, setPrioritized] = useState([]);
  const [reasoningSteps, setReasoningSteps] = useState([]);
  const [extractions, setExtractions] = useState([]);
  const [summary, setSummary] = useState(null);
  const [analysisId, setAnalysisId] = useState(0);
  const [notices, setNotices] = useState([]); // { id, type, title, message, failures }
  const [fileCount, setFileCount] = useState(0);

  const abortRef = useRef(null);

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
    abortRef.current?.abort();
    setPhase("upload");
    setPrioritized([]);
    setExtractions([]);
    setSummary(null);
    setReasoningSteps([]);
    clearNotices();
  }

  // Cleanup abort on unmount
  useEffect(() => () => abortRef.current?.abort(), []);

  async function handleAnalyze(documents, docLanguage = "en-IN") {
    clearNotices();
    setPhase("loading");
    setFileCount(documents.length);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const form = new FormData();
      const metas = documents.map(({ file, ...meta }, i) => {
        if (file) form.append(`file_${i}`, file, file.name);
        return meta;
      });
      form.append("documents", JSON.stringify(metas));
      form.append("language", docLanguage);

      const res = await fetch("/api/extract", {
        method: "POST",
        body: form,
        signal: ac.signal,
      });

      const data = await res.json();

      // 2.4 error contract: data.error is an object
      if (!res.ok || data.error) {
        const errMsg =
          (typeof data.error === "object" ? data.error?.message : data.error) ||
          "An unexpected error occurred.";
        const errCode = data.error?.code;

        setPhase("upload");
        addNotice({
          type: "error",
          title:
            errCode === "RATE_LIMITED"
              ? "Too Many Requests"
              : errCode === "SERVER_BUSY"
              ? "Service Busy"
              : errCode === "NO_READABLE_DOCUMENTS"
              ? "No Readable Content"
              : "Processing Error",
          message: errMsg,
          failures: data.failures,
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

      // Surface non-critical notices on results screen
      if (Array.isArray(data.failures) && data.failures.length > 0) {
        addNotice({
          type: "warning",
          title: "Some files could not be read",
          failures: data.failures,
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
            message: `Some documents were very long and truncated: ${truncWarnings.map((w) => w.fileName).join(", ")}`,
          });
        }
      }

      setPhase("results");
      setTimeout(() => {
        document.getElementById("output-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (err) {
      if (err.name === "AbortError") {
        setPhase("cancelled");
        return;
      }
      console.error("Analysis error:", err);
      setPhase("upload");
      addNotice({
        type: "error",
        title: "Network Error",
        message: `Could not connect to the analysis service. Details: ${err.message}. Please check your internet connection and try again.`,
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
            <DocumentCards onDocumentsReady={handleAnalyze} />
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
              {/* Start Over button (item 3.1) */}
              <div className="results-actions">
                <button
                  type="button"
                  className="btn-start-over"
                  onClick={startOver}
                  aria-label="Start over and upload new documents"
                >
                  &#8635; Start Over
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

              <SimpleWorkflow prioritized={prioritized} />
              <TranslatedSummary key={analysisId} prioritized={prioritized} />
            </div>
          </section>
        )}
      </main>
    </>
  );
}
