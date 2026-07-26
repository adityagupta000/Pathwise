"use client";

export default function SimpleWorkflow({ prioritized }) {
  if (!Array.isArray(prioritized) || prioritized.length === 0) {
    return null;
  }

  const validItems = prioritized.filter(item => item && item.required_action);

  return (
    <div className="simple-workflow">
      <div className="workflow-title">YOUR ACTION PLAN</div>

      <table className="workflow-table">
        <thead>
          <tr>
            <th>Priority</th>
            <th>Status</th>
            <th>Action Required</th>
            <th>Organization</th>
            <th>Deadline</th>
            <th>Location</th>
            <th>Documents</th>
          </tr>
        </thead>
        <tbody>
          {validItems.map((item, idx) => {
            const isBlocked = Boolean(item.is_blocked);
            const blockedBy = Array.isArray(item.blocked_by) ? item.blocked_by.filter(b => b && b.required_action) : [];
            const deadlineDays = typeof item.deadline_days === 'number' ? item.deadline_days : null;
            const isUrgent = deadlineDays !== null && deadlineDays <= 3;

            return (
              <tr key={item.id || idx} className={`${isBlocked ? 'blocked-row' : ''} ${isUrgent ? 'urgent-row' : ''}`}>
                <td className="priority-cell">
                  <strong>{idx + 1}</strong>
                </td>

                <td className="status-cell">
                  {isBlocked && <span className="status-blocked">BLOCKED</span>}
                  {!isBlocked && isUrgent && <span className="status-urgent">URGENT</span>}
                  {!isBlocked && !isUrgent && <span className="status-ready">READY</span>}
                </td>

                <td className="action-cell">
                  <div className="action-text">{item.required_action}</div>
                  {isBlocked && blockedBy.length > 0 && (
                    <div className="blocked-info">
                      Blocked by: {blockedBy.map(b => b.required_action).join(', ')}
                    </div>
                  )}
                  {item.appointment_date && (
                    <div className="appointment-info">
                      Appointment: {item.appointment_date}
                      {item.appointment_time && ` at ${item.appointment_time}`}
                    </div>
                  )}
                  {item.fees && item.fees !== 'null' && (
                    <div className="fee-info">Fees: {item.fees}</div>
                  )}
                </td>

                <td className="org-cell">{item.organization || '-'}</td>

                <td className="deadline-cell">
                  {item.deadline || '-'}
                  {deadlineDays !== null && (
                    <div className="days-remaining">{deadlineDays} days left</div>
                  )}
                </td>

                <td className="location-cell">
                  {item.office_location || '-'}
                </td>

                <td className="documents-cell">
                  {Array.isArray(item.required_documents) && item.required_documents.length > 0 ? (
                    <ul className="doc-list">
                      {item.required_documents.filter(doc => doc && typeof doc === 'string').slice(0, 3).map((doc, docIdx) => (
                        <li key={docIdx}>{doc}</li>
                      ))}
                      {item.required_documents.length > 3 && (
                        <li>+{item.required_documents.length - 3} more</li>
                      )}
                    </ul>
                  ) : '-'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
