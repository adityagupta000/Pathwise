"use client";

import { useState, useEffect } from "react";

const LOADING_MESSAGES = [
  "Uploading",
  "Digitizing Documents",
  "Extracting Information",
  "Finding Dependencies",
  "Prioritizing Tasks",
  "Generating Workflow",
];

export default function LoadingAnimation({ visible }) {
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    if (!visible) {
      setMessageIndex(0);
      return;
    }
    const interval = setInterval(() => {
      setMessageIndex((prev) => {
        if (prev < LOADING_MESSAGES.length - 1) return prev + 1;
        return prev;
      });
    }, 600);
    return () => clearInterval(interval);
  }, [visible]);

  if (!visible) return null;

  return (
    <section className="loading-section visible">
      <div className="container">
        <div className="loading-spinner"></div>
        <div className="loading-text">{LOADING_MESSAGES[messageIndex]}</div>
        <div className="loading-steps">
          {LOADING_MESSAGES.map((msg, idx) => (
            <div
              key={idx}
              className={`loading-step ${idx < messageIndex ? "done" : ""} ${idx === messageIndex ? "active" : ""}`}
            >
              <div className="loading-step-dot">
                {idx < messageIndex ? "✓" : idx === messageIndex ? "●" : "○"}
              </div>
              <span>{msg}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
