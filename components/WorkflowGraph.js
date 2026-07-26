"use client";

export default function WorkflowGraph({ prioritized }) {
  if (!Array.isArray(prioritized) || prioritized.length === 0) {
    return null;
  }

  const validItems = prioritized.filter(item => item && item.required_action);

  if (validItems.length === 0) {
    return null;
  }

  return (
    <div className="workflow-graph-section">
      <div className="section-label">Workflow Graph</div>
      <div className="workflow-graph">
        {validItems.map((item, idx) => {
          const isBlocked = Boolean(item.is_blocked);
          const organization = item.organization || "Unknown";
          const deadline = item.deadline || "No deadline";

          return (
            <div key={item.id || idx} className="graph-row">
              <div
                className={`graph-node ${isBlocked ? "graph-node-blocked" : "graph-node-active"}`}
              >
                <div className="graph-node-number">{idx + 1}</div>
                <div className="graph-node-content">
                  <div className="graph-node-title">{item.required_action}</div>
                  <div className="graph-node-meta">
                    {organization} · {deadline}
                  </div>
                </div>
                <div
                  className={`graph-node-status ${isBlocked ? "graph-status-blocked" : "graph-status-ready"}`}
                >
                  {isBlocked ? "Blocked" : "Ready"}
                </div>
              </div>
              {idx < validItems.length - 1 && (
                <div className="graph-arrow">
                  <svg width="24" height="32" viewBox="0 0 24 32">
                    <line x1="12" y1="0" x2="12" y2="24" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />
                    <polygon points="6,22 12,30 18,22" fill="currentColor" />
                  </svg>
                  <span className="graph-arrow-label">then</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
