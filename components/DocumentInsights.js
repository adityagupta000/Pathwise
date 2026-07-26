"use client";

export default function DocumentInsights({ prioritized }) {
  if (!prioritized || prioritized.length === 0) return null;

  // Extract important dates
  const importantDates = prioritized
    .filter(item => item.appointment_date || item.deadline)
    .map(item => ({
      action: item.required_action,
      date: item.appointment_date || item.deadline,
      time: item.appointment_time,
      days: item.deadline_days
    }));

  // Extract required offices
  const offices = [
    ...new Set(
      prioritized
        .filter(item => item.office_location)
        .map(item => item.office_location)
    )
  ];

  // Extract all required documents
  const allDocuments = [
    ...new Set(
      prioritized
        .flatMap(item => item.required_documents || [])
    )
  ];

  // Extract fees
  const fees = prioritized
    .filter(item => item.fees && item.fees !== "null")
    .map(item => ({
      action: item.required_action,
      fee: item.fees
    }));

  // Extract warnings (urgent tasks)
  const warnings = prioritized
    .filter(item => item.deadline_days <= 3 || item.is_blocked)
    .map(item => ({
      action: item.required_action,
      reason: item.deadline_days <= 3
        ? `Urgent: Only ${item.deadline_days} day(s) remaining`
        : `Blocked by: ${item.blocked_by.map(b => b.required_action).join(", ")}`
    }));

  // Check for missing information
  const missingInfo = [];
  prioritized.forEach(item => {
    if (!item.appointment_date && !item.appointment_time && item.deadline_days <= 7) {
      missingInfo.push(`${item.required_action}: No specific appointment date/time`);
    }
    if (!item.office_location) {
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
                  {item.days <= 3 && (
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
                  <div className="insight-icon">📍</div>
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
                <div className="insight-check">✓</div>
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
                  <div className="insight-icon">⚠</div>
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
                  <div className="insight-icon">ℹ</div>
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
