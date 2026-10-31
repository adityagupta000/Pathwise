import { describe, it, expect } from 'vitest';
import { resolveDependencies, buildPriorityList, tarjanSCC } from './engines.js';

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
