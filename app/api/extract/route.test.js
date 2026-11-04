import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route.js';
import * as sarvam from '@/lib/sarvam';
import { readPdfTextLayer } from '@/lib/pdfText';
import { _resetBuckets, _resetExtractSlots } from '@/lib/limiter';
import { env } from '@/lib/env';
import { kycNotice } from '@/lib/test-fixtures/extraction-quality';

vi.mock('@/lib/pdfText', () => ({
  readPdfTextLayer: vi.fn(),
}));

vi.mock('@/lib/sarvam', async () => {
  const actual = await vi.importActual('@/lib/sarvam');
  return {
    ...actual,
    parseDocument: vi.fn(),
    extractStructured: vi.fn(),
  };
});

describe('POST /api/extract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetBuckets();
    _resetExtractSlots();
    env.TRUSTED_PROXY_HOPS = 0;
    env.SARVAM_REASONING_EFFORT = undefined;
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

  function stageAResult(overrides = {}) {
    return {
      document_type: 'Notice',
      organization: null,
      title: 'Title',
      required_action: 'Complete task',
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
      source_page: null,
      evidence_snippet: 'Stage A source text',
      field_evidence: [],
      conditional_requirements: [],
      deadline_context: 'active',
      information_type: 'explicitly_stated',
      ...overrides,
    };
  }

  it('accepts documents without fileType', async () => {
    sarvam.extractStructured.mockResolvedValue(stageAResult());
    const res = await POST(makeMockRequest([{ fileName: 'default.txt', text: 'Stage A source text' }]));
    expect(res.status).toBe(200);
  });

  it('assigns stable IDs to duplicate file names', async () => {
    sarvam.extractStructured.mockResolvedValue(stageAResult());
    const res = await POST(makeMockRequest([
      { fileName: 'same.txt', fileType: 'text', text: 'first source' },
      { fileName: 'same.txt', fileType: 'text', text: 'second source' },
    ]));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.extractions.map((item) => item.id)).toEqual(['doc1', 'doc2']);
  });

  it('rejects an oversized Content-Length before parsing multipart data', async () => {
    const res = await POST(new Request('http://localhost:3000/api/extract', {
      method: 'POST',
      headers: { 'content-length': String(70 * 1024 * 1024) },
      body: 'not multipart',
    }));
    expect(res.status).toBe(413);
  });

  it('returns 429 with Retry-After on the 11th trusted-IP request', async () => {
    env.TRUSTED_PROXY_HOPS = 1;
    sarvam.extractStructured.mockResolvedValue(stageAResult());
    const requests = Array.from({ length: 11 }, () => new Request('http://localhost:3000/api/extract', {
      method: 'POST',
      headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' },
      body: (() => {
        const form = new FormData();
        form.append('documents', JSON.stringify([{ fileName: 'rate.txt', fileType: 'text', text: 'source' }]));
        return form;
      })(),
    }));
    const responses = [];
    for (const request of requests) responses.push(await POST(request));
    expect(responses[10].status).toBe(429);
    expect(responses[10].headers.get('Retry-After')).toBeTruthy();
  });

  it('keeps the other documents verifiable when the first document is corrupt', async () => {
    const metas = [
      { fileName: 'broken.txt', fileType: 'text', text: 'broken source' },
      { fileName: 'valid-2.txt', fileType: 'text', text: 'valid source two' },
      { fileName: 'valid-3.txt', fileType: 'text', text: 'valid source three' },
    ];
    sarvam.extractStructured.mockImplementation(async ({ userMessage, schema }) => {
      if (schema.name === 'stage_b_relationships') return { edges: [], conflicts: [] };
      if (userMessage.includes('broken.txt')) throw new Error('corrupt document');
      const source = userMessage.includes('valid-2.txt') ? 'valid source two' : 'valid source three';
      return stageAResult({ evidence_snippet: source });
    });

    const res = await POST(makeMockRequest(metas));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.failures[0].file_name).toBe('broken.txt');
    expect(data.extractions).toHaveLength(2);
    expect(data.extractions.every((item) => item.verification_status !== 'unverified')).toBe(true);
  });

  it('reports an image with mismatched PDF bytes as an unsupported file', async () => {
    const formData = new FormData();
    formData.append('documents', JSON.stringify([
      { fileName: 'declared.png', fileType: 'image', text: '' },
      { fileName: 'valid.txt', fileType: 'text', text: 'Stage A source text' },
    ]));
    formData.append('file_0', new Blob(['%PDF-1.7'], { type: 'application/pdf' }), 'declared.png');
    formData.append('file_1', new Blob(['Stage A source text'], { type: 'text/plain' }), 'valid.txt');
    sarvam.extractStructured.mockResolvedValue(stageAResult());

    const res = await POST(new Request('http://localhost:3000/api/extract', {
      method: 'POST',
      body: formData,
    }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.failures[0].code).toBe('UNSUPPORTED_TYPE');
    expect(sarvam.extractStructured).toHaveBeenCalledTimes(1);
  });

  it('reproduces a tracking result with no stated action being planned as ready', async () => {
    const sourceText = 'Article tracking result. Item status: Delivered. No further action stated.';
    readPdfTextLayer.mockResolvedValue({
      pages: 1,
      hasTextLayer: true,
      text: `--- Page 1 ---\n${sourceText}`,
    });
    sarvam.extractStructured.mockResolvedValue(stageAResult({
      document_type: 'Article Tracking Result',
      title: 'Article tracking result',
      required_action: 'None stated',
      information_type: 'uncertain',
      source_page: 1,
      evidence_snippet: 'Item status: Delivered.',
    }));

    const formData = new FormData();
    formData.append('documents', JSON.stringify([
      { fileName: 'tracking-result.pdf', fileType: 'pdf', text: '' },
    ]));
    formData.append('file_0', new Blob(['%PDF-1.7'], { type: 'application/pdf' }), 'tracking-result.pdf');
    const res = await POST(new Request('http://localhost:3000/api/extract', {
      method: 'POST',
      body: formData,
    }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.extractions[0]).toMatchObject({
      document_type: 'Article Tracking Result',
      required_action: 'None stated',
      information_type: 'uncertain',
    });
    expect(data.plan).toHaveLength(1);
    expect(data.plan[0]).toMatchObject({
      required_action: 'None stated',
      status: 'ready',
    });
  });

  it('preserves a historical conditional KYC date without treating it as a current overdue task', async () => {
    sarvam.parseDocument.mockResolvedValue({ text: kycNotice.text, pages: 1, partial: false });
    sarvam.extractStructured.mockResolvedValue(stageAResult({
      document_type: 'KYC Public Notice',
      required_action: 'Submit updated profile details and proof.',
      required_documents: ['Identity or address proof'],
      deadline_text: 'from 01.04.2022',
      deadline_date: '2022-04-01',
      deadline_context: 'historical',
      consequence: 'Debit transactions will be restricted.',
      conditional_requirements: [{
        effect: 'requirement',
        applies_to_fields: ['consequence'],
        required_action: null,
        condition: 'If an account remains pending',
        applies_to: 'Accounts with pending profiles',
        deadline_text: 'from 01.04.2022',
        deadline_date: '2022-04-01',
        consequence: 'Debit transactions will be restricted',
        source_page: 1,
        evidence_quote: 'If an account remains pending, debit transactions will be restricted from 01.04.2022.',
      }],
      field_evidence: [
        { field: 'required_action', value: 'Submit updated profile details and proof.', quote: 'Customers must submit updated profile details, mobile number, income and occupation details, and identity or address proof to their home branch immediately.', source_page: 1 },
        { field: 'required_documents', value: 'Identity or address proof', quote: 'identity or address proof to their home branch immediately.', source_page: 1 },
        { field: 'deadline', value: 'from 01.04.2022', quote: 'debit transactions will be restricted from 01.04.2022.', source_page: 1 },
        { field: 'conditional_trigger', value: 'If an account remains pending', quote: 'If an account remains pending, debit transactions will be restricted from 01.04.2022.', source_page: 1 },
        { field: 'consequence', value: 'Debit transactions will be restricted.', quote: 'debit transactions will be restricted from 01.04.2022.', source_page: 1 },
      ],
      source_page: 1,
      evidence_snippet: 'If an account remains pending, debit transactions will be restricted from 01.04.2022.',
      information_type: 'uncertain',
    }));

    const formData = new FormData();
    formData.append('documents', JSON.stringify([
      { fileName: 'kyc-public-notice.png', fileType: 'image', text: '' },
    ]));
    formData.append('file_0', new Blob([
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ], { type: 'image/png' }), 'kyc-public-notice.png');
    const res = await POST(new Request('http://localhost:3000/api/extract', {
      method: 'POST',
      body: formData,
    }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.extractions[0]).toMatchObject({
      deadline_text: 'from 01.04.2022',
      deadline_date: '2022-04-01',
      deadline_context: 'historical',
      deadline_status: 'historical',
      deadline_days: null,
      information_type: 'uncertain',
      verification_status: 'verified',
      validation_status: {
        evidence_valid: true,
      },
    });
    expect(data.plan[0]).toMatchObject({
      required_action: 'Submit updated profile details and proof.',
      status: 'ready',
    });
    expect(data.plan).toHaveLength(1);
    expect(new Set(data.plan.map((item) => item.required_action)).size).toBe(1);
    expect(data.plan[0].conditional_requirements[0].verification_status).toBe('verified');
  });

  it('rejects scanned PDFs over the OCR page limit without calling OCR', async () => {
    readPdfTextLayer.mockResolvedValue({ pages: 12, hasTextLayer: false, text: '' });
    const formData = new FormData();
    formData.append('documents', JSON.stringify([
      { fileName: 'scanned.pdf', fileType: 'pdf', text: 'placeholder' },
    ]));
    formData.append('file_0', new Blob(['%PDF-1.7'], { type: 'application/pdf' }), 'scanned.pdf');

    const res = await POST(new Request('http://localhost:3000/api/extract', {
      method: 'POST',
      body: formData,
    }));
    const data = await res.json();

    expect(res.status).toBe(422);
    expect(data.error.code).toBe('NO_READABLE_DOCUMENTS');
    expect(data.error.failures[0].code).toBe('PAGE_LIMIT');
    expect(sarvam.parseDocument).not.toHaveBeenCalled();
  });

  it('logs sanitized OCR failure diagnostics without exposing secrets or document contents', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const documentContent = ['Sensitive', 'document', 'content'].join(' ');
    readPdfTextLayer.mockResolvedValue({ pages: 1, hasTextLayer: false, text: '' });
    sarvam.parseDocument.mockRejectedValue(
      new sarvam.SarvamError(
        'OCR failed; authorization: Bearer super-secret-token; body: Sensitive document content',
        503
      )
    );
    const formData = new FormData();
    formData.append('documents', JSON.stringify([
      { fileName: 'post.pdf', fileType: 'pdf', text: documentContent },
    ]));
    formData.append('file_0', new Blob(['%PDF-1.7'], { type: 'application/pdf' }), 'post.pdf');

    const res = await POST(new Request('http://localhost:3000/api/extract', {
      method: 'POST',
      body: formData,
    }));
    const data = await res.json();
    const diagnostic = errorSpy.mock.calls
      .map(([message]) => {
        try {
          return JSON.parse(message);
        } catch {
          return null;
        }
      })
      .find((entry) => entry?.error_code === 'OCR_FAILED');

    expect(res.status).toBe(422);
    expect(data.error.code).toBe('NO_READABLE_DOCUMENTS');
    expect(diagnostic).toMatchObject({
      request_id: data.error.request_id,
      file_name: 'post.pdf',
      error_name: 'SarvamError',
      error_code: 'OCR_FAILED',
      upstream_status: 503,
    });
    expect(diagnostic.description).toContain('OCR failed');
    expect(diagnostic.description).not.toContain(documentContent);
    errorSpy.mockRestore();
  });

  it('logs rejected OCR download hostnames without logging the download URL', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const host = ['downloads', 'example.test'].join('.');
    const downloadUrl = `https://${host}/output.zip?token=signed-secret`;
    readPdfTextLayer.mockResolvedValue({ pages: 1, hasTextLayer: false, text: '' });
    sarvam.parseDocument.mockRejectedValue(
      new sarvam.SarvamError(`Download URL host is not trusted: ${host}.`, 502)
    );
    const formData = new FormData();
    formData.append('documents', JSON.stringify([
      { fileName: 'post.pdf', fileType: 'pdf', text: '' },
    ]));
    formData.append('file_0', new Blob(['%PDF-1.7'], { type: 'application/pdf' }), 'post.pdf');

    const res = await POST(new Request('http://localhost:3000/api/extract', {
      method: 'POST',
      body: formData,
    }));
    const data = await res.json();
    const logText = errorSpy.mock.calls.map(([message]) => String(message)).join('\n');

    expect(res.status).toBe(422);
    expect(data.error.code).toBe('NO_READABLE_DOCUMENTS');
    expect(logText).toContain(host);
    expect(logText).not.toContain(downloadUrl);
    expect(logText).not.toContain('signed-secret');
    errorSpy.mockRestore();
  });

  it('processes every section up to the configured Stage A section limit', async () => {
    const text = 'x'.repeat(50_000 * 6);
    sarvam.extractStructured.mockResolvedValue(stageAResult({ evidence_snippet: null }));
    const res = await POST(makeMockRequest([
      { fileName: 'large.txt', fileType: 'text', text },
    ]));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(sarvam.extractStructured.mock.calls.filter(([args]) => args.schema.name === 'stage_a_extraction').length)
      .toBe(6);
    expect(data.warnings.some((warning) => warning.type === 'sectioned')).toBe(true);
    expect(data.extractions).toHaveLength(1);
  });

  it('fails explicitly without model calls when source text exceeds section capacity', async () => {
    const sourceText = `BEGIN-${'x'.repeat(50_000 * 6)}-MIDDLE-SENSITIVE-ENDING`;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const res = await POST(makeMockRequest([
      { fileName: 'oversized.txt', fileType: 'text', text: sourceText },
    ]));
    const data = await res.json();
    const logs = [
      ...errorSpy.mock.calls,
      ...infoSpy.mock.calls,
    ].map(([message]) => String(message)).join('\n');

    expect(res.status).toBe(502);
    expect(data.error.code).toBe('EXTRACTION_INVALID');
    expect(data.error.failures[0]).toMatchObject({
      file_name: 'oversized.txt',
      code: 'DOCUMENT_TOO_LONG',
      message: expect.stringContaining('Split it into smaller parts'),
    });
    expect(sarvam.extractStructured).not.toHaveBeenCalled();
    expect(logs).not.toContain('MIDDLE-SENSITIVE');
    expect(logs).not.toContain('BEGIN-');
    expect(logs).not.toContain('ENDING');
    errorSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it('logs request stage timings without filenames or document text', async () => {
    const sourceText = 'Sensitive document text used only in this test.';
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    sarvam.extractStructured.mockResolvedValue(stageAResult({
      evidence_snippet: sourceText,
    }));

    const res = await POST(makeMockRequest([
      { fileName: 'private-personal-name.txt', fileType: 'text', text: sourceText },
    ]));
    const data = await res.json();
    const timing = infoSpy.mock.calls
      .map(([message]) => {
        try {
          return JSON.parse(message);
        } catch {
          return null;
        }
      })
      .find((entry) => entry?.event === 'pathwise_extract_timing');

    expect(res.status).toBe(200);
    expect(timing).toMatchObject({
      request_id: data.analysis_id,
      upload_ms: expect.any(Number),
      validation_ms: expect.any(Number),
      upload_validation_ms: expect.any(Number),
      digitisation_ms: expect.any(Number),
      stage_a_ms: expect.any(Number),
      stage_a_json_parse_ms: 0,
      stage_a_validation_ms: expect.any(Number),
      stage_a_repair_ms: 0,
      stage_b_ms: expect.any(Number),
      dependency_resolution_ms: expect.any(Number),
      priority_calculation_ms: expect.any(Number),
      total_request_ms: expect.any(Number),
    });
    const logText = infoSpy.mock.calls.map(([message]) => String(message)).join('\n');
    expect(logText).not.toContain(sourceText);
    expect(logText).not.toContain('private-personal-name.txt');
    infoSpy.mockRestore();
  });

  it('uses an absolute deadline before relative deadline information', async () => {
    sarvam.extractStructured.mockResolvedValue(stageAResult({
      deadline_date: '2099-01-01',
      deadline_relative_days: 2,
      deadline_relative_anchor: 'receipt of notice',
      evidence_snippet: 'Stage A source text',
    }));
    const res = await POST(makeMockRequest([
      { fileName: 'deadline.txt', fileType: 'text', text: 'Stage A source text' },
    ]));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.extractions[0]).toMatchObject({
      deadline_date: '2099-01-01',
      deadline_relative_days: 2,
      deadline_status: 'upcoming',
    });
    expect(data.extractions[0].deadline_days).toBeGreaterThan(2);
  });

  it('attaches Stage B conflicts to both extractions and the top-level response', async () => {
    sarvam.extractStructured.mockImplementation(async ({ schema }) => {
      if (schema.name === 'stage_b_relationships') {
        return {
          edges: [],
          conflicts: [{ doc_ids: ['doc1', 'doc2'], description: 'Conflicting deadlines' }],
        };
      }
      return stageAResult({ evidence_snippet: 'Stage A source text' });
    });

    const res = await POST(makeMockRequest([
      { fileName: 'one.txt', fileType: 'text', text: 'Stage A source text' },
      { fileName: 'two.txt', fileType: 'text', text: 'Stage A source text' },
    ]));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.conflicts).toEqual([
      { doc_ids: ['doc1', 'doc2'], description: 'Conflicting deadlines' },
    ]);
    expect(data.extractions.every((item) => item.conflicts.length === 1)).toBe(true);
  });

  it('accepts and normalizes non-critical Stage A fields', async () => {
    sarvam.extractStructured.mockResolvedValue(stageAResult({
      title: null,
      confidence: 2,
      unknown_key: 'stripped',
      required_documents: 'not-an-array',
      information_type: 'invalid',
    }));
    const res = await POST(makeMockRequest([
      { fileName: 'tolerant.txt', fileType: 'text', text: 'Stage A source text' },
    ]));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.extractions[0]).toMatchObject({
      title: '',
      confidence: 1,
      required_documents: [],
      information_type: 'uncertain',
    });
    expect(data.extractions[0].unknown_key).toBeUndefined();
    expect(sarvam.extractStructured).toHaveBeenCalledTimes(1);
  });

  it('falls back invalid confidence to 0.5', async () => {
    sarvam.extractStructured.mockResolvedValue(stageAResult({ confidence: 'unknown' }));
    const res = await POST(makeMockRequest([
      { fileName: 'confidence.txt', fileType: 'text', text: 'Stage A source text' },
    ]));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.extractions[0].confidence).toBe(0.5);
  });

  it('does not retry HTTP failures and keeps invalidOutput false', async () => {
    sarvam.extractStructured.mockRejectedValue(new sarvam.SarvamError('upstream unavailable', 503));
    const res = await POST(makeMockRequest([
      { fileName: 'failure.txt', fileType: 'text', text: 'Stage A source text' },
    ]));
    expect(res.status).toBe(502);
    expect(sarvam.extractStructured).toHaveBeenCalledTimes(1);
  });

  it('rejects an empty required action after one repair attempt', async () => {
    sarvam.extractStructured.mockResolvedValue(stageAResult({ required_action: '' }));
    const res = await POST(makeMockRequest([
      { fileName: 'required-action.txt', fileType: 'text', text: 'Stage A source text' },
    ]));
    expect(res.status).toBe(502);
    expect(sarvam.extractStructured).toHaveBeenCalledTimes(2);
  });

  it('repairs invalid JSON output exactly once', async () => {
    sarvam.extractStructured
      .mockRejectedValueOnce(new sarvam.SarvamError('malformed JSON', 502, true))
      .mockResolvedValueOnce(stageAResult());
    const res = await POST(makeMockRequest([
      { fileName: 'invalid-json.txt', fileType: 'text', text: 'Stage A source text' },
    ]));
    expect(res.status).toBe(200);
    expect(sarvam.extractStructured).toHaveBeenCalledTimes(2);
  });

  it('repairs empty model content exactly once', async () => {
    sarvam.extractStructured
      .mockRejectedValueOnce(new sarvam.SarvamError('empty response', 502, true))
      .mockResolvedValueOnce(stageAResult());
    const res = await POST(makeMockRequest([
      { fileName: 'empty-output.txt', fileType: 'text', text: 'Stage A source text' },
    ]));
    expect(res.status).toBe(200);
    expect(sarvam.extractStructured).toHaveBeenCalledTimes(2);
  });

  it('does not repair generic JavaScript errors', async () => {
    sarvam.extractStructured.mockRejectedValue(new Error('unexpected failure'));
    const res = await POST(makeMockRequest([
      { fileName: 'generic-error.txt', fileType: 'text', text: 'Stage A source text' },
    ]));
    expect(res.status).toBe(502);
    expect(sarvam.extractStructured).toHaveBeenCalledTimes(1);
  });

  it('does not repair TypeError failures', async () => {
    sarvam.extractStructured.mockRejectedValue(new TypeError('invalid response'));
    const res = await POST(makeMockRequest([
      { fileName: 'type-error.txt', fileType: 'text', text: 'Stage A source text' },
    ]));
    expect(res.status).toBe(502);
    expect(sarvam.extractStructured).toHaveBeenCalledTimes(1);
  });

  it('does not repair network failures', async () => {
    sarvam.extractStructured.mockRejectedValue(new Error('fetch failed'));
    const res = await POST(makeMockRequest([
      { fileName: 'network-error.txt', fileType: 'text', text: 'Stage A source text' },
    ]));
    expect(res.status).toBe(502);
    expect(sarvam.extractStructured).toHaveBeenCalledTimes(1);
  });

  it('does not repair AbortError failures', async () => {
    sarvam.extractStructured.mockRejectedValue(new DOMException('cancelled', 'AbortError'));
    const res = await POST(makeMockRequest([
      { fileName: 'abort-error.txt', fileType: 'text', text: 'Stage A source text' },
    ]));
    expect(res.status).toBe(504);
    expect(sarvam.extractStructured).toHaveBeenCalledTimes(1);
  });

  it('does not repair TimeoutError failures', async () => {
    sarvam.extractStructured.mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    const res = await POST(makeMockRequest([
      { fileName: 'timeout-error.txt', fileType: 'text', text: 'Stage A source text' },
    ]));
    expect(res.status).toBe(502);
    expect(sarvam.extractStructured).toHaveBeenCalledTimes(1);
  });

  it('logs detailed validation errors when Stage A output fails schema validation', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Return a response missing required field 'document_type'
    sarvam.extractStructured.mockResolvedValue({
      organization: null,
      title: "Title",
      required_action: "Complete task",
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
      source_page: null,
      evidence_snippet: null,
      information_type: "explicitly_stated",
    });

    const res = await POST(makeMockRequest([
      { fileName: 'invalid-schema.txt', fileType: 'text', text: 'Stage A source text' },
    ]));

    expect(res.status).toBe(502);
    expect(sarvam.extractStructured).toHaveBeenCalledTimes(2); // Initial + repair attempt

    // Verify that detailed validation error was logged.
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('"stage":"stage_a_validation_failed_initial"')
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('"validation_errors"')
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('document_type')
    );

    consoleSpy.mockRestore();
  });

  it('repairs invalid output once and does not make a third attempt', async () => {
    sarvam.extractStructured
      .mockRejectedValueOnce(new sarvam.SarvamError('malformed', 502, true))
      .mockResolvedValueOnce(stageAResult());
    const res = await POST(makeMockRequest([
      { fileName: 'repair.txt', fileType: 'text', text: 'Stage A source text' },
    ]));
    expect(res.status).toBe(200);
    expect(sarvam.extractStructured).toHaveBeenCalledTimes(2);

    sarvam.extractStructured.mockReset();
    sarvam.extractStructured.mockRejectedValue(new sarvam.SarvamError('malformed', 502, true));
    const failed = await POST(makeMockRequest([
      { fileName: 'failed-repair.txt', fileType: 'text', text: 'Stage A source text' },
    ]));
    expect(failed.status).toBe(502);
    expect(sarvam.extractStructured).toHaveBeenCalledTimes(2);
  });

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
    expect(data.reasoning_steps[0].detail).toBe('2 of 3 documents analysed (1 could not be read)');
  });

  it('logs PDF Stage A failures with sanitized diagnostics while keeping the client error generic', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const documentContent = ['Private', 'PDF', 'content'].join(' ');
    readPdfTextLayer.mockResolvedValue({
      pages: 1,
      hasTextLayer: true,
      text: documentContent,
    });
    const upstreamError = new sarvam.SarvamError(
      'Upstream extraction failed; authorization: Bearer private-token; body: Private PDF content',
      503
    );
    upstreamError.code = 'UPSTREAM_ERROR';
    sarvam.extractStructured.mockRejectedValue(upstreamError);

    const formData = new FormData();
    formData.append('documents', JSON.stringify([
      { fileName: 'post.pdf', fileType: 'pdf', text: '' },
    ]));
    formData.append('file_0', new Blob(['%PDF-1.7'], { type: 'application/pdf' }), 'post.pdf');
    const res = await POST(new Request('http://localhost:3000/api/extract', {
      method: 'POST',
      body: formData,
    }));
    const data = await res.json();
    const diagnostic = errorSpy.mock.calls
      .map(([message]) => {
        try {
          return JSON.parse(message);
        } catch {
          return null;
        }
      })
      .find((entry) => entry?.stage === 'stage_a_extraction');

    expect(res.status).toBe(502);
    expect(data.error.code).toBe('EXTRACTION_INVALID');
    expect(data.error.message).toBe('All document extractions failed.');
    expect(data.error.failures).toEqual([
      {
        file_name: 'post.pdf',
        code: 'EXTRACTION_FAILED',
        message: 'This document could not be analyzed.',
      },
    ]);
    expect(diagnostic).toMatchObject({
      request_id: data.error.request_id,
      file_name: 'post.pdf',
      stage: 'stage_a_extraction',
      error_name: 'SarvamError',
      error_code: 'UPSTREAM_ERROR',
      upstream_status: 503,
    });
    expect(diagnostic.description).toContain('Upstream extraction failed');
    expect(diagnostic.description).not.toContain('private-token');
    expect(diagnostic.description).not.toContain(documentContent);
    errorSpy.mockRestore();
  });

  it.each([
    ['missing required fields', (valid) => {
      const output = { ...valid };
      delete output.required_action;
      return output;
    }, 'required_action'],
    ['incorrect field types', (valid) => ({ ...valid, required_action: 42 }), 'required_action'],
    ['unexpected response nesting', (valid) => ({ data: valid }), 'required_action'],
  ])('reports safe Stage A schema diagnostics for %s', async (_label, makeInvalidOutput, expectedPath) => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const invalidOutput = makeInvalidOutput(stageAResult({ title: 'Private document detail' }));
    Object.defineProperty(invalidOutput, sarvam.STRUCTURED_RESPONSE_METADATA, {
      value: { contentType: 'application/json' },
    });
    sarvam.extractStructured.mockResolvedValue(invalidOutput);

    const res = await POST(makeMockRequest([
      { fileName: 'schema-failure.txt', fileType: 'text', text: 'Source text' },
    ]));
    const data = await res.json();
    const diagnostic = errorSpy.mock.calls
      .map(([message]) => {
        try {
          return JSON.parse(message);
        } catch {
          return null;
        }
      })
      .find((entry) => entry?.stage === 'stage_a_extraction');

    expect(res.status).toBe(502);
    expect(data.error.code).toBe('EXTRACTION_INVALID');
    expect(diagnostic).toMatchObject({
      request_id: data.error.request_id,
      file_name: 'schema-failure.txt',
      stage: 'stage_a_extraction',
      error_code: 'EXTRACTION_FAILED',
      upstream_status: 502,
      validation_attempt: 'repair',
      upstream_content_type: 'application/json',
    });
    expect(diagnostic.validation_errors.some((issue) => issue.path.includes(expectedPath))).toBe(true);
    expect(JSON.stringify(diagnostic)).not.toContain('Private document detail');
    expect(sarvam.extractStructured).toHaveBeenCalledTimes(2);
    expect(sarvam.extractStructured.mock.calls.map(([args]) => args.telemetry)).toEqual([
      expect.objectContaining({ requestId: data.error.request_id, stage: 'stage_a_extraction', attemptNumber: 1 }),
      expect.objectContaining({ requestId: data.error.request_id, stage: 'stage_a_repair', attemptNumber: 2 }),
    ]);
    errorSpy.mockRestore();
  });

  it('keeps malformed JSON failures distinct from Stage A schema failures', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    sarvam.extractStructured.mockRejectedValue(
      new sarvam.SarvamError('The AI returned malformed JSON. Please try again.', 502, true)
    );

    const res = await POST(makeMockRequest([
      { fileName: 'malformed.txt', fileType: 'text', text: 'Source text' },
    ]));
    const data = await res.json();
    const diagnostic = errorSpy.mock.calls
      .map(([message]) => {
        try {
          return JSON.parse(message);
        } catch {
          return null;
        }
      })
      .find((entry) => entry?.stage === 'stage_a_extraction');

    expect(res.status).toBe(502);
    expect(data.error.code).toBe('EXTRACTION_INVALID');
    expect(diagnostic.description).toContain('malformed JSON');
    expect(diagnostic.validation_issues).toBeUndefined();
    expect(sarvam.extractStructured).toHaveBeenCalledTimes(2);
    expect(sarvam.extractStructured.mock.calls.map(([args]) => args.telemetry)).toEqual([
      expect.objectContaining({ requestId: data.error.request_id, stage: 'stage_a_extraction', attemptNumber: 1 }),
      expect.objectContaining({ requestId: data.error.request_id, stage: 'stage_a_repair', attemptNumber: 2 }),
    ]);
    errorSpy.mockRestore();
  });

  it('does not retry or accept truncated Stage A output', async () => {
    sarvam.extractStructured.mockRejectedValue(
      new sarvam.SarvamError('The AI response was cut off.', 502, true, 'truncated')
    );

    const res = await POST(makeMockRequest([
      { fileName: 'truncated.txt', fileType: 'text', text: 'The user must submit form.' },
    ]));
    const data = await res.json();

    expect(res.status).toBe(502);
    expect(data.error.code).toBe('EXTRACTION_INVALID');
    expect(sarvam.extractStructured).toHaveBeenCalledTimes(1);
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
