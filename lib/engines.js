// ── PathWise Dependency & Priority Engines ──
// Pure logic — no API calls, no React, no side effects.

/**
 * Cross-reference prerequisites against required_actions to find blockers.
 * @param {Array} docs - Array of extracted document objects
 * @returns {Array} docs with is_blocked, blocked_by, blocks fields added
 */
export function resolveDependencies(docs) {
  // Build a lookup: lowercase action → doc
  const actionMap = {};
  docs.forEach((doc) => {
    actionMap[doc.required_action.toLowerCase().trim()] = doc;
  });

  return docs.map((doc) => {
    // Find which other docs this one depends on
    const blockedBy = (doc.prerequisites || [])
      .map((prereq) => {
        const key = prereq.toLowerCase().trim();
        // Try exact match first, then fuzzy substring match
        if (actionMap[key] && actionMap[key].id !== doc.id) {
          return actionMap[key];
        }
        // Fuzzy: check if any action contains the prereq or vice versa
        const match = docs.find(
          (other) =>
            other.id !== doc.id &&
            (other.required_action.toLowerCase().includes(key) ||
              key.includes(other.required_action.toLowerCase()))
        );
        return match || null;
      })
      .filter(Boolean);

    // Find which docs this one blocks
    const blocks = docs.filter(
      (other) =>
        other.id !== doc.id &&
        (other.prerequisites || []).some((prereq) => {
          const p = prereq.toLowerCase().trim();
          const a = doc.required_action.toLowerCase().trim();
          return p === a || a.includes(p) || p.includes(a);
        })
    );

    return {
      ...doc,
      is_blocked: blockedBy.length > 0,
      blocked_by: blockedBy,
      blocks: blocks,
    };
  });
}

/**
 * Sort documents: unblocked first (by deadline urgency), then blocked.
 * @param {Array} docs - docs with dependency info from resolveDependencies
 * @returns {Array} sorted priority list
 */
export function buildPriorityList(docs) {
  return [...docs].sort((a, b) => {
    if (a.is_blocked !== b.is_blocked) return a.is_blocked ? 1 : -1;
    return (a.deadline_days || 999) - (b.deadline_days || 999);
  });
}

/**
 * Generate step-by-step reasoning chain for the AI Reasoning panel.
 * @param {Array} prioritized - sorted priority list from buildPriorityList
 * @returns {Array} reasoning steps
 */
export function generateReasoningSteps(prioritized) {
  const steps = [];
  const nextAction = prioritized[0];
  if (!nextAction) return steps;

  // Step 1: Identify documents
  steps.push({
    type: "scan",
    label: "Documents Uploaded",
    detail: `${prioritized.length} document${prioritized.length > 1 ? "s" : ""} received and digitized`,
    icon: "📄",
  });

  // Step 2: Multi-document analysis
  steps.push({
    type: "extract",
    label: "Multi-Document Analysis",
    detail: `Extracted ${prioritized.length} action${prioritized.length > 1 ? "s" : ""} from uploaded documents, analyzing relationships between them`,
    icon: "🔍",
  });

  // Dependency detection with WHY
  const blockedDocs = prioritized.filter((d) => d.is_blocked);
  if (blockedDocs.length > 0) {
    steps.push({
      type: "dependency",
      label: "Cross-Document Dependencies Detected",
      detail: `Found ${blockedDocs.length} blocking relationship${blockedDocs.length > 1 ? "s" : ""} between documents`,
      icon: "🔗",
    });

    blockedDocs.forEach((doc) => {
      doc.blocked_by.forEach((blocker) => {
        steps.push({
          type: "dependency",
          label: "Dependency Explanation",
          detail: doc.dependency_reason || `"${doc.required_action}" requires "${blocker.required_action}" — traced from ${blocker.source_document || "uploaded document"}`,
          icon: "🔗",
        });
      });
    });
  } else {
    steps.push({
      type: "extract",
      label: "No Dependencies Found",
      detail: "All actions are independent and can be completed in any order",
      icon: "✅",
    });
  }

  // Priority calculation
  steps.push({
    type: "recommend",
    label: "Priority Calculation",
    detail: `Sorted by deadline urgency and dependency relationships`,
    icon: "⚡",
  });

  // Recommended next action with WHY
  const whyFirst = nextAction.blocks && nextAction.blocks.length > 0
    ? `Unblocks ${nextAction.blocks.map((b) => b.required_action).join(" and ")} — completing this first enables ${nextAction.blocks.length} other action${nextAction.blocks.length > 1 ? "s" : ""}`
    : nextAction.deadline_days <= 3
    ? `Urgent deadline (${nextAction.deadline}) with no blockers — must be completed immediately`
    : `Earliest deadline (${nextAction.deadline}) with no blockers`;

  steps.push({
    type: "recommend",
    label: "Recommended Next Action",
    detail: `${nextAction.required_action} — ${whyFirst}`,
    icon: "✅",
  });

  return steps;
}

/**
 * Build summary statistics for the workflow.
 * @param {Array} prioritized - sorted priority list
 * @returns {Object} summary stats
 */
export function buildWorkflowSummary(prioritized) {
  const totalDocs = prioritized.length;
  const totalActions = prioritized.length;
  const dependencies = prioritized.filter((d) => d.is_blocked).length;
  const blockedTasks = prioritized.filter((d) => d.is_blocked).length;
  const totalTime = prioritized.reduce((sum, d) => {
    const mins = parseInt(d.estimated_time) || 0;
    return sum + mins;
  }, 0);

  return {
    totalDocs,
    totalActions,
    dependencies,
    blockedTasks,
    estimatedTime: `~${totalTime} minutes`,
  };
}

/**
 * Hardcoded fallback extraction data for when Sarvam API is unavailable.
 */
export const FALLBACK_EXTRACTIONS = [
  {
    id: "doc1",
    document_type: "Aadhaar Update Form",
    organization: "UIDAI (Unique Identification Authority of India)",
    title: "Aadhaar Demographic Update (Address, Email)",
    required_action: "Visit Aadhaar Seva Kendra for demographic update",
    required_documents: [
      "Original documents for enrollment/update (no photocopy)",
      "Proof of address (Voter ID, Driving License, or similar)",
      "Appointment confirmation print"
    ],
    prerequisites: [],
    deadline: "Appointment: 02-01-2025 at 08:30",
    deadline_days: 6,
    estimated_time: "30-45 minutes",
    consequence: "Appointment will be cancelled. Aadhaar information will remain outdated, may affect access to government services and subsidies.",
    confidence: 0.96,
    source_document: "Aadhaar Update Form (Application No: 545138854492)",
    source_page: "Form dated 26-12-2024",
    dependency_reason: "No dependencies detected",
  },
  {
    id: "doc2",
    document_type: "Bank Notice",
    organization: "XYZ Bank",
    title: "Bank KYC Reminder",
    required_action: "Complete KYC re-verification at nearest branch",
    required_documents: [
      "Updated Aadhaar card",
      "PAN card",
      "Recent photograph"
    ],
    prerequisites: ["Visit Aadhaar Seva Kendra for demographic update"],
    deadline: "Within 10 days",
    deadline_days: 10,
    estimated_time: "15-20 minutes",
    consequence: "Account restrictions and potential freeze as per RBI guidelines",
    confidence: 0.92,
    source_document: "Bank KYC Reminder",
    source_page: "Full document",
    dependency_reason: "Bank KYC requires updated Aadhaar with current address as per RBI guidelines. Must complete Aadhaar update first.",
  },
];
