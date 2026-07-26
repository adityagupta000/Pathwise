"use client";

export default function PriorityList({ prioritized }) {
  if (!prioritized || prioritized.length === 0) return null;

  return (
    <div className="priority-section">
      <div className="section-label">Action Priority</div>
      {prioritized.map((item, idx) => {
        const priority = idx + 1;
        const isBlocked = item.is_blocked;
        const badgeClass = isBlocked ? "badge-blocked" : "badge-required";
        const badgeText = isBlocked ? "Blocked" : "Required";
        const isUrgent = (item.deadline_days || 999) <= 3;
        const confidencePercent = Math.round((item.confidence || 0.9) * 100);

        // Build WHY reason - use dependency_reason if available
        let reason = "";
        if (isBlocked) {
          reason = item.dependency_reason || `Waiting on ${item.blocked_by.map((b) => b.required_action).join(", ")} — because ${item.blocked_by[0]?.required_action} is a prerequisite identified from the uploaded notice`;
        } else if (item.blocks && item.blocks.length > 0) {
          reason = `Blocks ${item.blocks.map((b) => b.required_action).join(", ")} — completing this first unlocks the next step`;
        } else {
          reason = item.dependency_reason === "No dependencies detected"
            ? `Independent action with deadline of ${item.deadline}`
            : item.dependency_reason || `Independent action with deadline of ${item.deadline}`;
        }

        return (
          <div className="priority-item" key={item.id || idx}>
            <div className={`priority-number ${isBlocked ? "p2" : "p1"}`}>
              {priority}
            </div>
            <div className="priority-info">
              <div className="priority-action">
                {item.required_action}
                {isUrgent && <span className="urgent-badge-inline">Urgent</span>}
              </div>
              <div className="priority-reason">{reason}</div>

              {/* Source Citation */}
              <div className="priority-source">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="12" height="12">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                Source: {item.source_document || item.title} • {item.source_page || "Full document"}
                <span className="confidence-indicator">• {confidencePercent}% confidence</span>
              </div>

              {isBlocked && item.blocked_by.length > 0 && (
                <div className="blocked-by-list">
                  <span className="blocked-by-label">Blocked by:</span>
                  {item.blocked_by.map((blocker, bIdx) => (
                    <span key={bIdx} className="blocked-by-item">
                      ✓ {blocker.required_action}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className={`status-badge ${badgeClass}`}>{badgeText}</div>
          </div>
        );
      })}
    </div>
  );
}
