function daysOf(item) {
  return typeof item?.effective_deadline_days === "number"
    ? item.effective_deadline_days
    : typeof item?.deadline_days === "number"
      ? item.deadline_days
      : null;
}

export function buildInsights(prioritized) {
  if (!Array.isArray(prioritized)) {
    return { importantDates: [], offices: [], allDocuments: [], fees: [], warnings: [], missingInfo: [] };
  }

  const importantDates = prioritized
    .filter((item) => item && (item.appointment_date || item.deadline_date || item.deadline_text) && item.required_action)
    .map((item) => ({
      action: item.required_action,
      date: item.appointment_date || item.deadline_date || item.deadline_text,
      time: item.appointment_time,
      days: daysOf(item),
    }));
  const offices = [...new Set(prioritized.filter((item) => typeof item?.office_location === "string" && item.office_location).map((item) => item.office_location))];
  const allDocuments = [...new Set(prioritized.flatMap((item) => Array.isArray(item?.required_documents)
    ? item.required_documents.filter((doc) => typeof doc === "string" && doc)
    : []))];
  const fees = prioritized
    .filter((item) => typeof item?.fees === "string" && item.fees.toLowerCase() !== "null" && item.required_action)
    .map((item) => ({ action: item.required_action, fee: item.fees }));
  const warnings = prioritized
    .filter((item) => item?.required_action && (daysOf(item) !== null && daysOf(item) <= 3 || item.is_blocked && item.blocked_by?.length))
    .map((item) => {
      const days = daysOf(item);
      const blockers = Array.isArray(item.blocked_by) ? item.blocked_by.filter((b) => b?.required_action) : [];
      return {
        action: item.required_action,
        reason: days !== null && days < 0
          ? `Overdue by ${Math.abs(days)} day${Math.abs(days) !== 1 ? "s" : ""}`
          : days !== null && days <= 3
            ? `Urgent: ${days} day${days !== 1 ? "s" : ""} remaining`
            : blockers.length
              ? `Blocked by: ${blockers.map((b) => b.required_action).join(", ")}`
              : "Blocked - dependencies not resolved",
      };
    });
  const missingInfo = [];
  prioritized.forEach((item) => {
    if (!item?.required_action) return;
    const hasAppointment = item.appointment_date || item.appointment_time;
    if (item.appointment_date && !item.appointment_time) {
      missingInfo.push(`${item.required_action}: Appointment time not specified`);
    }
    if (hasAppointment && (!item.office_location || item.office_location === "null")) {
      missingInfo.push(`${item.required_action}: Office location not specified`);
    }
  });
  return { importantDates, offices, allDocuments, fees, warnings, missingInfo };
}
