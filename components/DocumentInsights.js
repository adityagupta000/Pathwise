"use client";

export default function DocumentInsights({ prioritized }) {
  if (!Array.isArray(prioritized) || prioritized.length === 0) {
    return null;
  }

  // Extract important dates
  const importantDates = prioritized
    .filter(item => item && (item.appointment_date || item.deadline) && item.required_action)
    .map(item => ({
      action: item.required_action,
      date: item.appointment_date || item.deadline,
      time: item.appointment_time,
      days: typeof item.deadline_days === 'number' ? item.deadline_days : null
    }));

  // Extract required offices
  const offices = [
    ...new Set(
      prioritized
        .filter(item => item && item.office_location && typeof item.office_location === 'string')
        .map(item => item.office_location)
    )
  ];

  // Extract all required documents
  const allDocuments = [
    ...new Set(
      prioritized
        .filter(item => item && Array.isArray(item.required_documents))
        .flatMap(item => item.required_documents.filter(doc => doc && typeof doc === 'string'))
    )
  ];

  // Extract fees
  const fees = prioritized
    .filter(item =>
      item &&
      item.fees &&
      typeof item.fees === 'string' &&
      item.fees !== "null" &&
      item.fees.toLowerCase() !== "null" &&
      item.required_action
    )
    .map(item => ({
      action: item.required_action,
      fee: item.fees
    }));

  // Extract warnings (urgent tasks)
  const warnings = prioritized
    .filter(item => {
      if (!item || !item.required_action) return false;
      const days = typeof item.deadline_days === 'number' ? item.deadline_days : 999;
      return days <= 3 || (item.is_blocked && Array.isArray(item.blocked_by) && item.blocked_by.length > 0);
    })
    .map(item => {
      const days = typeof item.deadline_days === 'number' ? item.deadline_days : 999;
      const blockers = Array.isArray(item.blocked_by) ? item.blocked_by.filter(b => b && b.required_action) : [];

      return {
        action: item.required_action,
        reason: days <= 3
          ? `Urgent: Only ${days} day${days !== 1 ? 's' : ''} remaining`
          : blockers.length > 0
            ? `Blocked by: ${blockers.map(b => b.required_action).join(", ")}`
            : "Blocked - dependencies not resolved"
      };
    });

  // Check for missing information
  const missingInfo = [];
  prioritized.forEach(item => {
    if (!item || !item.required_action) return;

    const days = typeof item.deadline_days === 'number' ? item.deadline_days : 999;
    if (!item.appointment_date && !item.appointment_time && days <= 7) {
      missingInfo.push(`${item.required_action}: No specific appointment date/time`);
    }
    if (!item.office_location || item.office_location === 'null') {
      missingInfo.push(`${item.required_action}: Office location not specified`);
    }
  });

  return (
    <div className="document-insights">
      <div className="section-label">Document Insights</div>

      <div className="insights-grid">
        {/* Important Dates */}
        {importantDates.length > 0 && (
          <div className="insight-card">
            <div className="insight-title">Important Dates</div>
            <div className="insight-content">
              {importantDates.map((item, idx) => (
                <div key={idx} className="insight-item">
                  <div className="insight-date">
                    {item.date}
                    {item.time && ` at ${item.time}`}
                  </div>
                  <div className="insight-detail">{item.action}</div>
                  {typeof item.days === 'number' && item.days <= 3 && (
                    <div className="insight-badge urgent">
                      {item.days} day{item.days !== 1 ? "s" : ""} left
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Required Offices */}
        {offices.length > 0 && (
          <div className="insight-card">
            <div className="insight-title">Required Offices</div>
            <div className="insight-content">
              {offices.map((office, idx) => (
                <div key={idx} className="insight-item">
                  <div className="insight-icon">-</div>
                  <div className="insight-detail">{office}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Documents to Carry */}
        <div className="insight-card">
          <div className="insight-title">Documents to Carry</div>
          <div className="insight-content">
            {allDocuments.slice(0, 10).map((doc, idx) => (
              <div key={idx} className="insight-item compact">
                <div className="insight-check">-</div>
                <div className="insight-detail">{doc}</div>
              </div>
            ))}
            {allDocuments.length > 10 && (
              <div className="insight-more">+{allDocuments.length - 10} more</div>
            )}
          </div>
        </div>

        {/* Fees */}
        {fees.length > 0 && (
          <div className="insight-card">
            <div className="insight-title">Fees</div>
            <div className="insight-content">
              {fees.map((item, idx) => (
                <div key={idx} className="insight-item">
                  <div className="insight-fee">{item.fee}</div>
                  <div className="insight-detail small">{item.action}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Warnings */}
        {warnings.length > 0 && (
          <div className="insight-card warning">
            <div className="insight-title">Warnings</div>
            <div className="insight-content">
              {warnings.map((item, idx) => (
                <div key={idx} className="insight-item">
                  <div className="insight-icon">!</div>
                  <div>
                    <div className="insight-detail">{item.action}</div>
                    <div className="insight-reason">{item.reason}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Missing Information */}
        {missingInfo.length > 0 && (
          <div className="insight-card info">
            <div className="insight-title">Missing Information</div>
            <div className="insight-content">
              {missingInfo.map((item, idx) => (
                <div key={idx} className="insight-item">
                  <div className="insight-icon">i</div>
                  <div className="insight-detail small">{item}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
