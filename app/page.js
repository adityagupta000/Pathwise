"use client";

import { useState } from "react";
import DocumentCards from "@/components/DocumentCards";
import LoadingAnimation from "@/components/LoadingAnimation";
import SimpleWorkflow from "@/components/SimpleWorkflow";
import {
  resolveDependencies,
  buildPriorityList,
  generateReasoningSteps,
  buildWorkflowSummary,
} from "@/lib/engines";

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [showOutput, setShowOutput] = useState(false);
  const [prioritized, setPrioritized] = useState([]);
  const [reasoningSteps, setReasoningSteps] = useState([]);
  const [extractions, setExtractions] = useState([]);
  const [source, setSource] = useState("");
  const [summary, setSummary] = useState(null);

  async function handleAnalyze(documents) {
    setLoading(true);
    setShowOutput(false);

    try {
      // Call Sarvam extraction API
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documents }),
      });

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
            errorMsg += `• ${f.fileName}: ${f.error}\n`;
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

      // Run dependency engine
      const withDeps = resolveDependencies(validExtractions);

      // Run priority engine
      const sorted = buildPriorityList(withDeps);

      if (sorted.length === 0) {
        setLoading(false);
        alert("Failed to generate workflow priority list.\n\nPlease try again.");
        return;
      }

      setPrioritized(sorted);

      // Generate reasoning steps
      const steps = generateReasoningSteps(sorted);
      setReasoningSteps(steps);

      // Build summary
      const summaryData = buildWorkflowSummary(sorted);
      setSummary(summaryData);

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
            <SimpleWorkflow prioritized={prioritized} />
          </div>
        </section>
      )}
    </>
  );
}
