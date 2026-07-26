"use client";

export default function WorkflowHeader({ summary, source }) {
  return (
    <div className="workflow-header">
      <div className="workflow-header-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <span>Workflow Analysis Complete</span>
      </div>

      <div className="workflow-header-badge">
        <div className="powered-badge sarvam">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
          </svg>
          Powered by Sarvam AI
        </div>
      </div>

      {summary && (
        <div className="workflow-header-stats">
          <div className="header-stat">
            <div className="header-stat-label">Documents Processed</div>
            <div className="header-stat-value">{summary.totalDocs}</div>
          </div>
          <div className="header-stat">
            <div className="header-stat-label">Actions Found</div>
            <div className="header-stat-value">{summary.totalActions}</div>
          </div>
          <div className="header-stat">
            <div className="header-stat-label">Dependencies</div>
            <div className="header-stat-value">{summary.dependencies}</div>
          </div>
          <div className="header-stat">
            <div className="header-stat-label">Blocked Tasks</div>
            <div className="header-stat-value">{summary.blockedTasks}</div>
          </div>
          <div className="header-stat">
            <div className="header-stat-label">Est. Completion</div>
            <div className="header-stat-value">{summary.estimatedTime}</div>
          </div>
        </div>
      )}
    </div>
  );
}
