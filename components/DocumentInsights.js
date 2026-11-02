"use client";
import { buildInsights } from "@/lib/insights";

export default function DocumentInsights({ prioritized }) {
  if (!Array.isArray(prioritized) || prioritized.length === 0) {
    return null;
  }

  const { importantDates, offices, allDocuments, fees, warnings, missingInfo } = buildInsights(prioritized);

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
                      {item.days < 0
                        ? `Overdue by ${Math.abs(item.days)} day${Math.abs(item.days) !== 1 ? "s" : ""}`
                        : `${item.days} day${item.days !== 1 ? "s" : ""} left`}
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
                  <div className="insight-icon" aria-hidden="true">›</div>
                  <div className="insight-detail">{office}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Documents to Carry — only render if there are documents */}
        {allDocuments.length > 0 && (
          <div className="insight-card">
            <div className="insight-title">Documents to Carry</div>
            <div className="insight-content">
              {allDocuments.slice(0, 10).map((doc, idx) => (
                <div key={idx} className="insight-item compact">
                  <div className="insight-check" aria-hidden="true">✓</div>
                  <div className="insight-detail">{doc}</div>
                </div>
              ))}
              {allDocuments.length > 10 && (
                <div className="insight-more">+{allDocuments.length - 10} more</div>
              )}
            </div>
          </div>
        )}

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
                  <div className="insight-icon" aria-label="Warning">⚠</div>
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
                  <div className="insight-icon" aria-label="Info">ℹ</div>
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
