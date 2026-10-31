"use client";

import { useRef, useState, useMemo } from "react";
import { LANGUAGES, getLanguage } from "@/lib/languages";
import { buildSummaryText } from "@/lib/summary";

/**
 * Shows the action-plan summary and lets the user read it in any of the 22 scheduled
 * Indian languages (via Sarvam Translate). Languages are translated on click and cached,
 * so only the languages someone actually opens use API calls.
 *
 * Render it with a `key` that changes per analysis so the cache resets for a new plan.
 */
export default function TranslatedSummary({ prioritized }) {
  const english = useMemo(() => buildSummaryText(prioritized), [prioritized]);
  const cache = useRef({ "en-IN": english });

  const [active, setActive] = useState("en-IN");
  const [text, setText] = useState(english);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  if (!english) return null;

  async function choose(code) {
    setError("");
    setCopied(false);
    setActive(code);

    if (cache.current[code]) {
      setText(cache.current[code]);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: english, target: code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || data.details || data.error || "Translation failed");
      cache.current[code] = data.translated;
      setText(data.translated);
    } catch (err) {
      setError(`${err.message}. Showing the English summary instead.`);
      setText(english);
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable; ignore */
    }
  }

  const lang = getLanguage(active);

  return (
    <section className="translated-summary">
      <div className="section-label">Read this plan in your language</div>

      <div className="lang-chips" role="group" aria-label="Choose a language">
        {LANGUAGES.map((l) => (
          <button
            key={l.code}
            type="button"
            className={`lang-chip ${l.code === active ? "active" : ""}`}
            onClick={() => choose(l.code)}
            disabled={loading}
            aria-pressed={l.code === active}
            lang={l.code}
          >
            {l.native}
          </button>
        ))}
      </div>

      <div
        className={`summary-text ${loading ? "is-loading" : ""}`}
        lang={lang?.code}
        dir={lang?.rtl ? "rtl" : "ltr"}
        aria-live="polite"
      >
        {loading ? `Translating to ${lang?.name}…` : text}
      </div>

      <div className="summary-actions">
        <button type="button" className="lang-chip" onClick={copy} disabled={loading}>
          {copied ? "Copied" : "Copy text"}
        </button>
        {error && <span className="summary-error">{error}</span>}
      </div>
    </section>
  );
}
