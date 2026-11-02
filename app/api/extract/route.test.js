import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route.js';
import * as sarvam from '@/lib/sarvam';

vi.mock('@/lib/sarvam', async () => {
  const actual = await vi.importActual('@/lib/sarvam');
  return {
    ...actual,
    extractStructured: vi.fn(),
  };
});

describe('POST /api/extract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeMockRequest(docMetas) {
    const formData = new FormData();
    formData.append('documents', JSON.stringify(docMetas));
    docMetas.forEach((meta, idx) => {
      formData.append(
        `file_${idx}`,
        new Blob([meta.text || 'Sample document content for verification'], { type: 'text/plain' }),
        meta.fileName
      );
    });
    return new Request('http://localhost:3000/api/extract', {
      method: 'POST',
      body: formData,
    });
  }

  it('returns UPSTREAM_TIMEOUT without retrying when the overall deadline expires', async () => {
    const timeoutSignal = AbortSignal.abort(new DOMException('t', 'TimeoutError'));
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutSignal);
    let upstreamCalls = 0;
    sarvam.extractStructured.mockImplementation(async ({ signal }) => {
      upstreamCalls++;
      throw signal.reason;
    });

    const res = await POST(makeMockRequest([
      { fileName: 'timeout.txt', fileType: 'text', text: 'Timeout test content' },
    ]));
    const data = await res.json();

    expect(res.status).toBe(504);
    expect(data.error.code).toBe('UPSTREAM_TIMEOUT');
    expect(data.error.message).toBe('The analysis took too long. Try fewer or shorter documents.');
    expect(upstreamCalls).toBe(1);
    timeoutSpy.mockRestore();
  });

  it('3 docs -> 3 Stage A calls, 3 results with correct doc_index/file_name even if mock answers out of order', async () => {
    const metas = [
      { fileName: 'docA.txt', fileType: 'text', text: 'Content of document A' },
      { fileName: 'docB.txt', fileType: 'text', text: 'Content of document B' },
      { fileName: 'docC.txt', fileType: 'text', text: 'Content of document C' },
    ];

    // Simulate out-of-order responses using delays
    sarvam.extractStructured.mockImplementation(async ({ userMessage, schema }) => {
      if (schema.name === 'stage_b_relationships') {
        return { edges: [], conflicts: [] };
      }
      if (userMessage.includes('docA.txt') || userMessage.includes('document A')) {
        await new Promise((r) => setTimeout(r, 30));
        return {
          document_type: 'Notice A',
          organization: 'Org A',
          government_department: null,
          title: 'Title A',
          required_action: 'Action A',
          required_documents: [],
          prerequisites: [],
          deadline_text: null,
          deadline_date: '2026-11-10',
          deadline_relative_days: null,
          deadline_relative_anchor: null,
          appointment_date: null,
          appointment_time: null,
          office_location: null,
          estimated_time_minutes: 10,
          fees: null,
          reference_number: null,
          consequence: null,
          confidence: 0.9,
          source_page: 1,
          evidence_snippet: 'Content of document A',
          information_type: 'explicitly_stated',
        };
      }
      if (userMessage.includes('docB.txt') || userMessage.includes('document B')) {
        await new Promise((r) => setTimeout(r, 10));
        return {
          document_type: 'Notice B',
          organization: 'Org B',
          government_department: null,
          title: 'Title B',
          required_action: 'Action B',
          required_documents: [],
          prerequisites: [],
          deadline_text: null,
          deadline_date: '2026-11-15',
          deadline_relative_days: null,
          deadline_relative_anchor: null,
          appointment_date: null,
          appointment_time: null,
          office_location: null,
          estimated_time_minutes: 15,
          fees: null,
          reference_number: null,
          consequence: null,
          confidence: 0.85,
          source_page: 1,
          evidence_snippet: 'Content of document B',
          information_type: 'explicitly_stated',
        };
      }
      return {
        document_type: 'Notice C',
        organization: 'Org C',
        government_department: null,
        title: 'Title C',
        required_action: 'Action C',
        required_documents: [],
        prerequisites: [],
        deadline_text: null,
        deadline_date: null,
        deadline_relative_days: null,
        deadline_relative_anchor: null,
        appointment_date: null,
        appointment_time: null,
        office_location: null,
        estimated_time_minutes: null,
        fees: null,
        reference_number: null,
        consequence: null,
        confidence: 0.8,
        source_page: 1,
        evidence_snippet: 'Content of document C',
        information_type: 'explicitly_stated',
      };
    });

    const req = makeMockRequest(metas);
    const res = await POST(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.extractions).toHaveLength(3);
    expect(data.extractions[0].doc_index).toBe(0);
    expect(data.extractions[0].file_name).toBe('docA.txt');
    expect(data.extractions[1].doc_index).toBe(1);
    expect(data.extractions[1].file_name).toBe('docB.txt');
    expect(data.extractions[2].doc_index).toBe(2);
    expect(data.extractions[2].file_name).toBe('docC.txt');
    expect(data.analysis_id).toBeDefined();
    expect(data.plan).toHaveLength(3);
  });

  it('1 of 3 Stage A calls throws -> 2 results + 1 in failures, request still 200', async () => {
    const metas = [
      { fileName: 'doc1.txt', fileType: 'text', text: 'Document 1 content' },
      { fileName: 'doc2.txt', fileType: 'text', text: 'Document 2 content' },
      { fileName: 'doc3.txt', fileType: 'text', text: 'Document 3 content' },
    ];

    sarvam.extractStructured.mockImplementation(async ({ userMessage, schema }) => {
      if (schema.name === 'stage_b_relationships') {
        return { edges: [], conflicts: [] };
      }
      if (userMessage.includes('doc2.txt') || userMessage.includes('Document 2')) {
        throw new Error('LLM rate limit or parse error on doc2');
      }
      return {
        document_type: 'Notice',
        organization: 'Dept',
        government_department: null,
        title: 'Valid Document',
        required_action: 'Complete Task',
        required_documents: [],
        prerequisites: [],
        deadline_text: null,
        deadline_date: null,
        deadline_relative_days: null,
        deadline_relative_anchor: null,
        appointment_date: null,
        appointment_time: null,
        office_location: null,
        estimated_time_minutes: 10,
        fees: null,
        reference_number: null,
        consequence: null,
        confidence: 0.9,
        source_page: 1,
        evidence_snippet: 'Document 1 content',
        information_type: 'explicitly_stated',
      };
    });

    const req = makeMockRequest(metas);
    const res = await POST(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.extractions).toHaveLength(2);
    expect(data.failures).toHaveLength(1);
    expect(data.failures[0].file_name).toBe('doc2.txt');
    expect(data.failures[0].code).toBe('EXTRACTION_FAILED');
  });

  it('Stage B returns unknown id -> edge dropped + warning', async () => {
    const metas = [
      { fileName: 'doc1.txt', fileType: 'text', text: 'Valid doc 1 text' },
      { fileName: 'doc2.txt', fileType: 'text', text: 'Valid doc 2 text' },
    ];

    sarvam.extractStructured.mockImplementation(async ({ schema }) => {
      if (schema.name === 'stage_b_relationships') {
        return {
          edges: [
            {
              from_doc_id: 'doc2',
              depends_on_doc_id: 'non_existent_doc_id',
              reason: 'Needs unknown document',
              evidence_quote: null,
              evidence_doc_id: null,
            },
          ],
          conflicts: [],
        };
      }
      return {
        document_type: 'Notice',
        organization: 'Dept',
        government_department: null,
        title: 'Doc',
        required_action: 'Action',
        required_documents: [],
        prerequisites: [],
        deadline_text: null,
        deadline_date: null,
        deadline_relative_days: null,
        deadline_relative_anchor: null,
        appointment_date: null,
        appointment_time: null,
        office_location: null,
        estimated_time_minutes: null,
        fees: null,
        reference_number: null,
        consequence: null,
        confidence: 0.9,
        source_page: 1,
        evidence_snippet: 'Valid doc 1 text',
        information_type: 'explicitly_stated',
      };
    });

    const req = makeMockRequest(metas);
    const res = await POST(req);
    const data = await res.json();

    expect(data.dependencies).toHaveLength(0);
    expect(data.warnings.some((w) => w.type === 'invalid_dependency_edge')).toBe(true);
  });

  it('Stage B returns self-edge -> edge dropped', async () => {
    const metas = [
      { fileName: 'doc1.txt', fileType: 'text', text: 'Doc 1 text' },
      { fileName: 'doc2.txt', fileType: 'text', text: 'Doc 2 text' },
    ];

    sarvam.extractStructured.mockImplementation(async ({ schema }) => {
      if (schema.name === 'stage_b_relationships') {
        return {
          edges: [
            {
              from_doc_id: 'doc1',
              depends_on_doc_id: 'doc1',
              reason: 'Self dependency',
              evidence_quote: null,
              evidence_doc_id: null,
            },
          ],
          conflicts: [],
        };
      }
      return {
        document_type: 'Notice',
        organization: null,
        government_department: null,
        title: 'Doc',
        required_action: 'Action',
        required_documents: [],
        prerequisites: [],
        deadline_text: null,
        deadline_date: null,
        deadline_relative_days: null,
        deadline_relative_anchor: null,
        appointment_date: null,
        appointment_time: null,
        office_location: null,
        estimated_time_minutes: null,
        fees: null,
        reference_number: null,
        consequence: null,
        confidence: 0.9,
        source_page: 1,
        evidence_snippet: 'Doc 1 text',
        information_type: 'explicitly_stated',
      };
    });

    const req = makeMockRequest(metas);
    const res = await POST(req);
    const data = await res.json();

    expect(data.dependencies).toHaveLength(0);
  });

  it('Stage B returns edge whose evidence_quote not in doc -> edge dropped, warning emitted', async () => {
    const metas = [
      { fileName: 'doc1.txt', fileType: 'text', text: 'Official letter from tax authority' },
      { fileName: 'doc2.txt', fileType: 'text', text: 'Bank statement verification document' },
    ];

    sarvam.extractStructured.mockImplementation(async ({ schema }) => {
      if (schema.name === 'stage_b_relationships') {
        return {
          edges: [
            {
              from_doc_id: 'doc2',
              depends_on_doc_id: 'doc1',
              reason: 'Requires tax letter',
              evidence_quote: 'Completely made up quote that does not appear anywhere in doc text',
              evidence_doc_id: 'doc2',
            },
          ],
          conflicts: [],
        };
      }
      return {
        document_type: 'Notice',
        organization: null,
        government_department: null,
        title: 'Doc',
        required_action: 'Action',
        required_documents: [],
        prerequisites: [],
        deadline_text: null,
        deadline_date: null,
        deadline_relative_days: null,
        deadline_relative_anchor: null,
        appointment_date: null,
        appointment_time: null,
        office_location: null,
        estimated_time_minutes: null,
        fees: null,
        reference_number: null,
        consequence: null,
        confidence: 0.9,
        source_page: 1,
        evidence_snippet: 'Official letter from tax authority',
        information_type: 'explicitly_stated',
      };
    });

    const req = makeMockRequest(metas);
    const res = await POST(req);
    const data = await res.json();

    expect(data.dependencies).toHaveLength(0);
    expect(data.warnings.some((w) => w.type === 'unverified_dependency_evidence')).toBe(true);
  });

  it('does not make a dependency blocking when its quote exists only in the prerequisite document', async () => {
    const metas = [
      { fileName: 'tax.txt', fileType: 'text', text: 'Tax letter must be attached to the bank request.' },
      { fileName: 'bank.txt', fileType: 'text', text: 'Submit the bank request.' },
    ];

    sarvam.extractStructured.mockImplementation(async ({ schema }) => {
      if (schema.name === 'stage_b_relationships') {
        return {
          edges: [{
            from_doc_id: 'doc2',
            depends_on_doc_id: 'doc1',
            reason: 'Bank request needs tax letter',
            evidence_quote: 'Tax letter must be attached to the bank request',
            evidence_doc_id: 'doc1',
          }],
          conflicts: [],
        };
      }
      return {
        document_type: 'Notice',
        organization: null,
        government_department: null,
        title: 'Notice',
        required_action: 'Complete request',
        required_documents: [],
        prerequisites: [],
        deadline_text: null,
        deadline_date: null,
        deadline_relative_days: null,
        deadline_relative_anchor: null,
        appointment_date: null,
        appointment_time: null,
        office_location: null,
        estimated_time_minutes: null,
        fees: null,
        reference_number: null,
        consequence: null,
        confidence: 0.9,
        source_page: 1,
        evidence_snippet: 'Complete request',
        information_type: 'explicitly_stated',
      };
    });

    const data = await (await POST(makeMockRequest(metas))).json();
    expect(data.dependencies).toHaveLength(0);
    expect(data.warnings.some((w) => w.type === 'unverified_dependency_evidence')).toBe(true);
  });

  it('Stage B fails twice -> dependency_analysis_failed warning, rest of response populated', async () => {
    const metas = [
      { fileName: 'doc1.txt', fileType: 'text', text: 'Doc 1 text' },
      { fileName: 'doc2.txt', fileType: 'text', text: 'Doc 2 text' },
    ];

    sarvam.extractStructured.mockImplementation(async ({ schema }) => {
      if (schema.name === 'stage_b_relationships') {
        throw new Error('Stage B LLM timeout');
      }
      return {
        document_type: 'Notice',
        organization: null,
        government_department: null,
        title: 'Doc',
        required_action: 'Action',
        required_documents: [],
        prerequisites: [],
        deadline_text: null,
        deadline_date: null,
        deadline_relative_days: null,
        deadline_relative_anchor: null,
        appointment_date: null,
        appointment_time: null,
        office_location: null,
        estimated_time_minutes: null,
        fees: null,
        reference_number: null,
        consequence: null,
        confidence: 0.9,
        source_page: 1,
        evidence_snippet: 'Doc 1 text',
        information_type: 'explicitly_stated',
      };
    });

    const req = makeMockRequest(metas);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.extractions).toHaveLength(2);
    expect(data.dependencies).toEqual([]);
    expect(data.warnings.some((w) => w.type === 'dependency_analysis_failed')).toBe(true);
    expect(data.plan).toBeDefined();
    expect(data.summary).toBeDefined();
  });

  it('All docs fail Stage A -> 502 EXTRACTION_INVALID error', async () => {
    const metas = [
      { fileName: 'doc1.txt', fileType: 'text', text: 'Doc 1 text' },
    ];

    sarvam.extractStructured.mockRejectedValue(new Error('Persistent API failure'));

    const req = makeMockRequest(metas);
    const res = await POST(req);
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error.code).toBe('EXTRACTION_INVALID');
  });
});
