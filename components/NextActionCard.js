"use client";

/**
 * Hero card showing the single highest-priority action the user must take next.
 * Receives the first item from the prioritized plan returned by the server.
 * Renders only real fields — no fabricated defaults.
 */
export default function NextActionCard({ action }) {
  if (!action || !action.required_action) {
    return null;
  }

  const blocks = Array.isArray(action.blocks) ? action.blocks.filter((b) => b && b.required_action) : [];
  const confidencePercent =
    typeof action.confidence === "number" ? Math.round(action.confidence * 100) : null;
  const isUrgent = (typeof action.effective_deadline_days === "number"
    ? action.effective_deadline_days
    : typeof action.deadline_days === "number"
    ? action.deadline_days
    : 999) <= 3;

  // Use server-provided priority_reason, or fall back to a safe minimal text.
  const reason = action.priority_reason || (blocks.length > 0
    ? `${blocks.map((b) => b.required_action).join(" and ")} depends on this`
    : action.deadline
    ? `Has the earliest deadline: ${action.deadline}`
    : "Top priority — no blockers detected");

  return (
    <div className="next-action-card">
      <div className="next-action-label">
        <div className="pulse-dot"></div>
        Your Next Action
        {isUrgent && <span className="urgent-badge">Urgent</span>}
      </div>
      <div className="next-action-title">{action.required_action}</div>

      {/* Source Citation */}
      <div className="source-citation">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <span>Source: {action.source_document || action.title || "Uploaded document"}</span>
      </div>

      <div className="next-action-reason">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span>{reason}</span>
      </div>

      <div className="action-meta">
        {action.estimated_time && (
          <div className="meta-item">
            <div className="meta-label">Estimated Time</div>
            <div className="meta-value">{action.estimated_time}</div>
          </div>
        )}
        {action.deadline && (
          <div className="meta-item">
            <div className="meta-label">Deadline</div>
            <div className="meta-value deadline">{action.deadline}</div>
          </div>
        )}
        {confidencePercent !== null && (
          <div className="meta-item">
            <div className="meta-label">Confidence</div>
            <div className="meta-value confidence">{confidencePercent}%</div>
          </div>
        )}
      </div>

      {Array.isArray(action.required_documents) && action.required_documents.length > 0 && (
        <div className="carry-checklist">
          <div className="meta-label">What to Carry</div>
          {action.required_documents
            .filter((item) => item && typeof item === "string")
            .map((item, idx) => (
              <div className="checklist-item" key={idx}>
                <div className="checklist-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" width="12" height="12">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
                {item}
              </div>
            ))}
        </div>
      )}

      {blocks.length > 0 && (
        <div className="carry-checklist">
          <div className="meta-label">Unblocks</div>
          {blocks.map((b, idx) => (
            <div className="checklist-item" key={idx}>
              <div className="checklist-icon">&#8594;</div>
              {b.required_action}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
