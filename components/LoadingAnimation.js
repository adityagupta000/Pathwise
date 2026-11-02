"use client";

import { useState, useEffect, useRef } from "react";

/**
 * LoadingAnimation — B17 a11y fixes:
 * - section has aria-label but NOT aria-live (only the status sentence has role="status")
 * - Elapsed counter has aria-hidden="true" (not announced every second)
 * - Cancel button uses proper class (btn-cancel, not lang-chip)
 * - Focus moves to the loading heading on mount
 */
export default function LoadingAnimation({ visible, fileCount = 1, onCancel }) {
  const [elapsedSec, setElapsedSec] = useState(0);
  const headingRef = useRef(null);

  useEffect(() => {
    if (!visible) return;

    // Move focus to the loading heading so screen readers announce it.
    headingRef.current?.focus();

    const timer = setInterval(() => {
      setElapsedSec((s) => s + 1);
    }, 1000);

    return () => {
      clearInterval(timer);
      setElapsedSec(0);
    };
  }, [visible]);

  if (!visible) return null;

  const minutes = Math.floor(elapsedSec / 60);
  const seconds = elapsedSec % 60;
  const elapsed = minutes > 0
    ? `${minutes}m ${seconds}s`
    : `${seconds}s`;

  return (
    <section className="loading-section-modern visible" aria-label="Processing documents">
      <div className="container">
        <div className="loading-header">
          {/* tabIndex={-1} so JS can focus it; not in tab order */}
          <h2 className="loading-title" tabIndex={-1} ref={headingRef}>
            PROCESSING YOUR DOCUMENTS
          </h2>
        </div>

        {/* Indeterminate spinner */}
        <div className="loading-spinner" aria-hidden="true" />

        {/* Status line — role="status" announces once when mounted */}
        <div className="loading-current-step" role="status">
          Analysing {fileCount} document{fileCount !== 1 ? "s" : ""} with Sarvam AI…
        </div>

        {/* Elapsed time — aria-hidden so screen readers don't re-announce every second */}
        <div className="loading-counter" aria-hidden="true">
          Time elapsed: {elapsed}
        </div>

        {/* Cancel */}
        {onCancel && (
          <div style={{ marginTop: "1rem" }}>
            <button
              type="button"
              className="btn-cancel"
              onClick={onCancel}
              aria-label="Cancel analysis"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
