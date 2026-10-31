"use client";

import { useState, useEffect } from "react";

const LOADING_MESSAGES = [
  "Uploading Documents",
  "Extracting Text via OCR",
  "Analyzing with Sarvam AI",
  "Detecting Dependencies",
  "Calculating Priorities",
  "Building Workflow",
];

export default function LoadingAnimation({ visible }) {
  const [messageIndex, setMessageIndex] = useState(0);
  const [dots, setDots] = useState("");

  useEffect(() => {
    if (!visible) {
      return;
    }

    // Progress through steps
    const stepInterval = setInterval(() => {
      setMessageIndex((prev) => {
        if (prev < LOADING_MESSAGES.length - 1) return prev + 1;
        return prev;
      });
    }, 800);

    // Animated dots
    const dotsInterval = setInterval(() => {
      setDots((prev) => {
        if (prev.length >= 3) return "";
        return prev + ".";
      });
    }, 400);

    return () => {
      clearInterval(stepInterval);
      clearInterval(dotsInterval);
      setMessageIndex(0);
      setDots("");
    };
  }, [visible]);

  if (!visible) return null;

  const progress = ((messageIndex + 1) / LOADING_MESSAGES.length) * 100;

  return (
    <section className="loading-section-modern visible">
      <div className="container">
        {/* Main message */}
        <div className="loading-header">
          <h2 className="loading-title">PROCESSING YOUR DOCUMENTS</h2>
        </div>

        {/* Current step */}
        <div className="loading-current-step">
          {LOADING_MESSAGES[messageIndex]}{dots}
        </div>

        {/* Progress bar */}
        <div className="loading-progress-container">
          <div className="loading-progress-bar" style={{ width: `${progress}%` }}></div>
        </div>

        {/* Step counter */}
        <div className="loading-counter">
          Step {messageIndex + 1} of {LOADING_MESSAGES.length}
        </div>

        {/* All steps list */}
        <div className="loading-steps-grid">
          {LOADING_MESSAGES.map((msg, idx) => (
            <div
              key={idx}
              className={`loading-step-item ${idx < messageIndex ? "done" : ""} ${idx === messageIndex ? "active" : ""} ${idx > messageIndex ? "pending" : ""}`}
            >
              <div className="step-icon">
                {idx < messageIndex ? "[x]" : idx === messageIndex ? "[~]" : "[ ]"}
              </div>
              <span className="step-label">{msg}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
