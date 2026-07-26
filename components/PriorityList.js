"use client";

export default function PriorityList({ prioritized }) {
  if (!Array.isArray(prioritized) || prioritized.length === 0) {
    return null;
  }

  const validItems = prioritized.filter(item => item && item.required_action);

  return (
    <div className="priority-section">
      <div className="section-label">YOUR ACTION PLAN</div>

      <div className="action-plan-vertical">
        {/* Left side: Row labels */}
        <div className="action-labels-column">
          <div className="label-cell label-header">YOUR ACTION PLAN</div>
          <div className="label-cell">PRIORITY</div>
          <div className="label-cell">STATUS</div>
          <div className="label-cell">ACTION REQUIRED</div>
          <div className="label-cell">ORGANIZATION</div>
          <div className="label-cell">DEADLINE</div>
          <div className="label-cell">LOCATION</div>
          <div className="label-cell">DOCUMENTS</div>
        </div>

        {/* Right side: Action columns */}
        {validItems.map((item, idx) => {
          const priority = idx + 1;
          const isBlocked = Boolean(item.is_blocked);
          const isUrgent = (typeof item.deadline_days === 'number' ? item.deadline_days : 999) <= 3;

          const requiredDocs = Array.isArray(item.required_documents) ? item.required_documents : [];
          const deadlineDays = typeof item.deadline_days === 'number' ? item.deadline_days : null;
          const daysLeftText = deadlineDays !== null
            ? `${Math.abs(deadlineDays)} days ${deadlineDays < 0 ? 'overdue' : 'left'}`
            : '';

          return (
            <div className="action-data-column" key={item.id || idx}>
              {/* Empty header cell */}
              <div className="data-cell data-header-cell"></div>

              {/* Priority */}
              <div className="data-cell">
                <div className="priority-number-large">{priority}</div>
              </div>

              {/* Status */}
              <div className="data-cell">
                <div className={`status-badge-large ${isUrgent ? 'badge-urgent' : (isBlocked ? 'badge-blocked' : 'badge-required')}`}>
                  {isUrgent ? 'URGENT' : (isBlocked ? 'BLOCKED' : 'REQUIRED')}
                </div>
              </div>

              {/* Action Required */}
              <div className="data-cell data-cell-text">
                <div className="action-text">{item.required_action}</div>
                {item.fees && <div className="fees-text">Fees: {item.fees}</div>}
              </div>

              {/* Organization */}
              <div className="data-cell data-cell-text">
                <div className="org-name">{item.organization || 'N/A'}</div>
                {item.government_department && item.government_department !== item.organization && (
                  <div className="dept-name">{item.government_department}</div>
                )}
              </div>

              {/* Deadline */}
              <div className="data-cell data-cell-text">
                <div className="deadline-date">{item.deadline || 'Not specified'}</div>
                {daysLeftText && <div className="deadline-days">{daysLeftText}</div>}
              </div>

              {/* Location */}
              <div className="data-cell data-cell-text">
                <div className="location-text">
                  {item.office_location || 'Prescribed Authority (location not specified in document)'}
                </div>
              </div>

              {/* Documents */}
              <div className="data-cell data-cell-docs">
                {requiredDocs.length > 0 ? (
                  requiredDocs.map((doc, docIdx) => (
                    <div key={docIdx} className="doc-item">- {doc}</div>
                  ))
                ) : (
                  <div className="doc-item-empty">No documents specified</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
