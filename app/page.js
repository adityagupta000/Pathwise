"use client";

import { useState } from "react";
import DocumentCards from "@/components/DocumentCards";
import LoadingAnimation from "@/components/LoadingAnimation";
import NextActionCard from "@/components/NextActionCard";
import AIReasoningPanel from "@/components/AIReasoningPanel";
import ExtractedInfoAccordion from "@/components/ExtractedInfoAccordion";
import PriorityList from "@/components/PriorityList";
import WorkflowGraph from "@/components/WorkflowGraph";
import WorkflowSummary from "@/components/WorkflowSummary";
import SuccessTimeline from "@/components/SuccessTimeline";
import WorkflowHeader from "@/components/WorkflowHeader";
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
      const extracted = data.extractions || [];
      setExtractions(extracted);
      setSource(data.source || "fallback");

      // Run dependency engine
      const withDeps = resolveDependencies(extracted);

      // Run priority engine
      const sorted = buildPriorityList(withDeps);
      setPrioritized(sorted);

      // Generate reasoning steps
      const steps = generateReasoningSteps(sorted);
      setReasoningSteps(steps);

      // Build summary
      const summaryData = buildWorkflowSummary(sorted);
      setSummary(summaryData);

      // Minimum loading time for demo effect (3.5s total)
      await new Promise((resolve) => setTimeout(resolve, 3200));

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
            <div className="divider"></div>

            {/* Workflow Header - Shows Sarvam/Demo badge */}
            <WorkflowHeader summary={summary} source={source} />

            {/* Success Timeline */}
            <SuccessTimeline steps={reasoningSteps} summary={summary} />

            {/* Enhanced Next Action Card */}
            <NextActionCard action={nextAction} />

            {/* AI Reasoning Panel */}
            <AIReasoningPanel steps={reasoningSteps} />

            {/* Extracted Info Accordion */}
            <ExtractedInfoAccordion
              extractions={extractions}
              source={source}
            />

            {/* Priority List with Blocked By */}
            <PriorityList prioritized={prioritized} />

            {/* Workflow Graph */}
            <WorkflowGraph prioritized={prioritized} />

            {/* Workflow Summary */}
            <WorkflowSummary summary={summary} />
          </div>
        </section>
      )}
    </>
  );
}
