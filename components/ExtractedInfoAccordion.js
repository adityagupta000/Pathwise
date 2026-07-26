"use client";

import { useState } from "react";

export default function ExtractedInfoAccordion({ extractions, source }) {
  const [isOpen, setIsOpen] = useState(false);

  if (!extractions || extractions.length === 0) return null;

  return (
    <div className="accordion-section">
      <button
        className={`accordion-trigger ${isOpen ? "open" : ""}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="accordion-trigger-left">
          <span className="ai-badge">AI</span>
          <span>Extracted Information</span>
          <span className="source-badge">
            {source === "sarvam" ? "via Sarvam AI" : "Fallback"}
          </span>
        </div>
        <svg
          className={`accordion-chevron ${isOpen ? "open" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          width="18"
          height="18"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && (
        <div className="accordion-content">
          {extractions.map((doc, idx) => (
            <div key={idx} className="extraction-card">
              <div className="extraction-header">
                <span className="extraction-doc-num">Document {idx + 1}</span>
                <span className="confidence-badge">
                  {Math.round((doc.confidence || 0) * 100)}% confidence
                </span>
              </div>

              {/* Source Citation */}
              <div className="extraction-field full-width" style={{ marginBottom: "12px" }}>
                <div className="extraction-label">Source</div>
                <div className="extraction-value">
                  {doc.source_document || doc.title} • {doc.source_page || "Full document"}
                </div>
              </div>

              <div className="extraction-grid">
                <div className="extraction-field">
                  <div className="extraction-label">Organization</div>
                  <div className="extraction-value">{doc.organization}</div>
                </div>
                <div className="extraction-field">
                  <div className="extraction-label">Document Type</div>
                  <div className="extraction-value">{doc.document_type}</div>
                </div>
                <div className="extraction-field">
                  <div className="extraction-label">Required Action</div>
                  <div className="extraction-value highlight">{doc.required_action}</div>
                </div>
                <div className="extraction-field">
                  <div className="extraction-label">Deadline</div>
                  <div className="extraction-value">{doc.deadline}</div>
                </div>
                <div className="extraction-field full-width">
                  <div className="extraction-label">Prerequisites</div>
                  <div className="extraction-value">
                    {doc.prerequisites && doc.prerequisites.length > 0
                      ? doc.prerequisites.join(", ")
                      : "None"}
                  </div>
                </div>
                {doc.dependency_reason && doc.dependency_reason !== "No dependencies detected" && (
                  <div className="extraction-field full-width">
                    <div className="extraction-label">Dependency Explanation</div>
                    <div className="extraction-value">{doc.dependency_reason}</div>
                  </div>
                )}
                <div className="extraction-field full-width">
                  <div className="extraction-label">Consequence</div>
                  <div className="extraction-value">{doc.consequence}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
