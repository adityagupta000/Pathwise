"use client";

import { useEffect, useRef, useState, useMemo } from "react";
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
  const copiedTimerRef = useRef(null);

  // Abort controller for in-flight translation, and a monotonic counter to drop stale responses.
  const abortRef = useRef(null);
  const reqIdRef = useRef(0);

  // Abort any in-flight request on unmount.
  useEffect(() => () => {
    abortRef.current?.abort();
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
  }, []);

  if (!english) return null;

  async function choose(code) {
    setError("");
    setCopied(false);

    if (cache.current[code]) {
      // Cancel any in-flight request first.
      abortRef.current?.abort();
      setActive(code);
      setText(cache.current[code]);
      return;
    }

    // Abort previous in-flight request.
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    // Grab a monotonic request id — lets us discard stale responses.
    const myReqId = ++reqIdRef.current;

    // Optimistically show new language chip — revert on failure.
    const prevActive = active;
    setActive(code);
    setLoading(true);

    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: english, target: code }),
        signal: ac.signal,
      });

      // Discard if a newer request has been issued.
      if (myReqId !== reqIdRef.current) return;

      const ct = res.headers.get("content-type") || "";
      const data = ct.includes("application/json") ? await res.json() : {};

      if (!res.ok) throw new Error(data.error?.message || "Translation failed");

      cache.current[code] = data.translated;
      setText(data.translated);
    } catch (err) {
      if (err.name === "AbortError") return; // user switched language; silently ignore
      if (myReqId !== reqIdRef.current) return; // stale; ignore

      // Revert active chip and text to previous working language.
      setActive(prevActive);
      setText(cache.current[prevActive] || english);
      setError(`Could not translate. Showing ${getLanguage(prevActive)?.name ?? "English"} instead.`);
    } finally {
      if (myReqId === reqIdRef.current) setLoading(false);
    }
  }

  async function copy() {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for non-secure origins (HTTP, file://).
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.cssText = "position:fixed;top:-9999px;left:-9999px";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (!ok) throw new Error("execCommand failed");
      }
      setCopied(true);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy text — please select and copy manually.");
    }
  }

  const lang = getLanguage(active);

  return (
    <section className="translated-summary">
      <div className="section-label">Read this plan in your language</div>

      {/* C5: notice that only the summary is translated */}
      <p className="summary-translation-notice">
        Only this summary is translated — the action table above stays in English.
      </p>

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
        {error && <span className="summary-error" role="alert">{error}</span>}
      </div>
    </section>
  );
}
