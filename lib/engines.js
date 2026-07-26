// ── PathWise Dependency & Priority Engines ──
// Pure logic — no API calls, no React, no side effects.

/**
 * Cross-reference prerequisites against required_actions to find blockers.
 * @param {Array} docs - Array of extracted document objects
 * @returns {Array} docs with is_blocked, blocked_by, blocks fields added
 */
export function resolveDependencies(docs) {
  // Validate input
  if (!Array.isArray(docs) || docs.length === 0) {
    return [];
  }

  // Build a lookup: lowercase action → doc
  const actionMap = {};
  docs.forEach((doc) => {
    if (doc && doc.required_action) {
      const key = doc.required_action.toLowerCase().trim();
      if (key) {
        actionMap[key] = doc;
      }
    }
  });

  return docs.map((doc) => {
    // Safety check
    if (!doc || !doc.required_action) {
      return {
        ...doc,
        is_blocked: false,
        blocked_by: [],
        blocks: [],
      };
    }

    // Find which other docs this one depends on
    const prerequisites = Array.isArray(doc.prerequisites) ? doc.prerequisites : [];
    const blockedBy = prerequisites
      .filter(prereq => prereq && typeof prereq === 'string' && prereq.trim())
      .map((prereq) => {
        const key = prereq.toLowerCase().trim();

        // Try exact match first
        if (actionMap[key] && actionMap[key].id !== doc.id) {
          return actionMap[key];
        }

        // Fuzzy: check if any action contains the prereq (minimum 5 chars overlap)
        if (key.length >= 5) {
          const match = docs.find(
            (other) =>
              other &&
              other.id !== doc.id &&
              other.required_action &&
              (other.required_action.toLowerCase().includes(key) ||
                key.includes(other.required_action.toLowerCase()))
          );
          if (match) return match;
        }

        return null;
      })
      .filter(Boolean)
      .filter((blocker, index, self) =>
        // Remove duplicates
        self.findIndex(b => b.id === blocker.id) === index
      );

    // Find which docs this one blocks
    const blocks = docs.filter(
      (other) =>
        other &&
        other.id !== doc.id &&
        other.prerequisites &&
        Array.isArray(other.prerequisites) &&
        other.prerequisites.some((prereq) => {
          if (!prereq || typeof prereq !== 'string') return false;
          const p = prereq.toLowerCase().trim();
          const a = doc.required_action.toLowerCase().trim();
          return p && a && (p === a || (p.length >= 5 && (a.includes(p) || p.includes(a))));
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
  // Validate input
  if (!Array.isArray(docs) || docs.length === 0) {
    return [];
  }

  return [...docs].sort((a, b) => {
    // 1. Unblocked tasks before blocked tasks
    if (a.is_blocked !== b.is_blocked) {
      return a.is_blocked ? 1 : -1;
    }

    // 2. Tasks that unblock others come first
    const aUnblocks = (a.blocks && a.blocks.length) || 0;
    const bUnblocks = (b.blocks && b.blocks.length) || 0;
    if (aUnblocks !== bUnblocks) {
      return bUnblocks - aUnblocks; // More unblocked items = higher priority
    }

    // 3. Earlier deadlines come first
    const aDays = typeof a.deadline_days === 'number' ? a.deadline_days : 999;
    const bDays = typeof b.deadline_days === 'number' ? b.deadline_days : 999;
    if (aDays !== bDays) {
      return aDays - bDays;
    }

    // 4. Higher confidence comes first
    const aConf = typeof a.confidence === 'number' ? a.confidence : 0.5;
    const bConf = typeof b.confidence === 'number' ? b.confidence : 0.5;
    return bConf - aConf;
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
    icon: "1",
  });

  // Step 2: Multi-document analysis
  steps.push({
    type: "extract",
    label: "Multi-Document Analysis",
    detail: `Extracted ${prioritized.length} action${prioritized.length > 1 ? "s" : ""} from uploaded documents, analyzing relationships between them`,
    icon: "2",
  });

  // Dependency detection with WHY
  const blockedDocs = prioritized.filter((d) => d.is_blocked);
  if (blockedDocs.length > 0) {
    steps.push({
      type: "dependency",
      label: "Cross-Document Dependencies Detected",
      detail: `Found ${blockedDocs.length} blocking relationship${blockedDocs.length > 1 ? "s" : ""} between documents`,
      icon: "3",
    });

    blockedDocs.forEach((doc) => {
      doc.blocked_by.forEach((blocker) => {
        steps.push({
          type: "dependency",
          label: "Dependency Explanation",
          detail: doc.dependency_reason || `"${doc.required_action}" requires "${blocker.required_action}" — traced from ${blocker.source_document || "uploaded document"}`,
          icon: "-",
        });
      });
    });
  } else {
    steps.push({
      type: "extract",
      label: "No Dependencies Found",
      detail: "All actions are independent and can be completed in any order",
      icon: "3",
    });
  }

  // Priority calculation
  steps.push({
    type: "recommend",
    label: "Priority Calculation",
    detail: `Sorted by deadline urgency and dependency relationships`,
    icon: "4",
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
    icon: "5",
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

// Note: Fallback data removed - application now requires valid Sarvam API key
