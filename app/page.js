"use client";

import { useState, useRef, useEffect } from "react";
import DocumentCards from "@/components/DocumentCards";
import LoadingAnimation from "@/components/LoadingAnimation";
import SimpleWorkflow from "@/components/SimpleWorkflow";
import TranslatedSummary from "@/components/TranslatedSummary";

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [showOutput, setShowOutput] = useState(false);
  const [prioritized, setPrioritized] = useState([]);
  const [reasoningSteps, setReasoningSteps] = useState([]);
  const [extractions, setExtractions] = useState([]);
  const [source, setSource] = useState("");
  const [summary, setSummary] = useState(null);
  const [analysisId, setAnalysisId] = useState(0);
  const [notice, setNotice] = useState("");
  const [cancelled, setCancelled] = useState(false);
  const [fileCount, setFileCount] = useState(0);

  // AbortController for the current in-flight request (item 2.7)
  const abortRef = useRef(null);

  function cancelAnalysis() {
    abortRef.current?.abort();
  }

  // Cleanup on unmount
  useEffect(() => () => abortRef.current?.abort(), []);

  async function handleAnalyze(documents, docLanguage = "en-IN") {
    setCancelled(false);
    setLoading(true);
    setShowOutput(false);
    setNotice("");
    setFileCount(documents.length);

    // Create a fresh AbortController for this request
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

      // 2.4: read new error contract { error: { message } }
      if (!res.ok || data.error) {
        setLoading(false);

        const errMsg =
          (typeof data.error === "object" ? data.error?.message : data.error) ||
          data.details ||
          "Unknown error";

        let alertMsg = `Error: ${errMsg}\n\n`;
        if (data.failures && data.failures.length > 0) {
          alertMsg += `Failed files:\n`;
          data.failures.forEach((f) => {
            const name = f.file_name || f.fileName || "unknown";
            const errDetail = f.message || f.error || "failed";
            alertMsg += `• ${name}: ${errDetail}\n`;
          });
        }

        alert(alertMsg);
        return;
      }

      const extracted = Array.isArray(data.extractions) ? data.extractions : [];
      if (extracted.length === 0) {
        setLoading(false);
        alert("No information could be extracted from the documents.\n\nPlease check that your documents contain readable text and try again.");
        return;
      }

      const validExtractions = extracted.filter(
        (ext) => ext && typeof ext === "object" && ext.required_action && ext.document_type
      );
      if (validExtractions.length === 0) {
        setLoading(false);
        alert("Extracted data is incomplete or malformed.\n\nPlease try uploading your documents again.");
        return;
      }

      setExtractions(validExtractions);
      setSource(data.source || "sarvam");

      const plan = Array.isArray(data.plan) && data.plan.length > 0 ? data.plan : validExtractions;
      setPrioritized(plan);
      setReasoningSteps(Array.isArray(data.reasoning_steps) ? data.reasoning_steps : []);
      setSummary(data.summary || null);

      let noticeMsg = "";
      if (Array.isArray(data.failures) && data.failures.length > 0) {
        noticeMsg += `Could not read: ${data.failures
          .map((f) => `${f.file_name || f.fileName} (${f.message || f.error || "error"})`)
          .join("; ")}\n`;
      }
      if (Array.isArray(data.warnings) && data.warnings.length > 0) {
        const truncWarnings = data.warnings.filter((w) => w.type === "truncation");
        if (truncWarnings.length > 0) {
          noticeMsg += `WARNING: Some documents were very long and truncated: ${truncWarnings
            .map((w) => w.fileName)
            .join(", ")}`;
        }
      }
      setNotice(noticeMsg.trim());
      setAnalysisId((n) => n + 1);

      setLoading(false);
      setShowOutput(true);

      setTimeout(() => {
        const output = document.getElementById("output-section");
        if (output) output.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (err) {
      setLoading(false);
      if (err.name === "AbortError") {
        setCancelled(true);
        return;
      }
      console.error("Analysis error:", err);
      alert(
        `Network Error\n\nCould not connect to the analysis service.\n\nDetails: ${err.message}\n\nPlease check your internet connection and try again.`
      );
    }
  }

  const nextAction = prioritized[0] || null;

  return (
    <>
      {/* Header */}
      <header>
        <div className="container">
          <div className="logo">
            <div className="logo-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </div>
            <div className="logo-text">
              Path<span>Wise</span>
            </div>
          </div>
          <p className="tagline">
            AI Government Workflow Planner — Turn multiple government notices
            into one clear action plan by finding dependencies between them.
          </p>
        </div>
      </header>

      {/* Document Cards + Analyze Button */}
      {!loading && !showOutput && (
        <DocumentCards onDocumentsReady={handleAnalyze} />
      )}

      {/* Loading Animation (2.7) */}
      <LoadingAnimation
        visible={loading}
        fileCount={fileCount}
        onCancel={cancelAnalysis}
      />

      {/* Cancelled notice */}
      {cancelled && !loading && !showOutput && (
        <section className="output-section visible" id="output-section">
          <div className="container">
            <p className="summary-error">Analysis cancelled. You can upload documents again.</p>
          </div>
        </section>
      )}

      {/* Output Section */}
      {showOutput && (
        <section className="output-section visible" id="output-section">
          <div className="container">
            {notice && <p className="summary-error">{notice}</p>}
            <SimpleWorkflow prioritized={prioritized} />
            <TranslatedSummary key={analysisId} prioritized={prioritized} />
          </div>
        </section>
      )}
    </>
  );
}
