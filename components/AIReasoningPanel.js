"use client";

export default function AIReasoningPanel({ steps }) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return null;
  }

  const getStepColor = (type) => {
    switch (type) {
      case "scan": return "step-blue";
      case "extract": return "step-indigo";
      case "dependency": return "step-amber";
      case "blocked": return "step-red";
      case "recommend": return "step-green";
      default: return "step-blue";
    }
  };

  return (
    <div className="reasoning-panel">
      <div className="section-label">
        <span className="ai-badge">AI</span>
        Reasoning Chain
      </div>
      <div className="reasoning-chain">
        {steps.filter(step => step && step.label).map((step, idx) => (
          <div key={idx} className={`reasoning-step ${getStepColor(step.type || 'scan')}`}>
            <div className="reasoning-connector">
              <div className="reasoning-dot">{step.icon || '•'}</div>
              {idx < steps.length - 1 && <div className="reasoning-line"></div>}
            </div>
            <div className="reasoning-content">
              <div className="reasoning-step-label">{step.label}</div>
              <div className="reasoning-step-detail">{step.detail || ''}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
