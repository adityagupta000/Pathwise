"use client";

function getComputedDeadline(item) {
  if (
    item.deadline_status === "overdue" ||
    (typeof item.deadline_days === "number" && item.deadline_days < 0)
  ) {
    const d = Math.abs(item.deadline_days);
    return `OVERDUE by ${d} ${d === 1 ? "day" : "days"}`;
  }
  if (item.deadline_status === "due_today" || item.deadline_days === 0) {
    return "Due TODAY";
  }
  if (
    item.deadline_status === "upcoming" ||
    (typeof item.deadline_days === "number" && item.deadline_days > 0)
  ) {
    return `Due in ${item.deadline_days} ${item.deadline_days === 1 ? "day" : "days"}`;
  }
  if (
    item.deadline_status === "relative_unanchored" ||
    item.deadline_relative_days
  ) {
    const anchor = item.deadline_relative_anchor
      ? ` of ${item.deadline_relative_anchor}`
      : "";
    return `Within ${item.deadline_relative_days} days${anchor}`;
  }
  return null;
}

export default function SimpleWorkflow({ prioritized }) {
  if (!Array.isArray(prioritized) || prioritized.length === 0) {
    return null;
  }

  const validItems = prioritized.filter((item) => item && item.required_action);

  return (
    <div className="simple-workflow">
      <div className="workflow-title">YOUR ACTION PLAN</div>

      <table className="workflow-table">
        <thead>
          <tr>
            <th>Priority</th>
            <th>Status</th>
            <th>Action Required</th>
            <th>Organization</th>
            <th>Deadline</th>
            <th>Location</th>
            <th>Documents</th>
          </tr>
        </thead>
        <tbody>
          {validItems.map((item, idx) => {
            const isBlocked = Boolean(item.is_blocked);
            const blockedBy = Array.isArray(item.blocked_by)
              ? item.blocked_by.filter((b) => b && b.required_action)
              : [];
            const deadlineDays =
              typeof item.deadline_days === "number" ? item.deadline_days : null;
            const isUrgent =
              item.status === "urgent" ||
              (deadlineDays !== null && deadlineDays >= 0 && deadlineDays <= 3);

            const status =
              item.status ||
              (isBlocked
                ? "blocked"
                : deadlineDays !== null && deadlineDays < 0
                ? "overdue"
                : isUrgent
                ? "urgent"
                : "ready");

            const computedDeadline = getComputedDeadline(item);

            return (
              <tr
                key={item.id || idx}
                className={`${isBlocked ? "blocked-row" : ""} ${
                  isUrgent || status === "overdue" ? "urgent-row" : ""
                }`}
              >
                <td className="priority-cell">
                  <strong>{item.priority_rank ?? idx + 1}</strong>
                </td>

                <td className="status-cell">
                  <span className={`status-${status}`}>
                    {status.toUpperCase()}
                  </span>
                </td>

                <td className="action-cell">
                  <div className="action-text">{item.required_action}</div>
                  {isBlocked && blockedBy.length > 0 && (
                    <div className="blocked-info">
                      Blocked by: {blockedBy.map((b) => b.required_action).join(", ")}
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
                </td>

                <td className="org-cell">{item.organization || "-"}</td>

                <td className="deadline-cell">
                  {item.deadline_text || item.deadline || "-"}
                  {computedDeadline && (
                    <div className="days-remaining">{computedDeadline}</div>
                  )}
                </td>

                <td className="location-cell">
                  {item.office_location || "-"}
                </td>

                <td className="documents-cell">
                  {Array.isArray(item.required_documents) &&
                  item.required_documents.length > 0 ? (
                    <ul className="doc-list">
                      {item.required_documents
                        .filter((doc) => doc && typeof doc === "string")
                        .slice(0, 3)
                        .map((doc, docIdx) => (
                          <li key={docIdx}>{doc}</li>
                        ))}
                      {item.required_documents.length > 3 && (
                        <li>+{item.required_documents.length - 3} more</li>
                      )}
                    </ul>
                  ) : (
                    "-"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
