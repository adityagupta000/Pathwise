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
              {/* Header with confidence */}
              <div className="extraction-header">
                <span className="extraction-doc-num">Document {idx + 1}</span>
                <span className="confidence-badge">
                  {Math.round((doc.confidence || 0) * 100)}% confidence
                </span>
              </div>

              {/* Key Information Section */}
              <div className="extraction-section">
                <div className="extraction-section-title">Key Information</div>

                <div className="extraction-row">
                  <div className="extraction-label">Document Type</div>
                  <div className="extraction-value-large">{doc.document_type}</div>
                </div>

                <div className="extraction-row">
                  <div className="extraction-label">Issued By</div>
                  <div className="extraction-value-large">{doc.organization}</div>
                </div>

                <div className="extraction-row">
                  <div className="extraction-label">Source</div>
                  <div className="extraction-value-large">
                    {doc.source_document || doc.title} • {doc.source_page || "Full document"}
                  </div>
                </div>
              </div>

              {/* Action Required Section */}
              <div className="extraction-section highlight-section">
                <div className="extraction-section-title">Action Required</div>
                <div className="extraction-action-text">{doc.required_action}</div>
              </div>

              {/* Important Details Section */}
              <div className="extraction-section">
                <div className="extraction-section-title">Important Details</div>

                <div className="extraction-row">
                  <div className="extraction-label">Deadline</div>
                  <div className="extraction-value-deadline">{doc.deadline}</div>
                </div>

                <div className="extraction-row">
                  <div className="extraction-label">Estimated Time</div>
                  <div className="extraction-value-large">{doc.estimated_time || "Not specified"}</div>
                </div>

                {doc.prerequisites && doc.prerequisites.length > 0 && (
                  <div className="extraction-row">
                    <div className="extraction-label">Prerequisites</div>
                    <div className="extraction-value-large">
                      {doc.prerequisites.join(", ")}
                    </div>
                  </div>
                )}
              </div>

              {/* Documents to Carry Section */}
              {doc.required_documents && doc.required_documents.length > 0 && (
                <div className="extraction-section">
                  <div className="extraction-section-title">Documents to Carry</div>
                  <div className="extraction-checklist">
                    {doc.required_documents.map((item, i) => (
                      <div key={i} className="extraction-checklist-item">
                        <span className="extraction-check">[x]</span>
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Consequence Section */}
              <div className="extraction-section warning-section">
                <div className="extraction-section-title">What Happens if Not Completed</div>
                <div className="extraction-consequence">{doc.consequence}</div>
              </div>

              {/* Dependency Explanation (if exists) */}
              {doc.dependency_reason && doc.dependency_reason !== "No dependencies detected" && (
                <div className="extraction-section info-section">
                  <div className="extraction-section-title">Why This Action Depends on Others</div>
                  <div className="extraction-info">{doc.dependency_reason}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
