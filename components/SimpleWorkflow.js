"use client";

/**
 * SimpleWorkflow — Accessible, responsive action-plan table.
 * Phase 3 items: 3.3 (deadline badges, validation status), 3.4 (a11y, responsive)
 */

const STATUS_LABELS = {
  ready:   "Ready",
  blocked: "Blocked",
  overdue: "Overdue",
  urgent:  "Urgent",
  cycle:   "Cycle",
};

/** Colour-coded badge that reflects computed deadline_status from the API (item 1.4 / 3.3). */
function DeadlineBadge({ item }) {
  const { deadline_status, deadline_days, deadline_text, deadline_relative_days, deadline_relative_anchor } = item;

  if (deadline_status === "overdue" || (typeof deadline_days === "number" && deadline_days < 0)) {
    const d = Math.abs(typeof deadline_days === "number" ? deadline_days : 0);
    return (
      <span
        className="deadline-badge deadline-overdue"
        role="img"
        aria-label={`Overdue by ${d} ${d === 1 ? "day" : "days"}`}
      >
        OVERDUE{d > 0 ? ` by ${d}d` : ""}
      </span>
    );
  }
  if (deadline_status === "due_today" || deadline_days === 0) {
    return (
      <span className="deadline-badge deadline-today" role="img" aria-label="Due today">
        DUE TODAY
      </span>
    );
  }
  if (deadline_status === "upcoming" && typeof deadline_days === "number" && deadline_days > 0) {
    const urgent = deadline_days <= 3;
    return (
      <span
        className={`deadline-badge ${urgent ? "deadline-urgent" : "deadline-upcoming"}`}
        aria-label={`Due in ${deadline_days} ${deadline_days === 1 ? "day" : "days"}`}
      >
        {deadline_days}d left
      </span>
    );
  }
  if (deadline_status === "relative_unanchored" && deadline_relative_days) {
    const anchor = deadline_relative_anchor ? ` of ${deadline_relative_anchor}` : "";
    return (
      <span
        className="deadline-badge deadline-relative"
        aria-label={`Within ${deadline_relative_days} days${anchor}`}
      >
        {deadline_relative_days}d{anchor}
      </span>
    );
  }
  if (deadline_text) {
    return <span className="deadline-text-only">{deadline_text}</span>;
  }
  return (
    <span className="deadline-none" aria-label="No deadline specified">
      &mdash;
    </span>
  );
}

/** Badge shown when extraction could not fully verify information (item 3.3). */
function ValidationBadge({ verification_status }) {
  if (!verification_status || verification_status === "verified") return null;
  if (verification_status === "partially_verified") {
    return (
      <span
        className="validation-badge validation-partial"
        title="Some information could not be fully verified against the source document"
      >
        ~ partial
      </span>
    );
  }
  return (
    <span
      className="validation-badge validation-unverified"
      title="This information could not be verified against the source document"
    >
      ? unverified
    </span>
  );
}

export default function SimpleWorkflow({ prioritized }) {
  if (!Array.isArray(prioritized) || prioritized.length === 0) return null;

  const validItems = prioritized.filter((item) => item && item.required_action);
  if (validItems.length === 0) return null;

  return (
    <div className="simple-workflow">
      <div className="workflow-title" id="action-plan-heading">
        YOUR ACTION PLAN
      </div>

      {/* Responsive wrapper so the table scrolls horizontally on small screens (item 3.4) */}
      <div
        className="table-scroll-wrapper"
        role="region"
        aria-labelledby="action-plan-heading"
        tabIndex={0}
      >
        <table className="workflow-table" aria-labelledby="action-plan-heading">
          <caption className="sr-only">
            Prioritised list of {validItems.length} action{validItems.length !== 1 ? "s" : ""}{" "}
            derived from your documents
          </caption>
          <thead>
            <tr>
              <th scope="col" abbr="Priority">#</th>
              <th scope="col">Status</th>
              <th scope="col">Action Required</th>
              <th scope="col">Organization</th>
              <th scope="col">Deadline</th>
              <th scope="col">Location</th>
              <th scope="col">Documents Needed</th>
            </tr>
          </thead>
          <tbody>
            {validItems.map((item, idx) => {
              const isBlocked = Boolean(item.is_blocked);
              const isCycle   = Boolean(item.cycle_detected);
              const blockedBy = Array.isArray(item.blocked_by)
                ? item.blocked_by.filter((b) => b && b.required_action)
                : [];
              const deadlineDays = typeof item.deadline_days === "number" ? item.deadline_days : null;
              const isUrgent =
                item.status === "urgent" ||
                (deadlineDays !== null && deadlineDays >= 0 && deadlineDays <= 3);
              const isOverdue =
                item.status === "overdue" ||
                (deadlineDays !== null && deadlineDays < 0);

              const status =
                item.status ||
                (isCycle
                  ? "cycle"
                  : isBlocked
                  ? "blocked"
                  : isOverdue
                  ? "overdue"
                  : isUrgent
                  ? "urgent"
                  : "ready");

              const rowClass = [
                isBlocked && !isCycle ? "blocked-row" : "",
                isOverdue || isUrgent ? "urgent-row" : "",
                isCycle ? "cycle-row" : "",
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <tr key={item.id || idx} className={rowClass || undefined}>
                  {/* Priority */}
                  <td className="priority-cell">
                    <strong>{item.priority_rank ?? idx + 1}</strong>
                  </td>

                  {/* Status */}
                  <td className="status-cell">
                    <span
                      className={`status-badge status-${status}`}
                      aria-label={`Status: ${STATUS_LABELS[status] || status}`}
                    >
                      {(STATUS_LABELS[status] || status).toUpperCase()}
                    </span>
                  </td>

                  {/* Action — main content cell */}
                  <td className="action-cell">
                    <div className="action-text">{item.required_action}</div>
                    <ValidationBadge verification_status={item.verification_status} />

                    {isBlocked && blockedBy.length > 0 && (
                      <div
                        className="blocked-info"
                        role="note"
                        aria-label="Blocked by prerequisite tasks"
                      >
                        <strong>Blocked by:</strong>{" "}
                        {blockedBy.map((b) => b.required_action).join("; ")}
                      </div>
                    )}
                    {isCycle && (
                      <div className="cycle-info" role="alert">
                        &#9888; Circular dependency &mdash; review manually
                      </div>
                    )}
                    {item.appointment_date && (
                      <div className="appointment-info">
                        Appointment: {item.appointment_date}
                        {item.appointment_time && ` at ${item.appointment_time}`}
                      </div>
                    )}
                    {item.fees && item.fees !== "null" && (
                      <div className="fee-info">Fees: {item.fees}</div>
                    )}
                    {item.consequence && (
                      <div className="consequence-info">If missed: {item.consequence}</div>
                    )}
                  </td>

                  {/* Organization */}
                  <td className="org-cell">{item.organization || "\u2014"}</td>

                  {/* Deadline */}
                  <td className="deadline-cell">
                    <DeadlineBadge item={item} />
                    {item.deadline_text && item.deadline_status !== "relative_unanchored" && (
                      <div className="deadline-raw-text">{item.deadline_text}</div>
                    )}
                  </td>

                  {/* Location */}
                  <td className="location-cell">{item.office_location || "\u2014"}</td>

                  {/* Documents needed */}
                  <td className="documents-cell">
                    {Array.isArray(item.required_documents) && item.required_documents.length > 0 ? (
                      <ul className="doc-list">
                        {item.required_documents
                          .filter((doc) => doc && typeof doc === "string")
                          .slice(0, 3)
                          .map((doc, docIdx) => (
                            <li key={docIdx}>{doc}</li>
                          ))}
                        {item.required_documents.length > 3 && (
                          <li className="doc-more">+{item.required_documents.length - 3} more</li>
                        )}
                      </ul>
                    ) : (
                      "\u2014"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
