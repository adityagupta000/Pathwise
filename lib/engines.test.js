import { describe, it, expect } from 'vitest';
import {
  resolveDependencies,
  buildPriorityList,
  tarjanSCC,
  propagateUrgency,
  buildWorkflowSummary,
  generateReasoningSteps,
} from './engines.js';

describe('resolveDependencies', () => {
  it('finds exact prerequisite matches', () => {
    const docs = [
      {
        id: 'doc1',
        required_action: 'Update Aadhaar Address',
        prerequisites: [],
        dependency_reason: 'No dependencies detected',
      },
      {
        id: 'doc2',
        required_action: 'Complete Bank KYC',
        prerequisites: ['Update Aadhaar Address'],
        dependency_reason: 'KYC requires updated Aadhaar as per RBI guidelines',
      },
    ];

    const resolved = resolveDependencies(docs);
    expect(resolved[0].is_blocked).toBe(false);
    expect(resolved[0].blocks).toHaveLength(1);
    expect(resolved[1].is_blocked).toBe(true);
    expect(resolved[1].blocked_by).toHaveLength(1);
    expect(resolved[1].blocked_by[0].id).toBe('doc1');
  });

  it('prevents false positives from generic words', () => {
    const docs = [
      {
        id: 'doc1',
        required_action: 'Update Aadhaar',
        prerequisites: [],
        dependency_reason: 'No dependencies detected',
      },
      {
        id: 'doc2',
        required_action: 'Update Bank Details',
        prerequisites: ['Update Form'],
        dependency_reason: 'No dependencies detected',
      },
    ];

    const resolved = resolveDependencies(docs);
    // "Update" is too generic, should not match
    expect(resolved[1].blocked_by).toHaveLength(0);
  });

  it('detects cycles in dependencies', () => {
    const docs = [
      {
        id: 'doc1',
        required_action: 'Task A',
        prerequisites: ['Task B'],
        dependency_reason: 'Task A requires Task B to be completed first',
      },
      {
        id: 'doc2',
        required_action: 'Task B',
        prerequisites: ['Task A'],
        dependency_reason: 'Task B requires Task A to be completed first',
      },
    ];

    const resolved = resolveDependencies(docs);
    
    // Both documents should be marked as part of a cycle
    expect(resolved[0].cycle_detected).toBe(true);
    expect(resolved[1].cycle_detected).toBe(true);
    
    // Cycle path should include both IDs
    expect(resolved[0].cycle_path).toBeDefined();
    expect(resolved[0].cycle_path.length).toBeGreaterThan(0);
  });

  it('detects three-way cycles', () => {
    const docs = [
      {
        id: 'doc1',
        required_action: 'Task A',
        prerequisites: ['Task B'],
        dependency_reason: 'A depends on B',
      },
      {
        id: 'doc2',
        required_action: 'Task B',
        prerequisites: ['Task C'],
        dependency_reason: 'B depends on C',
      },
      {
        id: 'doc3',
        required_action: 'Task C',
        prerequisites: ['Task A'],
        dependency_reason: 'C depends on A',
      },
    ];

    const resolved = resolveDependencies(docs);
    
    // All three should be marked as part of cycle
    expect(resolved.filter(d => d.cycle_detected).length).toBe(3);
  });

  it('handles documents with no dependencies', () => {
    const docs = [
      {
        id: 'doc1',
        required_action: 'File Tax Return',
        prerequisites: [],
        dependency_reason: 'No dependencies detected',
      },
    ];

    const resolved = resolveDependencies(docs);
    expect(resolved[0].is_blocked).toBe(false);
    expect(resolved[0].blocked_by).toHaveLength(0);
    expect(resolved[0].blocks).toHaveLength(0);
  });

  it('handles fuzzy matches with sufficient evidence', () => {
    const docs = [
      {
        id: 'doc1',
        required_action: 'Complete Aadhaar Biometric Update',
        prerequisites: [],
        dependency_reason: 'No dependencies detected',
      },
      {
        id: 'doc2',
        required_action: 'Submit KYC Documents',
        prerequisites: ['Aadhaar Biometric Update'],
        dependency_reason: 'KYC requires Aadhaar biometric update as stated in notice',
      },
    ];

    const resolved = resolveDependencies(docs);
    expect(resolved[1].is_blocked).toBe(false);
    expect(resolved[1].is_fuzzy_only).toBe(true);
    expect(resolved[1].fuzzy_suggestions).toHaveLength(1);
    expect(resolved[1].fuzzy_suggestions[0].id).toBe('doc1');
    expect(resolved[1].fuzzy_suggestions[0]._dependency_confidence).toBe('low');
    expect(resolved[1].fuzzy_suggestions[0]._dependency_method).toBe('fuzzy');
  });
});

describe('buildPriorityList', () => {
  it('prioritizes unblocked tasks over blocked tasks', () => {
    const docs = [
      {
        id: 'doc1',
        required_action: 'Task 1',
        is_blocked: true,
        blocked_by: [],
        blocks: [],
        deadline_days: 5,
        confidence: 0.9,
      },
      {
        id: 'doc2',
        required_action: 'Task 2',
        is_blocked: false,
        blocked_by: [],
        blocks: [],
        deadline_days: 10,
        confidence: 0.9,
      },
    ];

    const sorted = buildPriorityList(docs);
    expect(sorted[0].id).toBe('doc2'); // unblocked comes first
    expect(sorted[1].id).toBe('doc1');
  });

  it('prioritizes tasks that unblock others', () => {
    const blocker = {
      id: 'doc1',
      required_action: 'Blocker',
      is_blocked: false,
      blocked_by: [],
      blocks: [{ id: 'doc2' }],
      deadline_days: 10,
      confidence: 0.9,
    };

    const blocked = {
      id: 'doc2',
      required_action: 'Blocked',
      is_blocked: false,
      blocked_by: [],
      blocks: [],
      deadline_days: 5,
      confidence: 0.9,
    };

    const sorted = buildPriorityList([blocked, blocker]);
    expect(sorted[0].id).toBe('doc1'); // blocker comes first despite later deadline
  });

  it('prioritizes earlier deadlines', () => {
    const docs = [
      {
        id: 'doc1',
        required_action: 'Task 1',
        is_blocked: false,
        blocked_by: [],
        blocks: [],
        deadline_days: 10,
        confidence: 0.9,
      },
      {
        id: 'doc2',
        required_action: 'Task 2',
        is_blocked: false,
        blocked_by: [],
        blocks: [],
        deadline_days: 3,
        confidence: 0.9,
      },
    ];

    const sorted = buildPriorityList(docs);
    expect(sorted[0].id).toBe('doc2'); // earlier deadline
  });

  it('handles null deadlines correctly', () => {
    const docs = [
      {
        id: 'doc1',
        required_action: 'Task 1',
        is_blocked: false,
        blocked_by: [],
        blocks: [],
        deadline_days: null,
        confidence: 0.9,
      },
      {
        id: 'doc2',
        required_action: 'Task 2',
        is_blocked: false,
        blocked_by: [],
        blocks: [],
        deadline_days: 5,
        confidence: 0.9,
      },
    ];

    const sorted = buildPriorityList(docs);
    expect(sorted[0].id).toBe('doc2'); // known deadline comes before unknown
    expect(sorted[1].id).toBe('doc1');
  });

  it('uses confidence as tie-breaker', () => {
    const docs = [
      {
        id: 'doc1',
        required_action: 'Task 1',
        is_blocked: false,
        blocked_by: [],
        blocks: [],
        deadline_days: 5,
        confidence: 0.7,
      },
      {
        id: 'doc2',
        required_action: 'Task 2',
        is_blocked: false,
        blocked_by: [],
        blocks: [],
        deadline_days: 5,
        confidence: 0.9,
      },
    ];

    const sorted = buildPriorityList(docs);
    expect(sorted[0].id).toBe('doc2'); // higher confidence
  });
});

  it('tracks dependency confidence and method', () => {
    const docs = [
      {
        id: 'doc1',
        required_action: 'Update Aadhaar',
        prerequisites: [],
        dependency_reason: 'No dependencies',
      },
      {
        id: 'doc2',
        required_action: 'Submit KYC',
        prerequisites: ['Update Aadhaar'],
        dependency_reason: 'KYC requires Aadhaar update',
      },
    ];

    const resolved = resolveDependencies(docs);
    expect(resolved[1].blocked_by).toHaveLength(1);
    expect(resolved[1].blocked_by[0]._dependency_confidence).toBe('high');
    expect(resolved[1].blocked_by[0]._dependency_method).toBe('exact');
  });

  it('handles multiple blockers correctly', () => {
    const docs = [
      {
        id: 'doc1',
        required_action: 'Task A',
        prerequisites: [],
        dependency_reason: 'No dependencies',
      },
      {
        id: 'doc2',
        required_action: 'Task B',
        prerequisites: [],
        dependency_reason: 'No dependencies',
      },
      {
        id: 'doc3',
        required_action: 'Task C',
        prerequisites: ['Task A', 'Task B'],
        dependency_reason: 'C requires both A and B',
      },
    ];

    const resolved = resolveDependencies(docs);
    
    // Task C should be blocked by both A and B
    expect(resolved[2].blocked_by).toHaveLength(2);
    expect(resolved[2].is_blocked).toBe(true);
    
    // Both A and B should block C
    expect(resolved[0].blocks).toHaveLength(1);
    expect(resolved[0].blocks[0].id).toBe('doc3');
    expect(resolved[1].blocks).toHaveLength(1);
    expect(resolved[1].blocks[0].id).toBe('doc3');
  });

  it('does not create uncertain dependencies for fuzzy-only matches', () => {
    const docs = [
      {
        id: 'doc1',
        required_action: 'Update personal details',
        prerequisites: [],
        dependency_reason: 'No dependencies',
      },
      {
        id: 'doc2',
        required_action: 'Submit form',
        prerequisites: ['Update something'],
        dependency_reason: 'Form requires some update', // Vague, shouldn't match
      },
    ];

    const resolved = resolveDependencies(docs);
    // 'Update something' is too vague, shouldn't match 'Update personal details'
    expect(resolved[1].blocked_by).toHaveLength(0);
  });

describe('tarjanSCC', () => {
  it('linear chain has no SCC > 1', () => {
    const nodes = ['A', 'B', 'C'];
    const edges = [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' },
    ];
    const sccs = tarjanSCC(nodes, edges);
    const multiNodeSccs = sccs.filter((scc) => scc.length > 1);
    expect(multiNodeSccs).toHaveLength(0);
  });

  it('2-cycle has SCC of 2', () => {
    const nodes = ['A', 'B'];
    const edges = [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'A' },
    ];
    const sccs = tarjanSCC(nodes, edges);
    const cycleScc = sccs.find((scc) => scc.length === 2);
    expect(cycleScc).toBeDefined();
    expect(cycleScc.sort()).toEqual(['A', 'B']);
  });
});

describe('Item 1.5 - Dependency engine and cycle detection', () => {
  it('A/B/C counter-example: A blocked by [B, C], B blocked by [A], C blocked by [A] -> all three flagged cycle_detected: true', () => {
    const docs = [
      {
        id: 'A',
        required_action: 'Action A',
        prerequisites: ['Action B', 'Action C'],
        dependency_reason: 'A needs B and C',
      },
      {
        id: 'B',
        required_action: 'Action B',
        prerequisites: ['Action A'],
        dependency_reason: 'B needs A',
      },
      {
        id: 'C',
        required_action: 'Action C',
        prerequisites: ['Action A'],
        dependency_reason: 'C needs A',
      },
    ];

    const resolved = resolveDependencies(docs);
    expect(resolved.find((d) => d.id === 'A').cycle_detected).toBe(true);
    expect(resolved.find((d) => d.id === 'B').cycle_detected).toBe(true);
    expect(resolved.find((d) => d.id === 'C').cycle_detected).toBe(true);
    expect(resolved.every((d) => d.cycle_path && d.cycle_path.length === 3)).toBe(true);
  });

  it('two docs with identical required_action: no self-edge', () => {
    const docs = [
      {
        id: 'doc1',
        required_action: 'Submit Application Form',
        prerequisites: ['Submit Application Form'],
        dependency_reason: 'Check self or other',
      },
      {
        id: 'doc2',
        required_action: 'Submit Application Form',
        prerequisites: [],
        dependency_reason: 'No dependencies',
      },
    ];

    const resolved = resolveDependencies(docs);
    const doc1 = resolved.find((d) => d.id === 'doc1');
    // doc1 depends on doc2, but should NOT depend on itself
    expect(doc1.blocked_by.some((b) => b.id === 'doc1')).toBe(false);
    expect(doc1.blocked_by.some((b) => b.id === 'doc2')).toBe(true);
  });

  it('skips fuzzy match if prerequisite is short (e.g. "Pay")', () => {
    const docs = [
      {
        id: 'doc1',
        required_action: 'Pay Outstanding Electricity Bill Now',
        prerequisites: [],
        dependency_reason: 'None',
      },
      {
        id: 'doc2',
        required_action: 'Submit New Connection Request',
        prerequisites: ['Pay'],
        dependency_reason: 'Needs to pay first',
      },
    ];

    const resolved = resolveDependencies(docs);
    const doc2 = resolved.find((d) => d.id === 'doc2');
    expect(doc2.blocked_by).toHaveLength(0);
    expect(doc2.fuzzy_suggestions || []).toHaveLength(0);
    expect(doc2.is_blocked).toBe(false);
  });

  it('supports Stage B model edges with high confidence', () => {
    const docs = [
      {
        id: 'doc1',
        required_action: 'Download Aadhaar e-KYC XML',
        prerequisites: [],
      },
      {
        id: 'doc2',
        required_action: 'Submit Demat Account Activation',
        prerequisites: [],
      },
    ];
    const stageBEdges = [
      {
        from_doc_id: 'doc2',
        depends_on_doc_id: 'doc1',
        reason: 'Demat activation explicitly requires Aadhaar XML proof',
      },
    ];

    const resolved = resolveDependencies(docs, stageBEdges);
    const doc2 = resolved.find((d) => d.id === 'doc2');
    expect(doc2.is_blocked).toBe(true);
    expect(doc2.blocked_by).toHaveLength(1);
    expect(doc2.blocked_by[0].id).toBe('doc1');
    expect(doc2.blocked_by[0]._dependency_confidence).toBe('high');
    expect(doc2.blocked_by[0]._dependency_method).toBe('model');
  });
});

describe('Item 1.6 - Priority ordering and urgency propagation', () => {
  it('propagateUrgency: blocker inherits dependent earlier deadline and negative overdue propagates', () => {
    const docs = [
      { id: 'docZ', deadline_days: 20, blocks: [{ id: 'docA' }], cycle_detected: false },
      { id: 'docA', deadline_days: 15, blocks: [{ id: 'docB' }], cycle_detected: false },
      { id: 'docB', deadline_days: 2, blocks: [], cycle_detected: false },
    ];
    const map = propagateUrgency(docs);
    expect(map.get('docB')).toBe(2);
    expect(map.get('docA')).toBe(2);
    expect(map.get('docZ')).toBe(2);

    const docsWithOverdue = [
      { id: 'docZ', deadline_days: 10, blocks: [{ id: 'docA' }], cycle_detected: false },
      { id: 'docA', deadline_days: -3, blocks: [], cycle_detected: false },
    ];
    const mapOverdue = propagateUrgency(docsWithOverdue);
    expect(mapOverdue.get('docA')).toBe(-3);
    expect(mapOverdue.get('docZ')).toBe(-3);
  });

  it('overdue item (deadline_days=-3) ranks #1 even when there is a non-overdue item with no blockers', () => {
    const docs = [
      {
        id: 'doc1',
        doc_index: 0,
        required_action: 'Routine Check',
        is_blocked: false,
        blocked_by: [],
        blocks: [],
        deadline_days: 5,
        confidence: 0.95,
      },
      {
        id: 'doc2',
        doc_index: 1,
        required_action: 'Tax Demands Response',
        is_blocked: false,
        blocked_by: [],
        blocks: [],
        deadline_days: -3,
        confidence: 0.8,
      },
    ];

    const prioritized = buildPriorityList(docs);
    expect(prioritized[0].id).toBe('doc2');
    expect(prioritized[0].priority_rank).toBe(1);
    expect(prioritized[0].status).toBe('overdue');
    expect(prioritized[1].id).toBe('doc1');
    expect(prioritized[1].priority_rank).toBe(2);
  });

  it('chain Z -> A -> B: output order Z, A, B regardless of input order', () => {
    const docZ = {
      id: 'Z',
      doc_index: 0,
      required_action: 'Step 1: Obtain Certificate',
      is_blocked: false,
      blocked_by: [],
      blocks: [{ id: 'A' }],
      deadline_days: 30,
    };
    const docA = {
      id: 'A',
      doc_index: 1,
      required_action: 'Step 2: Submit Verification',
      is_blocked: true,
      blocked_by: [{ id: 'Z' }],
      blocks: [{ id: 'B' }],
      deadline_days: 20,
    };
    const docB = {
      id: 'B',
      doc_index: 2,
      required_action: 'Step 3: Collect Final Permit',
      is_blocked: true,
      blocked_by: [{ id: 'A' }],
      blocks: [],
      deadline_days: 10,
    };

    // Shuffled input order [B, Z, A]
    const prioritized = buildPriorityList([docB, docZ, docA]);
    expect(prioritized.map((d) => d.id)).toEqual(['Z', 'A', 'B']);
    expect(prioritized[0].priority_rank).toBe(1);
    expect(prioritized[1].priority_rank).toBe(2);
    expect(prioritized[2].priority_rank).toBe(3);
  });

  it('blocker inherits dependent earlier deadline via propagateUrgency', () => {
    // Blocker doc1 has distant deadline (30) but blocks doc2 which is due in 2 days.
    // Independent doc3 is due in 10 days.
    const doc1 = {
      id: 'doc1',
      doc_index: 0,
      required_action: 'Authorize Delegate',
      is_blocked: false,
      blocked_by: [],
      blocks: [{ id: 'doc2' }],
      deadline_days: 30,
    };
    const doc2 = {
      id: 'doc2',
      doc_index: 1,
      required_action: 'File Compliance Form',
      is_blocked: true,
      blocked_by: [{ id: 'doc1' }],
      blocks: [],
      deadline_days: 2,
    };
    const doc3 = {
      id: 'doc3',
      doc_index: 2,
      required_action: 'Review Guidelines',
      is_blocked: false,
      blocked_by: [],
      blocks: [],
      deadline_days: 10,
    };

    const prioritized = buildPriorityList([doc3, doc1, doc2]);
    // doc1 effective deadline is 2, while doc3 deadline is 10.
    // doc1 must come before doc3!
    expect(prioritized[0].id).toBe('doc1');
    expect(prioritized[0].effective_deadline_days).toBe(2);
  });

  it('cycle members appear last, all flagged cycle_detected', () => {
    const cycle1 = {
      id: 'c1',
      doc_index: 0,
      required_action: 'Task 1',
      is_blocked: true,
      blocked_by: [{ id: 'c2' }],
      blocks: [{ id: 'c2' }],
      cycle_detected: true,
      deadline_days: 1,
    };
    const cycle2 = {
      id: 'c2',
      doc_index: 1,
      required_action: 'Task 2',
      is_blocked: true,
      blocked_by: [{ id: 'c1' }],
      blocks: [{ id: 'c1' }],
      cycle_detected: true,
      deadline_days: 2,
    };
    const readyDoc = {
      id: 'ready1',
      doc_index: 2,
      required_action: 'Independent Task',
      is_blocked: false,
      blocked_by: [],
      blocks: [],
      deadline_days: 15,
      cycle_detected: false,
    };

    const prioritized = buildPriorityList([cycle1, readyDoc, cycle2]);
    expect(prioritized[0].id).toBe('ready1');
    expect(prioritized[0].status).toBe('ready');

    const lastTwo = prioritized.slice(1);
    expect(lastTwo.every((d) => d.cycle_detected)).toBe(true);
    expect(lastTwo.every((d) => d.status === 'cycle')).toBe(true);
  });

  it('stable ordering for ties uses original doc_index', () => {
    const docA = {
      id: 'docA',
      doc_index: 0,
      required_action: 'Action A',
      is_blocked: false,
      blocked_by: [],
      blocks: [],
      deadline_days: 10,
      confidence: 0.9,
    };
    const docB = {
      id: 'docB',
      doc_index: 1,
      required_action: 'Action B',
      is_blocked: false,
      blocked_by: [],
      blocks: [],
      deadline_days: 10,
      confidence: 0.9,
    };

    // Passed in reverse order [docB, docA]
    const prioritized = buildPriorityList([docB, docA]);
    expect(prioritized[0].id).toBe('docA');
    expect(prioritized[1].id).toBe('docB');
  });

  it('assigns correct status values based on deadline and block state', () => {
    const docs = [
      { id: 'd1', doc_index: 0, required_action: 'A', is_blocked: false, deadline_days: -2 },
      { id: 'd2', doc_index: 1, required_action: 'B', is_blocked: false, deadline_days: 1 },
      { id: 'd3', doc_index: 2, required_action: 'C', is_blocked: false, deadline_days: 10 },
      { id: 'd4', doc_index: 3, required_action: 'D', is_blocked: true, blocked_by: [{ id: 'd3' }], deadline_days: 8 },
      { id: 'd5', doc_index: 4, required_action: 'E', cycle_detected: true, deadline_days: 5 },
    ];

    const prioritized = buildPriorityList(docs);
    const byId = Object.fromEntries(prioritized.map((d) => [d.id, d.status]));
    expect(byId['d1']).toBe('overdue');
    expect(byId['d2']).toBe('urgent');
    expect(byId['d3']).toBe('ready');
    expect(byId['d4']).toBe('blocked');
    expect(byId['d5']).toBe('cycle');
  });
});

describe('Item 1.7 - Workflow summary and reasoning steps', () => {
  it('buildWorkflowSummary returns accurate stats without fabricated defaults', () => {
    const prioritized = [
      {
        id: '1',
        is_blocked: false,
        blocked_by: [],
        estimated_time_minutes: 20,
      },
      {
        id: '2',
        is_blocked: true,
        blocked_by: [{ id: '1', _dependency_confidence: 'high' }],
        estimated_time_minutes: 30,
      },
      {
        id: '3',
        is_blocked: true,
        blocked_by: [{ id: '1', _dependency_confidence: 'high' }, { id: '2', _dependency_confidence: 'high' }],
        estimated_time_minutes: null,
      },
    ];

    const summary = buildWorkflowSummary(prioritized, 4);
    expect(summary.documents).toBe(4);
    expect(summary.actions).toBe(3);
    expect(summary.dependencies).toBe(3); // 1 + 2 = 3 high-confidence edges
    expect(summary.blocked).toBe(2);
    expect(summary.estimated_minutes).toBe(50);
  });

  it('buildWorkflowSummary returns estimated_minutes null when no item has estimated_time_minutes', () => {
    const prioritized = [
      {
        id: '1',
        is_blocked: false,
        blocked_by: [],
        estimated_time_minutes: null,
      },
      {
        id: '2',
        is_blocked: false,
        blocked_by: [],
      },
    ];

    const summary = buildWorkflowSummary(prioritized, 2);
    expect(summary.estimated_minutes).toBeNull();
  });

  it('generateReasoningSteps uses item.priority_reason in recommended step', () => {
    const prioritized = [
      {
        id: '1',
        required_action: 'Pay Overdue Fine',
        priority_reason: 'OVERDUE by 5 days. Must be paid immediately.',
        is_blocked: false,
        blocked_by: [],
        blocks: [],
      },
    ];

    const steps = generateReasoningSteps(prioritized);
    const recommendStep = steps.find((s) => s.label === 'Recommended Next Action');
    expect(recommendStep).toBeDefined();
    expect(recommendStep.detail).toBe('Pay Overdue Fine — OVERDUE by 5 days. Must be paid immediately.');
  });
});
