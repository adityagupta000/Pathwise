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
      // Only "high" confidence edges create blockers; "medium" go to fuzzy
      const edgeConf = edge.confidence || "high";
      modelEdgesByFromId.get(fromId).push({
        id: toId,
        confidence: edgeConf,
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
        if (mEdge.confidence === "medium") {
          // Medium confidence: informational only, not blocking
          if (!seenFuzzyIds.has(mEdge.id) && !seenHighIds.has(mEdge.id)) {
            seenFuzzyIds.add(mEdge.id);
            fuzzySuggestions.push({ id: mEdge.id, confidence: "medium", method: "model", reason: mEdge.reason });
          }
        } else if (!seenHighIds.has(mEdge.id)) {
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
    // non-generic words. Does NOT require dependency_reason field.
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
 * Propagate deadline urgency backward through the dependency graph.
 * For each doc: effective_deadline_days = min(own deadline_days, min over docs this one blocks of their effective_deadline_days).
 * Overdue (negative) values propagate.
 * Cycle members use their own deadline if any, else null.
 *
 * @param {Array} docs - Array of documents (with id, deadline_days, cycle_detected, blocks, etc.)
 * @param {Array} edges - Optional array of high-confidence edges
 * @returns {Map<string, number|null>} map of doc_id -> effective_deadline_days
 */
export function propagateUrgency(docs, edges = []) {
  if (!Array.isArray(docs) || docs.length === 0) {
    return new Map();
  }

  const effectiveMap = new Map();
  const directBlocks = new Map();
  const cycleDocIds = new Set();

  for (const doc of docs) {
    if (!doc || !doc.id) continue;
    directBlocks.set(doc.id, new Set());
    const ownDays = typeof doc.deadline_days === 'number' ? doc.deadline_days : null;
    effectiveMap.set(doc.id, ownDays);

    if (doc.cycle_detected) {
      cycleDocIds.add(doc.id);
    }

    if (Array.isArray(doc.blocks)) {
      for (const b of doc.blocks) {
        const bId = typeof b === 'string' ? b : b?.id;
        if (bId) directBlocks.get(doc.id).add(bId);
      }
    }
  }

  // Also populate blocks from edges if supplied
  if (Array.isArray(edges)) {
    for (const edge of edges) {
      if (!edge) continue;
      const blockerId = edge.to || edge.depends_on_doc_id;
      const dependentId = edge.from || edge.from_doc_id;
      if (blockerId && dependentId && directBlocks.has(blockerId)) {
        directBlocks.get(blockerId).add(dependentId);
      }
    }
  }

  // Fixed-point relaxation up to docs.length iterations
  for (let iter = 0; iter < docs.length; iter++) {
    let changed = false;
    for (const doc of docs) {
      if (!doc || !doc.id) continue;
      if (cycleDocIds.has(doc.id)) continue; // Guard cycles: keep own deadline

      const dependents = directBlocks.get(doc.id) || [];
      let best = effectiveMap.get(doc.id);

      for (const depId of dependents) {
        const depEff = effectiveMap.get(depId);
        if (typeof depEff === 'number') {
          if (typeof best === 'number') {
            best = Math.min(best, depEff);
          } else {
            best = depEff;
          }
        }
      }

      if (best !== effectiveMap.get(doc.id)) {
        effectiveMap.set(doc.id, best);
        changed = true;
      }
    }
    if (!changed) break;
  }

  return effectiveMap;
}

/**
 * Compute transitive dependents count (how many documents this one transitively unblocks).
 */
function getTransitiveDependentsCount(docId, blocksMap) {
  const visited = new Set();
  const queue = [...(blocksMap.get(docId) || [])];
  while (queue.length > 0) {
    const nextId = queue.shift();
    if (!visited.has(nextId)) {
      visited.add(nextId);
      const nextBlocks = blocksMap.get(nextId) || [];
      for (const bId of nextBlocks) {
        if (!visited.has(bId)) {
          queue.push(bId);
        }
      }
    }
  }
  return visited.size;
}

/**
 * Priority queue comparator for Kahn's algorithm.
 */
function compareReadyDocs(a, b) {
  const aEff = a.effective_deadline_days;
  const bEff = b.effective_deadline_days;
  const aOverdue = typeof aEff === 'number' && aEff < 0;
  const bOverdue = typeof bEff === 'number' && bEff < 0;

  // 1. Overdue first (effective_deadline_days < 0): more negative = higher priority
  if (aOverdue && bOverdue) {
    if (aEff !== bEff) return aEff - bEff;
  } else if (aOverdue !== bOverdue) {
    return aOverdue ? -1 : 1;
  }

  // 2. Smaller effective_deadline_days (known deadline first, null last)
  const aHasEff = typeof aEff === 'number';
  const bHasEff = typeof bEff === 'number';
  if (aHasEff && bHasEff) {
    if (aEff !== bEff) return aEff - bEff;
  } else if (aHasEff !== bHasEff) {
    return aHasEff ? -1 : 1;
  }

  // 3. More transitive dependents
  const aTrans = a._transitiveDependents || 0;
  const bTrans = b._transitiveDependents || 0;
  if (aTrans !== bTrans) {
    return bTrans - aTrans;
  }

  // 4. Higher confidence
  const aConf = typeof a.confidence === 'number' ? a.confidence : 0.5;
  const bConf = typeof b.confidence === 'number' ? b.confidence : 0.5;
  if (aConf !== bConf) {
    return bConf - aConf;
  }

  // 5. Lower original doc_index (stable tie-break)
  const aIdx = typeof a.doc_index === 'number' ? a.doc_index : 0;
  const bIdx = typeof b.doc_index === 'number' ? b.doc_index : 0;
  return aIdx - bIdx;
}

/**
 * Generate human-readable priority reason from facts.
 */
function generatePriorityReason(item) {
  if (item.cycle_detected) {
    return "Circular dependency detected. Manual review required.";
  }
  const unblocked = Array.isArray(item.blocks) && item.blocks.length > 0;
  const unblockText = unblocked
    ? ` Also unblocks '${item.blocks[0].required_action}'${item.blocks.length > 1 ? ` and ${item.blocks.length - 1} other task(s)` : ''}.`
    : '';

  if (typeof item.deadline_days === 'number' && item.deadline_days < 0) {
    const days = Math.abs(item.deadline_days);
    return `OVERDUE by ${days} day${days === 1 ? '' : 's'}.${unblockText}`;
  }
  if (item.deadline_days === 0) {
    return `Due TODAY.${unblockText}`;
  }
  if (typeof item.deadline_days === 'number' && item.deadline_days > 0) {
    return `Due in ${item.deadline_days} day${item.deadline_days === 1 ? '' : 's'}.${unblockText}`;
  }
  if (item.deadline_text && item.deadline_relative_days) {
    return `Deadline: ${item.deadline_text}.${unblockText}`;
  }
  if (unblocked) {
    return `Unblocks ${item.blocks.map(b => `'${b.required_action}'`).join(' and ')}.`;
  }
  if (item.is_blocked && Array.isArray(item.blocked_by) && item.blocked_by.length > 0) {
    return `Blocked by ${item.blocked_by.map(b => `'${b.required_action}'`).join(' and ')}.`;
  }
  return "No blockers and can be started immediately.";
}

/**
 * Sort documents using Kahn's algorithm + priority queue and urgency propagation.
 * @param {Array} docs - docs with dependency info from resolveDependencies
 * @returns {Array} sorted priority list with priority_rank, status, effective_deadline_days, priority_reason
 */
export function buildPriorityList(docs) {
  if (!Array.isArray(docs) || docs.length === 0) {
    return [];
  }

  // Pre-process docs: ensure doc_index is present
  const preparedDocs = docs.map((doc, idx) => ({
    ...doc,
    doc_index: typeof doc.doc_index === 'number' ? doc.doc_index : idx,
  }));

  // Build block map for transitive lookup
  const blocksMap = new Map();
  preparedDocs.forEach((d) => blocksMap.set(d.id, []));
  preparedDocs.forEach((d) => {
    if (Array.isArray(d.blocks)) {
      d.blocks.forEach((b) => {
        const bId = typeof b === 'string' ? b : b?.id;
        if (bId && blocksMap.has(d.id)) {
          blocksMap.get(d.id).push(bId);
        }
      });
    }
  });

  // Urgency propagation
  const effectiveMap = propagateUrgency(preparedDocs);

  // Attach effective deadline and transitive dependents
  preparedDocs.forEach((d) => {
    d.effective_deadline_days = effectiveMap.get(d.id) ?? null;
    d._transitiveDependents = getTransitiveDependentsCount(d.id, blocksMap);
  });

  // Separate cycle members from DAG members
  const cycleDocs = preparedDocs.filter((d) => d.cycle_detected);
  const dagDocs = preparedDocs.filter((d) => !d.cycle_detected);
  const dagDocIds = new Set(dagDocs.map((d) => d.id));

  // Kahn's algorithm on dagDocs
  const inDegree = new Map();
  const unresolvedBlockers = new Map();
  const docById = new Map();
  dagDocs.forEach((d) => {
    docById.set(d.id, d);
    const blockers = (d.blocked_by || [])
      .map((b) => (typeof b === 'string' ? b : b.id))
      .filter((id) => dagDocIds.has(id));
    const blockerSet = new Set(blockers);
    inDegree.set(d.id, blockerSet.size);
    unresolvedBlockers.set(d.id, blockerSet);
  });

  const readyQueue = dagDocs.filter((d) => !d.is_blocked && inDegree.get(d.id) === 0);
  const orderedDag = [];
  const processed = new Set();

  while (readyQueue.length > 0 || orderedDag.length < dagDocs.length) {
    if (readyQueue.length === 0) {
      // Remaining dagDocs (e.g. if blocked by cycle node or mock blocked doc)
      const remaining = dagDocs.filter((d) => !processed.has(d.id));
      if (remaining.length === 0) break;
      remaining.sort(compareReadyDocs);
      const nextDoc = remaining[0];
      readyQueue.push(nextDoc);
    }

    readyQueue.sort(compareReadyDocs);
    const current = readyQueue.shift();
    if (processed.has(current.id)) continue;

    processed.add(current.id);
    orderedDag.push(current);

    // Unblock dependents
    const dependents = blocksMap.get(current.id) || [];
    for (const depId of dependents) {
      if (dagDocIds.has(depId) && !processed.has(depId)) {
        const remainingBlockers = unresolvedBlockers.get(depId);
        if (remainingBlockers && remainingBlockers.has(current.id)) {
          remainingBlockers.delete(current.id);
          inDegree.set(depId, remainingBlockers.size);
          if (remainingBlockers.size === 0) {
            readyQueue.push(docById.get(depId));
          }
        }
      }
    }
  }

  // Sort cycle members: own deadline first, then confidence, then doc_index
  cycleDocs.sort((a, b) => {
    const aDays = typeof a.deadline_days === 'number' ? a.deadline_days : null;
    const bDays = typeof b.deadline_days === 'number' ? b.deadline_days : null;
    const aOverdue = typeof aDays === 'number' && aDays < 0;
    const bOverdue = typeof bDays === 'number' && bDays < 0;
    if (aOverdue && bOverdue) {
      if (aDays !== bDays) return aDays - bDays;
    } else if (aOverdue !== bOverdue) {
      return aOverdue ? -1 : 1;
    }
    if (typeof aDays === 'number' && typeof bDays === 'number') {
      if (aDays !== bDays) return aDays - bDays;
    } else if (typeof aDays === 'number' !== (typeof bDays === 'number')) {
      return typeof aDays === 'number' ? -1 : 1;
    }
    const aConf = typeof a.confidence === 'number' ? a.confidence : 0.5;
    const bConf = typeof b.confidence === 'number' ? b.confidence : 0.5;
    if (aConf !== bConf) return bConf - aConf;
    return (a.doc_index || 0) - (b.doc_index || 0);
  });

  const fullList = [...orderedDag, ...cycleDocs];

  return fullList.map((item, index) => {
    let status;
    if (item.cycle_detected) {
      status = 'cycle';
    } else if (typeof item.deadline_days === 'number' && item.deadline_days < 0) {
      status = 'overdue';
    } else if (item.is_blocked) {
      status = 'blocked';
    } else if (typeof item.deadline_days === 'number' && item.deadline_days <= 3) {
      status = 'urgent';
    } else {
      status = 'ready';
    }

    const cleaned = { ...item };
    delete cleaned._transitiveDependents;

    return {
      ...cleaned,
      priority_rank: index + 1,
      status,
      effective_deadline_days: item.effective_deadline_days ?? null,
      priority_reason: generatePriorityReason(item),
    };
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
  const whyFirst = nextAction.priority_reason || (
    nextAction.blocks && nextAction.blocks.length > 0
      ? `Unblocks ${nextAction.blocks.map((b) => b.required_action).join(" and ")} — completing this first enables ${nextAction.blocks.length} other action${nextAction.blocks.length > 1 ? "s" : ""}`
      : nextAction.deadline_days !== null && nextAction.deadline_days <= 3
      ? `Urgent deadline (${nextAction.deadline}) with no blockers — must be completed immediately`
      : nextAction.deadline_days !== null
      ? `Earliest deadline (${nextAction.deadline}) with no blockers`
      : "No blockers and can be started immediately"
  );

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
 * @param {number} [docCount] - total uploaded document count
 * @returns {Object} summary stats
 */
export function buildWorkflowSummary(prioritized, docCount) {
  if (!Array.isArray(prioritized)) {
    return {
      documents: typeof docCount === 'number' ? docCount : 0,
      actions: 0,
      dependencies: 0,
      blocked: 0,
      estimated_minutes: null,
      totalDocs: typeof docCount === 'number' ? docCount : 0,
      totalActions: 0,
      blockedTasks: 0,
      estimatedTime: null,
    };
  }

  const documents = typeof docCount === 'number' ? docCount : prioritized.length;
  const actions = prioritized.length;

  let dependencyCount = 0;
  let blockedCount = 0;
  let estimatedSum = 0;
  let hasEstimated = false;

  for (const doc of prioritized) {
    if (!doc) continue;
    if (doc.is_blocked) {
      blockedCount++;
    }
    if (Array.isArray(doc.blocked_by)) {
      for (const blocker of doc.blocked_by) {
        if (!blocker._dependency_confidence || blocker._dependency_confidence === 'high') {
          dependencyCount++;
        }
      }
    }
    const mins = typeof doc.estimated_time_minutes === 'number' && Number.isInteger(doc.estimated_time_minutes) && doc.estimated_time_minutes > 0
      ? doc.estimated_time_minutes
      : null;
    if (mins !== null) {
      estimatedSum += mins;
      hasEstimated = true;
    }
  }

  const estimatedMinutes = hasEstimated ? estimatedSum : null;

  return {
    documents,
    actions,
    dependencies: dependencyCount,
    blocked: blockedCount,
    estimated_minutes: estimatedMinutes,
    // Backward compat aliases
    totalDocs: documents,
    totalActions: actions,
    blockedTasks: blockedCount,
    estimatedTime: estimatedMinutes !== null ? `~${estimatedMinutes} minutes` : null,
  };
}

// Note: Fallback data removed - application now requires valid Sarvam API key
