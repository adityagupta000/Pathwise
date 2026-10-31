"use client";

import { useState } from "react";
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

  async function handleAnalyze(documents, docLanguage = "en-IN") {
    setLoading(true);
    setShowOutput(false);
    setNotice("");
    const startedAt = performance.now();

    try {
      // Call Sarvam extraction API
      // Send real files as multipart form data (not a JSON array of bytes).
      const form = new FormData();
      const metas = documents.map(({ file, ...meta }, i) => {
        if (file) form.append(`file_${i}`, file, file.name);
        return meta;
      });
      form.append("documents", JSON.stringify(metas));
      form.append("language", docLanguage);

      const res = await fetch("/api/extract", { method: "POST", body: form });

      const data = await res.json();

      // Check for API errors
      if (!res.ok || data.error) {
        setLoading(false);

        let errorMsg = `Error: ${data.error || "Unknown error"}\n\n`;
        errorMsg += `${data.details || "Please try again."}\n\n`;

        if (data.solution) {
          errorMsg += `Solution:\n${data.solution}\n\n`;
        }

        if (data.failures && data.failures.length > 0) {
          errorMsg += `Failed files:\n`;
          data.failures.forEach(f => {
            const name = f.file_name || f.fileName || "unknown";
            const errDetail = f.message || f.error || "failed";
            errorMsg += `• ${name}: ${errDetail}\n`;
          });
        }

        alert(errorMsg);
        return;
      }

      const extracted = Array.isArray(data.extractions) ? data.extractions : [];

      if (extracted.length === 0) {
        setLoading(false);
        alert("No information could be extracted from the documents.\n\nPlease check that your documents contain readable text and try again.");
        return;
      }

      // Validate extractions have required fields
      const validExtractions = extracted.filter(ext =>
        ext &&
        typeof ext === 'object' &&
        ext.required_action &&
        ext.document_type
      );

      if (validExtractions.length === 0) {
        setLoading(false);
        alert("Extracted data is incomplete or malformed.\n\nPlease try uploading your documents again.");
        return;
      }

      setExtractions(validExtractions);
      setSource(data.source || "sarvam");

      // Use plan generated server-side by /api/extract
      const plan = Array.isArray(data.plan) && data.plan.length > 0 ? data.plan : validExtractions;
      setPrioritized(plan);

      // Use reasoning steps and summary from server
      setReasoningSteps(Array.isArray(data.reasoning_steps) ? data.reasoning_steps : []);
      setSummary(data.summary || null);

      // Build notice message
      const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
      let noticeMsg = `Analysis finished in ${seconds}s.`;
      
      // Add failure notices
      if (Array.isArray(data.failures) && data.failures.length > 0) {
        noticeMsg += ` Could not read: ${data.failures.map((f) => `${f.file_name || f.fileName} (${f.message || f.error || 'error'})`).join("; ")}`;
      }
      
      // Add truncation warnings
      if (Array.isArray(data.warnings) && data.warnings.length > 0) {
        const truncWarnings = data.warnings.filter(w => w.type === "truncation");
        if (truncWarnings.length > 0) {
          noticeMsg += ` WARNING: Some documents were very long and truncated: ${truncWarnings.map(w => w.fileName).join(", ")}`;
        }
      }
      
      setNotice(noticeMsg);
      setAnalysisId((n) => n + 1);

      // Show results immediately - no artificial delay
      setLoading(false);
      setShowOutput(true);

      // Smooth scroll after a tick
      setTimeout(() => {
        const output = document.getElementById("output-section");
        if (output) {
          output.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 100);
    } catch (err) {
      console.error("Analysis error:", err);
      setLoading(false);
      alert(
        `Network Error\n\n` +
        `Could not connect to the analysis service.\n\n` +
        `Details: ${err.message}\n\n` +
        `Please check your internet connection and try again.`
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

      {/* Loading Animation */}
      <LoadingAnimation visible={loading} />

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
