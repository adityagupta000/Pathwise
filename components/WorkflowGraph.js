"use client";

export default function WorkflowGraph({ prioritized }) {
  if (!prioritized || prioritized.length === 0) return null;

  return (
    <div className="workflow-graph-section">
      <div className="section-label">Workflow Graph</div>
      <div className="workflow-graph">
        {prioritized.map((item, idx) => (
          <div key={item.id || idx} className="graph-row">
            <div
              className={`graph-node ${item.is_blocked ? "graph-node-blocked" : "graph-node-active"}`}
            >
              <div className="graph-node-number">{idx + 1}</div>
              <div className="graph-node-content">
                <div className="graph-node-title">{item.required_action}</div>
                <div className="graph-node-meta">
                  {item.organization} · {item.deadline}
                </div>
              </div>
              <div
                className={`graph-node-status ${item.is_blocked ? "graph-status-blocked" : "graph-status-ready"}`}
              >
                {item.is_blocked ? "Blocked" : "Ready"}
              </div>
            </div>
            {idx < prioritized.length - 1 && (
              <div className="graph-arrow">
                <svg width="24" height="32" viewBox="0 0 24 32">
                  <line x1="12" y1="0" x2="12" y2="24" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />
                  <polygon points="6,22 12,30 18,22" fill="currentColor" />
                </svg>
                <span className="graph-arrow-label">then</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
