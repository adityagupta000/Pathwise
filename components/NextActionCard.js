"use client";

export default function NextActionCard({ action }) {
  if (!action || !action.required_action) {
    return null;
  }

  const blocks = Array.isArray(action.blocks) ? action.blocks.filter(b => b && b.required_action) : [];
  const hasBlocks = blocks.length > 0;

  const expectedResult = hasBlocks
    ? `${blocks.map((b) => b.required_action).join(", ")} becomes available`
    : "Compliance requirement fulfilled";

  const reason = hasBlocks
    ? `${blocks.map((b) => b.required_action).join(" and ")} depends on this — identified from uploaded notices`
    : action.deadline
      ? `This has the earliest deadline (${action.deadline}) and no blockers`
      : "No blocking dependencies detected";

  const confidencePercent = Math.round(
    (typeof action.confidence === 'number' ? action.confidence : 0.9) * 100
  );
  const isUrgent = (typeof action.deadline_days === 'number' ? action.deadline_days : 999) <= 3;

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
        <span>Source: {action.source_document || action.title} • {action.source_page || "Full document"}</span>
      </div>

      <div className="next-action-reason">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
        </svg>
        <span>{reason}</span>
      </div>

      <div className="action-meta">
        <div className="meta-item">
          <div className="meta-label">Estimated Time</div>
          <div className="meta-value">{action.estimated_time || "20 minutes"}</div>
        </div>
        <div className="meta-item">
          <div className="meta-label">Deadline</div>
          <div className="meta-value deadline">{action.deadline}</div>
        </div>
        <div className="meta-item">
          <div className="meta-label">Confidence</div>
          <div className="meta-value confidence">{confidencePercent}%</div>
        </div>
      </div>

      {Array.isArray(action.required_documents) && action.required_documents.length > 0 && (
        <div className="carry-checklist">
          <div className="meta-label">What to Carry</div>
          {action.required_documents.filter(item => item && typeof item === 'string').map((item, idx) => (
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

      <div className="expected-result">
        <div className="meta-label">Expected Result</div>
        <div className="expected-result-text">{expectedResult}</div>
      </div>
    </div>
  );
}
