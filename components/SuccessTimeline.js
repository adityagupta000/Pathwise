"use client";

export default function SuccessTimeline({ steps, summary }) {
  const timelineSteps = [
    { label: "Documents Uploaded", icon: "1", completed: true },
    { label: "AI Extraction Complete", icon: "2", completed: true },
    { label: "Dependencies Found", icon: "3", completed: summary?.dependencies > 0 },
    { label: "Workflow Generated", icon: "4", completed: true },
  ];

  // Calculate workflow complexity
  let complexity = "Simple";
  let complexityClass = "complexity-simple";
  if (summary) {
    const totalActions = summary.totalActions || 0;
    const dependencies = summary.dependencies || 0;
    if (totalActions >= 5 || dependencies >= 3) {
      complexity = "Complex";
      complexityClass = "complexity-complex";
    } else if (totalActions >= 3 || dependencies >= 1) {
      complexity = "Moderate";
      complexityClass = "complexity-moderate";
    }
  }

  // Calculate estimated completion time
  const estimatedDays = summary?.blockedTasks > 0 ? "2-3 Days" : "1-2 Days";

  return (
    <div className="success-timeline">
      <div className="timeline-header">
        <div className="section-label">Processing Timeline</div>
        <div className="timeline-meta">
          <div className={`complexity-badge ${complexityClass}`}>
            {complexity}
          </div>
          <div className="estimated-completion">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            Estimated completion: {estimatedDays}
          </div>
        </div>
      </div>

      <div className="timeline-steps">
        {timelineSteps.map((step, idx) => (
          <div key={idx} className={`timeline-step ${step.completed ? "completed" : "pending"}`}>
            <div className="timeline-icon">{step.icon}</div>
            <div className="timeline-label">{step.label}</div>
            {step.completed && (
              <svg className="timeline-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            )}
          </div>
        ))}
      </div>

      {summary?.dependencies === 0 && (
        <div className="no-dependencies-message">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          <span>No blocking dependencies detected. All actions can be completed independently.</span>
        </div>
      )}
    </div>
  );
}
