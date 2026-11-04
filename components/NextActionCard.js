"use client";
import { describeDeadline, formatMinutes } from "@/lib/deadlines";

/**
 * Hero card showing the highest-priority item from the server-generated plan.
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
  const conditionalRequirements = Array.isArray(action.conditional_requirements)
    ? action.conditional_requirements
    : [];
  const isConditional = conditionalRequirements.some((requirement) =>
    Array.isArray(requirement.applies_to_fields) &&
    requirement.applies_to_fields.some((field) => ["required_action", "required_documents", "deadline"].includes(field))
  ) || action.deadline_context === "conditional" || action.deadline_context === "unknown";
  const isUrgent = !isConditional && action.deadline_status !== "historical" && action.deadline_status !== "unknown" &&
    (typeof action.effective_deadline_days === "number"
    ? action.effective_deadline_days
    : typeof action.deadline_days === "number"
    ? action.deadline_days
    : 999) <= 3;
  const rawDeadline = describeDeadline(action);
  const hasDeadlineInformation = Boolean(
    action.deadline_text ||
    action.deadline_date ||
    typeof action.deadline_relative_days === "number"
  );
  const deadline = action.deadline_status === "historical"
    ? { text: `Historical: ${action.deadline_text || action.deadline_date || ""}`.trim(), tone: "normal" }
    : action.deadline_status === "conditional"
    ? { text: `Conditional: ${action.deadline_text || action.deadline_date || "check the stated condition"}`, tone: "normal" }
    : action.deadline_status === "unknown" && hasDeadlineInformation
    ? { text: `Applicability unknown: ${action.deadline_text || action.deadline_date || "review the source notice"}`, tone: "normal" }
    : rawDeadline;

  // Use server-provided priority_reason, or fall back to a safe minimal text.
  const reason = action.priority_reason || (blocks.length > 0
    ? `${blocks.map((b) => b.required_action).join(" and ")} depends on this`
    : action.deadline_text
    ? `Has the earliest deadline: ${action.deadline_text}`
    : "Top priority — no blockers detected");

  return (
    <div className="next-action-card">
      <div className="next-action-label">
        <div className="pulse-dot"></div>
        {isConditional ? "Check Condition Before Acting" : "Your Next Action"}
        {isUrgent && <span className="urgent-badge">Urgent</span>}
      </div>
      <div className="next-action-title">{action.required_action}</div>
      {conditionalRequirements.length > 0 && (
        <div className="conditional-info" role="note">
          {isConditional
            ? "Check applicability before acting; these terms may apply only under the stated condition."
            : "The source limits the stated consequence or exception to these conditions."}
          <ul>
            {conditionalRequirements.map((requirement, index) => (
              <li key={index}>
                {requirement.effect === "exception" ? "Exception: " : ""}
                {requirement.applies_to_fields?.length && `${requirement.applies_to_fields.join(", ")} — `}
                {requirement.condition}
                {requirement.applies_to && ` (applies to ${requirement.applies_to})`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Source Citation */}
      <div className="source-citation">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <span>Source: {action.file_name || action.title || "Uploaded document"}{action.source_page != null ? `, page ${action.source_page}` : ""}</span>
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
        {formatMinutes(action.estimated_time_minutes) && (
          <div className="meta-item">
            <div className="meta-label">Estimated Time</div>
            <div className="meta-value">~{formatMinutes(action.estimated_time_minutes)}</div>
          </div>
        )}
        {deadline.text && (
          <div className="meta-item">
            <div className="meta-label">Deadline</div>
            <div className={`meta-value deadline ${deadline.tone}`}>{deadline.text}</div>
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
