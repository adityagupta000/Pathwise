"use client";

import React from "react";

/**
 * SimpleWorkflow — Accessible, responsive action-plan table.
 * Displays deadline badges, validation status, and accessible responsive tables.
 */

const STATUS_LABELS = {
  ready:   "Ready",
  blocked: "Blocked",
  overdue: "Overdue",
  urgent:  "Urgent",
  cycle:   "Cycle",
  conditional: "Conditional",
};

/** Colour-coded badge that reflects computed deadline_status from the API. */
function DeadlineBadge({ item }) {
  const { deadline_status, deadline_days, deadline_text, deadline_relative_days, deadline_relative_anchor } = item;

  if (deadline_status === "historical") {
    return <span className="deadline-text-only">Historical: {deadline_text || item.deadline_date}</span>;
  }
  if (deadline_status === "conditional") {
    return <span className="deadline-text-only">Conditional: {deadline_text || item.deadline_date || "deadline applies only if the stated condition is met"}</span>;
  }
  if (
    deadline_status === "unknown" &&
    (deadline_text || item.deadline_date || typeof deadline_relative_days === "number")
  ) {
    return <span className="deadline-text-only">Applicability unknown: {deadline_text || item.deadline_date || "review the source notice"}</span>;
  }

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
  if (deadline_status === "relative_unanchored" && deadline_relative_days != null) {
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

/** Badge shown when extraction could not fully verify information. */
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
  // Track which rows have their document list expanded.
  // Must be called before any early return (rules of hooks).
  const [expandedRows, setExpandedRows] = React.useState(new Set());

  if (!Array.isArray(prioritized) || prioritized.length === 0) return null;

  const validItems = prioritized.filter((item) => item && item.required_action);
  if (validItems.length === 0) return null;

  function toggleRow(id) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="simple-workflow">
      <div className="workflow-title" id="action-plan-heading">
        YOUR ACTION PLAN
      </div>

      {/* Responsive wrapper keeps the table usable on narrow screens. */}
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
                    {Array.isArray(item.conditional_requirements) && item.conditional_requirements.length > 0 && (
                      <div className="conditional-info" role="note">
                        Source-stated conditions and exceptions:
                        <ul>
                          {item.conditional_requirements.map((requirement, requirementIndex) => (
                            <li key={requirementIndex}>
                              {requirement.effect === "exception" ? "Exception" : "Condition"}
                              {requirement.applies_to_fields?.length ? ` for ${requirement.applies_to_fields.join(", ")}` : ""}
                              {": "}
                              {requirement.condition}
                              {requirement.applies_to && ` (applies to ${requirement.applies_to})`}
                              {requirement.deadline_text && `; deadline: ${requirement.deadline_text}`}
                              {requirement.consequence && `; consequence: ${requirement.consequence}`}
                              {requirement.verification_status !== "verified" && " (source evidence not fully verified)"}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

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
                      <div className="cycle-info" role="note">
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

                    {/* C1: Per-row details panel */}
                    <details className="row-details">
                      <summary className="row-details-toggle">Details &amp; evidence</summary>
                      <div className="row-details-body">
                        {item.file_name && (
                          <div><strong>Source:</strong> {item.file_name}{item.source_page != null ? `, page ${item.source_page}` : ""}</div>
                        )}
                        {item.evidence_snippet && (
                          <div><strong>Evidence:</strong> <q>{item.evidence_snippet}</q></div>
                        )}
                        {Array.isArray(item.field_evidence_status) && item.field_evidence_status.length > 0 && (
                          <ul className="details-list">
                            {item.field_evidence_status.map((citation, citationIndex) => (
                              <li key={citationIndex}>
                                <strong>{citation.field.replace(/_/g, " ")}:</strong>{" "}
                                <q>{citation.quote}</q>
                                {citation.source_page != null && ` (page ${citation.source_page})`}
                                {citation.verification_status !== "verified" && " — not fully verified"}
                              </li>
                            ))}
                          </ul>
                        )}
                        {item.confidence != null && (
                          <div><strong>Confidence:</strong> {Math.round(item.confidence * 100)}%</div>
                        )}
                        {item.verification_status && item.verification_status !== "verified" && (
                          <div><strong>Verification:</strong> {item.verification_status.replace(/_/g, " ")}</div>
                        )}
                        {Array.isArray(item.blocked_by) && item.blocked_by.length > 0 && (
                          <div>
                            <strong>Blocked by:</strong>
                            <ul className="details-list">
                              {item.blocked_by.map((b, bi) => (
                                <li key={bi}>
                                  {b.required_action}
                                  {b._dependency_reason && ` — ${b._dependency_reason}`}
                                  {b._dependency_method && ` (${b._dependency_method})`}
                                  {b._evidence_quote && <><br /><em>Evidence: <q>{b._evidence_quote}</q></em></>}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {Array.isArray(item.fuzzy_suggestions) && item.fuzzy_suggestions.length > 0 && (
                          <div>
                            <strong>Suggested links (unverified):</strong>
                            <ul className="details-list">
                              {item.fuzzy_suggestions.map((s, si) => (
                                <li key={si}>{s.required_action ?? s}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {Array.isArray(item.conflicts) && item.conflicts.length > 0 && (
                          <div>
                            <strong>Conflicts:</strong>
                            <ul className="details-list">
                              {item.conflicts.map((c, ci) => <li key={ci}>{c}</li>)}
                            </ul>
                          </div>
                        )}
                        {item.cycle_path && (
                          <div><strong>Cycle path:</strong> {item.cycle_path}</div>
                        )}
                      </div>
                    </details>
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

                  {/* Documents needed with an expandable remainder. */}
                  <td className="documents-cell">
                    {Array.isArray(item.required_documents) && item.required_documents.length > 0 ? (() => {
                      const docs = item.required_documents.filter((doc) => doc && typeof doc === "string");
                      const rowKey = item.id || idx;
                      const isExpanded = expandedRows.has(rowKey);
                      const visible = isExpanded ? docs : docs.slice(0, 3);
                      const hiddenCount = docs.length - 3;
                      return (
                        <ul className="doc-list">
                          {visible.map((doc, docIdx) => (
                            <li key={docIdx}>{doc}</li>
                          ))}
                          {hiddenCount > 0 && (
                            <li>
                              <button
                                type="button"
                                className="doc-expand-btn"
                                aria-expanded={isExpanded}
                                onClick={() => toggleRow(rowKey)}
                              >
                                {isExpanded ? "Show less" : `+${hiddenCount} more`}
                              </button>
                            </li>
                          )}
                        </ul>
                      );
                    })() : (
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
