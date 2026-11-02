// Turns the prioritized action plan into one short, plain-language summary.
// This English text is what gets translated into the user's chosen Indian language.
// Each task is its own paragraph so the translator keeps them together and in order.

const clean = (v) => (typeof v === "string" ? v.trim() : "");
const tidy = (v) => clean(v).replace(/[.\s]+$/, ""); // avoid ".." when a value already ends with a period
const present = (v) => {
  const s = clean(v);
  return s && s.toLowerCase() !== "null" && s.toLowerCase() !== "none";
};

export function buildSummaryText(prioritized) {
  if (!Array.isArray(prioritized) || prioritized.length === 0) return "";

  const items = prioritized.filter((d) => d && d.required_action);
  const blocked = items.filter((d) => d.is_blocked).length;
  const cycles = items.filter((d) => d.cycle_detected).length;

  let intro = items.length === 1
    ? "You have 1 task to complete."
    : `You have ${items.length} tasks to complete`;
  
  if (blocked > 0) {
    intro += `, and ${blocked} of them cannot start until another task is finished`;
  }
  
  if (cycles > 0) {
    intro += ` (WARNING: ${cycles} task${cycles > 1 ? "s have" : " has"} circular dependencies that need manual review)`;
  }
  
  if (!intro.endsWith(".")) {
    intro += ".";
  }

  const blocks = items.map((d, i) => {
    const lines = [`Task ${i + 1}: ${clean(d.required_action)}`];

    // Add document type and source
    if (present(d.document_type) && d.document_type !== "Unknown") {
      lines.push(`Type: ${tidy(d.document_type)}.`);
    }
    
    if (present(d.organization)) {
      lines.push(`From: ${tidy(d.organization)}.`);
    }

    // Deadline information
    if (d.deadline_status === 'overdue') {
      const days = typeof d.deadline_days === 'number' ? Math.abs(d.deadline_days) : 0;
      lines.push(`Deadline: OVERDUE by ${days} day${days === 1 ? '' : 's'}.`);
    } else if (d.deadline_status === 'due_today') {
      lines.push(`Deadline: Due TODAY.`);
    } else if (d.deadline_status === 'relative_unanchored') {
      const relText = tidy(d.deadline_text || "Within relative period");
      lines.push(`Deadline: ${relText}.`);
    } else if (d.deadline_status === 'upcoming') {
      const days = typeof d.deadline_days === 'number' ? d.deadline_days : 0;
      const datePart = d.deadline_date ? ` (${d.deadline_date})` : '';
      lines.push(`Deadline: Due in ${days} day${days === 1 ? '' : 's'}${datePart}.`);
    } else if (present(d.deadline_text)) {
      lines.push(`Deadline: ${tidy(d.deadline_text)}.`);
    } else {
      lines.push(`Deadline: No deadline specified.`);
    }

    // Appointment information
    if (present(d.appointment_date)) {
      lines.push(`Appointment: ${tidy(d.appointment_date)}${present(d.appointment_time) ? ` at ${tidy(d.appointment_time)}` : ""}.`);
    }

    // Location
    if (present(d.office_location)) {
      lines.push(`Location: ${tidy(d.office_location)}.`);
    }

    // Estimated time
    if (typeof d.estimated_time_minutes === 'number' && d.estimated_time_minutes > 0) {
      lines.push(`Estimated time: ~${d.estimated_time_minutes} minutes.`);
    }

    // Required documents
    if (Array.isArray(d.required_documents) && d.required_documents.length > 0) {
      const docs = d.required_documents.filter((x) => typeof x === "string" && x.trim());
      if (docs.length) {
        lines.push(`Documents needed: ${docs.map((x) => x.trim().replace(/[.\s]+$/, "")).join("; ")}.`);
      }
    }

    // Fees
    if (present(d.fees)) {
      lines.push(`Fees: ${tidy(d.fees)}.`);
    }

    // Dependencies
    if (d.is_blocked && Array.isArray(d.blocked_by) && d.blocked_by.length > 0) {
      const names = d.blocked_by.map((b) => clean(b?.required_action)).filter(Boolean);
      if (names.length) {
        lines.push(`Important: Complete this first: ${names.map((x) => x.replace(/[.\s]+$/, "")).join("; ")}.`);
      }
      
      if (d.cycle_detected) {
        lines.push(`Important: Warning: This task has a circular dependency. Review manually.`);
      }
    }

    // Consequence
    if (present(d.consequence)) {
      lines.push(`If you miss it: ${tidy(d.consequence)}.`);
    }

    // Information confidence indicator
    if (d.information_type === "uncertain" || (d.confidence && d.confidence < 0.6)) {
      lines.push(`Note: Some information about this task is uncertain or incomplete.`);
    }

    // Conflicts
    if (Array.isArray(d.conflicts) && d.conflicts.length > 0) {
      lines.push(`Important: Conflict detected: ${d.conflicts.join("; ")}.`);
    }

    return lines.join("\n");
  });

  return [intro, ...blocks].join("\n\n");
}
