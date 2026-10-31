// ── PathWise Dependency & Priority Engines ──
// Pure logic — no API calls, no React, no side effects.

/**
 * Normalize an action string: lowercase, trimmed, trailing punctuation stripped.
 */
function normalizeAction(str) {
  if (!str || typeof str !== 'string') return '';
  return str.toLowerCase().trim().replace(/[.,;:]+$/, '').trim();
}

/**
 * Compute token-level Jaccard similarity on word unigrams.
 */
function computeTokenJaccard(strA, strB) {
  const wordsA = new Set(strA.toLowerCase().match(/\b\w+\b/g) || []);
  const wordsB = new Set(strB.toLowerCase().match(/\b\w+\b/g) || []);
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * Tarjan's strongly connected components.
 * @param {string[]} nodeIds
 * @param {Array<{from: string, to: string}>} edges
 * @returns {string[][]} array of SCCs, each SCC is an array of node ids; SCCs of size>1 contain cycles.
 */
export function tarjanSCC(nodeIds, edges) {
  if (!Array.isArray(nodeIds)) return [];
  let index = 0;
  const indices = new Map();
  const lowlink = new Map();
  const onStack = new Map();
  const stack = [];
  const sccs = [];

  const adj = new Map();
  for (const id of nodeIds) {
    adj.set(id, []);
  }
  if (Array.isArray(edges)) {
    for (const edge of edges) {
      if (!edge) continue;
      const from = edge.from;
      const to = edge.to;
      if (adj.has(from) && adj.has(to)) {
        adj.get(from).push(to);
      }
    }
  }

  function strongconnect(u) {
    indices.set(u, index);
    lowlink.set(u, index);
    index++;
    stack.push(u);
    onStack.set(u, true);

    const neighbors = adj.get(u) || [];
    for (const v of neighbors) {
      if (!indices.has(v)) {
        strongconnect(v);
        lowlink.set(u, Math.min(lowlink.get(u), lowlink.get(v)));
      } else if (onStack.get(v)) {
        lowlink.set(u, Math.min(lowlink.get(u), indices.get(v)));
      }
    }

    if (lowlink.get(u) === indices.get(u)) {
      const scc = [];
      let w;
      do {
        w = stack.pop();
        onStack.set(w, false);
        scc.push(w);
      } while (w !== u);
      sccs.push(scc);
    }
  }

  for (const id of nodeIds) {
    if (!indices.has(id)) {
      strongconnect(id);
    }
  }

  return sccs;
}

/**
 * Cross-reference prerequisites against required_actions to find blockers.
 * Uses Stage B model edges, exact matching, and safe evidence-based fuzzy matching.
 * Detects cycles using Tarjan's SCC algorithm.
 * 
 * @param {Array} docs - Array of extracted document objects
 * @param {Array} dependencyEdges - Optional validated Stage B edges
 * @returns {Array} docs with is_blocked, is_fuzzy_only, blocked_by, fuzzy_suggestions, blocks, cycle_detected fields added
 */
export function resolveDependencies(docs, dependencyEdges = []) {
  if (!Array.isArray(docs) || docs.length === 0) {
    return [];
  }

  // Lookup doc by id
  const docById = new Map();
  docs.forEach((doc) => {
    if (doc && doc.id) {
      docById.set(doc.id, doc);
    }
  });

  // Action map: normalized action -> Set of doc IDs
  const actionMap = new Map();
  docs.forEach((doc) => {
    if (doc && doc.required_action) {
      const key = normalizeAction(doc.required_action);
      if (key) {
        if (!actionMap.has(key)) {
          actionMap.set(key, new Set());
        }
        actionMap.get(key).add(doc.id);
      }
    }
  });

  // Map of Stage B model edges: from_doc_id depends on depends_on_doc_id
  const modelEdgesByFromId = new Map();
  if (Array.isArray(dependencyEdges)) {
    for (const edge of dependencyEdges) {
      if (!edge) continue;
      const fromId = edge.from_doc_id || edge.from;
      const toId = edge.depends_on_doc_id || edge.to;
      if (!fromId || !toId || fromId === toId) continue;
      if (!docById.has(fromId) || !docById.has(toId)) continue;
      if (!modelEdgesByFromId.has(fromId)) {
        modelEdgesByFromId.set(fromId, []);
      }
      modelEdgesByFromId.get(fromId).push({
        id: toId,
        confidence: "high",
        method: "model",
        reason: edge.reason || null,
        evidence_quote: edge.evidence_quote || null,
        evidence_doc_id: edge.evidence_doc_id || null,
      });
    }
  }

  const genericWords = new Set(["update", "submit", "complete", "fill", "provide", "attach"]);

  // Process dependencies for each document
  const docDeps = docs.map((doc) => {
    if (!doc || !doc.id) {
      return { id: doc?.id, highBlockers: [], fuzzySuggestions: [] };
    }

    const highBlockers = [];
    const seenHighIds = new Set();
    const fuzzySuggestions = [];
    const seenFuzzyIds = new Set();

    // 1. Stage B model edges
    if (modelEdgesByFromId.has(doc.id)) {
      for (const mEdge of modelEdgesByFromId.get(doc.id)) {
        if (!seenHighIds.has(mEdge.id)) {
          seenHighIds.add(mEdge.id);
          highBlockers.push(mEdge);
        }
      }
    }

    // 2. Exact prerequisite matches
    const prerequisites = Array.isArray(doc.prerequisites) ? doc.prerequisites : [];
    for (const prereq of prerequisites) {
      if (!prereq || typeof prereq !== 'string' || !prereq.trim()) continue;
      const pNorm = normalizeAction(prereq);
      if (!pNorm) continue;

      if (actionMap.has(pNorm)) {
        for (const matchId of actionMap.get(pNorm)) {
          if (matchId !== doc.id && !seenHighIds.has(matchId)) {
            seenHighIds.add(matchId);
            highBlockers.push({ id: matchId, confidence: "high", method: "exact" });
          }
        }
      }
    }

    // 3. Safe fuzzy match
    // Only if: both strings >= 12 chars, token-Jaccard >= 0.6 (word unigrams),
    // non-generic words, dependency_reason exists and != "No dependencies detected"
    const depReason = (doc.dependency_reason || '').toLowerCase().trim();
    const hasMeaningfulReason = depReason && !depReason.includes("no dependencies");

    if (hasMeaningfulReason) {
      for (const prereq of prerequisites) {
        if (!prereq || typeof prereq !== 'string' || !prereq.trim()) continue;
        const pNorm = normalizeAction(prereq);
        if (pNorm.length < 12) continue;

        const pWords = pNorm.match(/\b\w+\b/g) || [];
        if (pWords.length === 0 || pWords.every(w => genericWords.has(w))) continue;

        for (const other of docs) {
          if (!other || !other.id || other.id === doc.id) continue;
          if (seenHighIds.has(other.id) || seenFuzzyIds.has(other.id)) continue;

          const otherAction = normalizeAction(other.required_action);
          if (otherAction.length < 12) continue;

          const otherWords = otherAction.match(/\b\w+\b/g) || [];
          if (otherWords.length === 0 || otherWords.every(w => genericWords.has(w))) continue;

          const jaccard = computeTokenJaccard(pNorm, otherAction);
          if (jaccard >= 0.6) {
            seenFuzzyIds.add(other.id);
            fuzzySuggestions.push({ id: other.id, confidence: "low", method: "fuzzy" });
          }
        }
      }
    }

    return {
      id: doc.id,
      highBlockers,
      fuzzySuggestions,
    };
  });

  const depMap = new Map();
  docDeps.forEach((dep) => depMap.set(dep.id, dep));

  // Build high-confidence directed graph: edge from doc.id -> blocker.id (doc depends on blocker)
  const nodeIds = docs.map((d) => d.id).filter(Boolean);
  const highEdges = [];
  docDeps.forEach((dep) => {
    dep.highBlockers.forEach((blocker) => {
      highEdges.push({ from: dep.id, to: blocker.id });
    });
  });

  // Cycle detection with Tarjan SCC
  const sccs = tarjanSCC(nodeIds, highEdges);
  const cycleInfo = new Map(); // id -> scc array
  sccs.forEach((scc) => {
    if (scc.length > 1) {
      scc.forEach((id) => cycleInfo.set(id, scc));
    }
  });

  // Compute blocks (inverse for high blockers)
  const blocksMap = new Map();
  nodeIds.forEach((id) => blocksMap.set(id, []));

  docDeps.forEach((dep) => {
    dep.highBlockers.forEach((blocker) => {
      if (blocksMap.has(blocker.id)) {
        const dependentDoc = docById.get(dep.id);
        if (dependentDoc && !blocksMap.get(blocker.id).some((d) => d.id === dep.id)) {
          blocksMap.get(blocker.id).push(dependentDoc);
        }
      }
    });
  });

  return docs.map((doc) => {
    if (!doc || !doc.id) {
      return {
        ...doc,
        is_blocked: false,
        is_fuzzy_only: false,
        blocked_by: [],
        fuzzy_suggestions: [],
        blocks: [],
        cycle_detected: false,
      };
    }

    const dep = depMap.get(doc.id);
    if (!dep) {
      return {
        ...doc,
        is_blocked: false,
        is_fuzzy_only: false,
        blocked_by: [],
        fuzzy_suggestions: [],
        blocks: [],
        cycle_detected: false,
      };
    }

    const blockedBy = dep.highBlockers
      .map(({ id, confidence, method, reason, evidence_quote, evidence_doc_id }) => {
        const blockerDoc = docById.get(id);
        return blockerDoc
          ? {
              ...blockerDoc,
              _dependency_confidence: confidence,
              _dependency_method: method,
              _dependency_reason: reason,
              _evidence_quote: evidence_quote,
              _evidence_doc_id: evidence_doc_id,
            }
          : null;
      })
      .filter(Boolean);

    const fuzzySuggestions = dep.fuzzySuggestions
      .map(({ id, confidence, method }) => {
        const blockerDoc = docById.get(id);
        return blockerDoc
          ? {
              ...blockerDoc,
              _dependency_confidence: confidence,
              _dependency_method: method,
            }
          : null;
      })
      .filter(Boolean);

    const blocks = blocksMap.get(doc.id) || [];
    const cycle = cycleInfo.get(doc.id);

    const isHighBlocked = blockedBy.length > 0;
    const isFuzzyOnly = !isHighBlocked && fuzzySuggestions.length > 0;

    return {
      ...doc,
      is_blocked: isHighBlocked,
      is_fuzzy_only: isFuzzyOnly,
      blocked_by: blockedBy,
      fuzzy_suggestions: fuzzySuggestions,
      blocks: blocks,
      cycle_detected: !!cycle,
      cycle_path: cycle || undefined,
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
    // null = unknown urgency, treated separately from distant deadlines
    const aDays = typeof a.deadline_days === 'number' && a.deadline_days >= 0 ? a.deadline_days : 999;
    const bDays = typeof b.deadline_days === 'number' && b.deadline_days >= 0 ? b.deadline_days : 999;
    
    // Unknown deadlines (null) come after known deadlines but before very distant ones
    const aHasDeadline = typeof a.deadline_days === 'number' && a.deadline_days >= 0;
    const bHasDeadline = typeof b.deadline_days === 'number' && b.deadline_days >= 0;
    
    if (aHasDeadline !== bHasDeadline) {
      return aHasDeadline ? -1 : 1; // Known deadline wins
    }
    
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
  const cyclesDetected = prioritized.filter((d) => d.cycle_detected);
  
  if (cyclesDetected.length > 0) {
    steps.push({
      type: "warning",
      label: "WARNING: Circular Dependencies Detected",
      detail: `Found ${cyclesDetected.length} circular dependency relationship${cyclesDetected.length > 1 ? "s" : ""}. These actions may block each other. Review manually.`,
      icon: "!",
    });
  }
  
  if (blockedDocs.length > 0) {
    steps.push({
      type: "dependency",
      label: "Cross-Document Dependencies Detected",
      detail: `Found ${blockedDocs.length} blocking relationship${blockedDocs.length > 1 ? "s" : ""} between documents`,
      icon: "3",
    });

    blockedDocs.slice(0, 3).forEach((doc) => {
      doc.blocked_by.forEach((blocker) => {
        steps.push({
          type: "dependency",
          label: "Dependency Explanation",
          detail: doc.dependency_reason || `"${doc.required_action}" requires "${blocker.required_action}" — traced from ${blocker.source_document || "uploaded document"}`,
          icon: "-",
        });
      });
    });
    
    if (blockedDocs.length > 3) {
      steps.push({
        type: "dependency",
        label: "Additional Dependencies",
        detail: `...and ${blockedDocs.length - 3} more blocking relationship${blockedDocs.length - 3 > 1 ? "s" : ""}`,
        icon: "-",
      });
    }
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
    detail: `Sorted by deadline urgency, unblocking potential, and dependency relationships`,
    icon: "4",
  });

  // Recommended next action with WHY
  const whyFirst = nextAction.blocks && nextAction.blocks.length > 0
    ? `Unblocks ${nextAction.blocks.map((b) => b.required_action).join(" and ")} — completing this first enables ${nextAction.blocks.length} other action${nextAction.blocks.length > 1 ? "s" : ""}`
    : nextAction.deadline_days !== null && nextAction.deadline_days <= 3
    ? `Urgent deadline (${nextAction.deadline}) with no blockers — must be completed immediately`
    : nextAction.deadline_days !== null
    ? `Earliest deadline (${nextAction.deadline}) with no blockers`
    : "No blockers and can be started immediately";

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
