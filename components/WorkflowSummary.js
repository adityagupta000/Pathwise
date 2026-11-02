"use client";

/**
 * WorkflowSummary — canonical key version (B18).
 * Uses: documents, actions, dependencies, blocked, estimated_minutes
 * Formats minutes as "1 h 35 min"; shows "Not specified" for null.
 */

function formatMinutes(mins) {
  if (typeof mins !== "number" || mins <= 0) return "Not specified";
  if (mins < 60) return `~${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `~${h} h ${m} min` : `~${h} h`;
}

export default function WorkflowSummary({ summary }) {
  if (!summary) return null;

  const stats = [
    { label: "Total Documents", value: summary.documents ?? 0 },
    { label: "Actions Found",   value: summary.actions ?? 0 },
    { label: "Dependencies",    value: summary.dependencies ?? 0 },
    { label: "Blocked Tasks",   value: summary.blocked ?? 0 },
    { label: "Est. Completion", value: formatMinutes(summary.estimated_minutes) },
  ];

  return (
    <div className="workflow-summary">
      <div className="section-label">Overall Workflow Summary</div>
      <div className="summary-grid">
        {stats.map((stat, idx) => (
          <div className="summary-stat" key={idx}>
            <div className="summary-value">{stat.value}</div>
            <div className="summary-label">{stat.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
