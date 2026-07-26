"use client";

export default function WorkflowSummary({ summary }) {
  if (!summary) return null;

  const stats = [
    { label: "Total Documents", value: summary.totalDocs, icon: "" },
    { label: "Actions Found", value: summary.totalActions, icon: "" },
    { label: "Dependencies", value: summary.dependencies, icon: "" },
    { label: "Blocked Tasks", value: summary.blockedTasks, icon: "" },
    { label: "Est. Completion", value: summary.estimatedTime, icon: "" },
  ];

  return (
    <div className="workflow-summary">
      <div className="section-label">Overall Workflow Summary</div>
      <div className="summary-grid">
        {stats.map((stat, idx) => (
          <div className="summary-stat" key={idx}>
            <div className="summary-icon">{stat.icon}</div>
            <div className="summary-value">{stat.value}</div>
            <div className="summary-label">{stat.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
