"use client";

import { useState, useEffect } from "react";

/**
 * LoadingAnimation — item 2.7 (minimum required fix)
 *
 * - Indeterminate spinner (no fake step timer)
 * - Live elapsed time, updated every second
 * - File count display
 * - Cancel button wired to parent's onCancel callback
 */
export default function LoadingAnimation({ visible, fileCount = 1, onCancel }) {
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (!visible) return;

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
    <section className="loading-section-modern visible" aria-live="polite" aria-label="Processing documents">
      <div className="container">
        <div className="loading-header">
          <h2 className="loading-title">PROCESSING YOUR DOCUMENTS</h2>
        </div>

        {/* Indeterminate spinner */}
        <div className="loading-spinner" aria-hidden="true" />

        {/* Status line */}
        <div className="loading-current-step">
          Analysing {fileCount} document{fileCount !== 1 ? "s" : ""} with Sarvam AI…
        </div>

        {/* Elapsed time */}
        <div className="loading-counter" aria-atomic="true">
          Time elapsed: {elapsed}
        </div>

        {/* Cancel */}
        {onCancel && (
          <div style={{ marginTop: "1rem" }}>
            <button
              type="button"
              className="lang-chip"
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
