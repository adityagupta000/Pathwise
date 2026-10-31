"use client";

/**
 * Notice — inline error/warning/info/success banner.
 * Replaces alert() calls (Phase 3, item 3.2).
 *
 * Props:
 *   type: "error" | "warning" | "info" | "success"
 *   title: string (optional)
 *   message: string | ReactNode (optional)
 *   onDismiss: () => void (optional — omit to make non-dismissible)
 *   failures: Array<{ file_name|fileName, message|error }> (optional)
 */
export default function Notice({ type = "error", title, message, onDismiss, failures }) {
  const icons = { error: "✖", warning: "⚠", info: "ℹ", success: "✔" };
  const icon = icons[type] ?? icons.error;

  return (
    <div
      className={`notice notice-${type}`}
      role={type === "error" ? "alert" : "status"}
      aria-live={type === "error" ? "assertive" : "polite"}
    >
      <div className="notice-header">
        <span className="notice-icon" aria-hidden="true">{icon}</span>
        {title && <strong className="notice-title">{title}</strong>}
        {onDismiss && (
          <button
            type="button"
            className="notice-dismiss"
            onClick={onDismiss}
            aria-label="Dismiss this message"
          >
            ✕
          </button>
        )}
      </div>
      {message && <div className="notice-body">{message}</div>}
      {failures && failures.length > 0 && (
        <ul className="notice-failures">
          {failures.map((f, i) => (
            <li key={i}>
              <strong>{f.file_name || f.fileName || "Unknown file"}</strong>
              {": "}
              {f.message || f.error || "Processing failed"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
