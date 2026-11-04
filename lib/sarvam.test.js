import AdmZip from 'adm-zip';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  chunkText,
  parseJsonLoose,
  extractStructured,
  parseDocument,
  translateText,
  getChatModel,
  SarvamError,
  STRUCTURED_RESPONSE_METADATA,
} from './sarvam.js';
import { env } from './env.js';
import { TRANSLATE_CHUNK } from './limits.js';

describe('chunkText', () => {
  it('keeps short text as single chunk', () => {
    const text = 'This is a short document.';
    const chunks = chunkText(text, 1800);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(text);
  });

  it('splits on paragraph boundaries', () => {
    const text = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
    const chunks = chunkText(text, 50);
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should contain complete paragraphs
    chunks.forEach((chunk) => {
      expect(chunk.trim()).not.toBe('');
    });
  });

  it('splits on sentence boundaries when paragraph is too long', () => {
    const longSentence1 = 'A'.repeat(1000);
    const longSentence2 = 'B'.repeat(1000);
    const text = `${longSentence1}. ${longSentence2}.`;
    const chunks = chunkText(text, 1800);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('respects max chunk size', () => {
    const text = 'A'.repeat(5000);
    const maxSize = 1800;
    const chunks = chunkText(text, maxSize);
    chunks.forEach((chunk) => {
      expect(chunk.length).toBeLessThanOrEqual(maxSize);
    });
  });

  it('handles Devanagari sentence terminators', () => {
    const text = 'यह पहला वाक्य है। यह दूसरा वाक्य है॥ यह तीसरा वाक्य है।';
    const chunks = chunkText(text, 50);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('preserves paragraph structure in chunks', () => {
    const para1 = 'This is paragraph one with some content.';
    const para2 = 'This is paragraph two with different content.';
    const text = `${para1}\n\n${para2}`;
    const chunks = chunkText(text, 1800);
    const rejoined = chunks.join('\n\n');
    expect(rejoined).toContain(para1);
    expect(rejoined).toContain(para2);
  });

  it('handles empty or whitespace-only text', () => {
    expect(chunkText('', 1800)).toEqual([]);
    expect(chunkText('   \n\n   ', 1800)).toEqual([]);
  });
});

describe('parseJsonLoose', () => {
  it('parses standard JSON', () => {
    const json = '{"key": "value", "number": 42}';
    const result = parseJsonLoose(json);
    expect(result).toEqual({ key: 'value', number: 42 });
  });

  describe('Sarvam upstream and OCR behavior', () => {
    const originalReasoningEffort = env.SARVAM_REASONING_EFFORT;

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      env.SARVAM_REASONING_EFFORT = originalReasoningEffort;
    });

    function jsonResponse(body, status = 200, headers = {}) {
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
      });
    }

    it('retries 503 responses and eventually succeeds', async () => {
      vi.useFakeTimers();
      env.SARVAM_API_KEY = 'test-key';
      const fetchStub = vi.fn()
        .mockResolvedValueOnce(jsonResponse({}, 503))
        .mockResolvedValueOnce(jsonResponse({}, 503))
        .mockResolvedValueOnce(jsonResponse({
          choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
        }));
      vi.stubGlobal('fetch', fetchStub);

      const request = extractStructured({
        systemPrompt: 'system',
        userMessage: 'user',
        schema: { name: 'test' },
      });
      const assertion = expect(request).resolves.toEqual({ ok: true });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;
      expect(fetchStub).toHaveBeenCalledTimes(3);
    });

    it('retains upstream content type as non-enumerable parsed-response metadata', async () => {
      env.SARVAM_API_KEY = 'test-key';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
        choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
      })));

      const result = await extractStructured({
        systemPrompt: 'system',
        userMessage: 'user',
        schema: { name: 'test' },
      });

      expect(result).toEqual({ ok: true });
      expect(result[STRUCTURED_RESPONSE_METADATA]).toEqual({
        contentType: 'application/json',
        structuredParseMs: expect.any(Number),
      });
      expect(Object.keys(result)).toEqual(['ok']);
    });

    it('logs per-call metadata with explicit unavailable usage and without request content', async () => {
      env.SARVAM_API_KEY = 'test-key';
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
        choices: [{ message: { content: '{"ok":true}' } }],
      })));

      await extractStructured({
        systemPrompt: 'private prompt text',
        userMessage: 'private document text',
        schema: { name: 'test' },
        telemetry: {
          requestId: 'request-123',
          stage: 'stage_a_extraction',
          attemptNumber: 1,
        },
      });

      const log = JSON.parse(infoSpy.mock.calls[0][0]);
      expect(log).toMatchObject({
        event: 'pathwise_model_call',
        request_id: 'request-123',
        stage: 'stage_a_extraction',
        attempt_number: 1,
        model: getChatModel(),
        input_tokens: null,
        output_tokens: null,
        reasoning_tokens: null,
        reasoning_effort: null,
        finish_reason: null,
        output_classification: 'complete_json',
        configured_max_tokens: env.SARVAM_MAX_TOKENS,
        request_duration_ms: expect.any(Number),
        response_envelope_parse_ms: expect.any(Number),
        structured_json_parse_ms: expect.any(Number),
        success_classification: 'success',
      });
      expect(infoSpy.mock.calls.map(([message]) => String(message)).join('\n'))
        .not.toContain('private');
      expect(infoSpy.mock.calls.map(([message]) => String(message)).join('\n'))
        .not.toContain('test-key');
    });

    it('records token usage and truncation without logging the partial model response', async () => {
      env.SARVAM_API_KEY = 'test-key';
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const privateResponse = 'private partial document-derived response';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
        choices: [{
          message: { content: privateResponse },
          finish_reason: 'length',
        }],
        usage: { prompt_tokens: 123, completion_tokens: 4096 },
      })));

      await expect(extractStructured({
        systemPrompt: 'system',
        userMessage: 'document',
        schema: { name: 'test' },
        telemetry: { requestId: 'request-456', stage: 'stage_a_extraction', attemptNumber: 1 },
      })).rejects.toMatchObject({ invalidOutput: true });

      const log = JSON.parse(infoSpy.mock.calls[0][0]);
      expect(log).toMatchObject({
        request_id: 'request-456',
        stage: 'stage_a_extraction',
        input_tokens: 123,
        output_tokens: 4096,
        reasoning_tokens: null,
        reasoning_effort: null,
        finish_reason: 'length',
        output_classification: 'truncated',
        success_classification: 'truncated',
      });
      expect(String(infoSpy.mock.calls[0][0])).not.toContain(privateResponse);
      expect(String(infoSpy.mock.calls[0][0])).not.toContain('test-key');
    });

    it.each(['none', 'low', 'high', 'max'])('sends and records reasoning effort %s and usage', async (effort) => {
      env.SARVAM_API_KEY = 'test-key';
      env.SARVAM_REASONING_EFFORT = effort;
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const fetchStub = vi.fn().mockResolvedValue(jsonResponse({
        choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 23,
          completion_tokens_details: { reasoning_tokens: 7 },
        },
      }));
      vi.stubGlobal('fetch', fetchStub);

      await extractStructured({
        systemPrompt: 'private prompt',
        userMessage: 'private document',
        schema: { name: 'test' },
        telemetry: { requestId: 'request-effort', stage: 'stage_a_extraction', attemptNumber: 1 },
      });

      const body = JSON.parse(fetchStub.mock.calls[0][1].body);
      expect(body.reasoning_effort).toBe(effort);
      const log = JSON.parse(infoSpy.mock.calls[0][0]);
      expect(log).toMatchObject({
        request_id: 'request-effort',
        input_tokens: 12,
        output_tokens: 23,
        reasoning_tokens: 7,
        reasoning_effort: effort,
        finish_reason: 'stop',
        output_classification: 'complete_json',
      });
      expect(String(infoSpy.mock.calls[0][0])).not.toContain('private');
    });

    it('classifies a complete malformed response without logging response content', async () => {
      env.SARVAM_API_KEY = 'test-key';
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const privateResponse = '{"secret-derived-value":';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
        choices: [{ message: { content: privateResponse }, finish_reason: 'stop' }],
      })));

      await expect(extractStructured({
        systemPrompt: 'system',
        userMessage: 'document',
        schema: { name: 'test' },
        telemetry: { requestId: 'request-malformed', stage: 'stage_a_extraction', attemptNumber: 1 },
      })).rejects.toMatchObject({
        invalidOutput: true,
        outputClassification: 'malformed_json',
      });

      const log = JSON.parse(infoSpy.mock.calls[0][0]);
      expect(log.output_classification).toBe('malformed_json');
      expect(String(infoSpy.mock.calls[0][0])).not.toContain(privateResponse);
    });

    it('classifies API failures without attempting to interpret an error body as extraction output', async () => {
      env.SARVAM_API_KEY = 'test-key';
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message: 'private upstream body' }, 400)));

      await expect(extractStructured({
        systemPrompt: 'system',
        userMessage: 'document',
        schema: { name: 'test' },
        telemetry: { requestId: 'request-upstream', stage: 'stage_a_extraction', attemptNumber: 1 },
      })).rejects.toMatchObject({ status: 400, invalidOutput: false });

      const log = JSON.parse(infoSpy.mock.calls[0][0]);
      expect(log.output_classification).toBe('upstream_failure');
      expect(String(infoSpy.mock.calls[0][0])).not.toContain('private upstream body');
    });

    it('does not fetch when the caller signal is already aborted', async () => {
      env.SARVAM_API_KEY = 'test-key';
      const reason = new DOMException('cancelled before request', 'AbortError');
      const controller = new AbortController();
      controller.abort(reason);
      const fetchStub = vi.fn();
      vi.stubGlobal('fetch', fetchStub);

      await expect(extractStructured({
        systemPrompt: 'system',
        userMessage: 'user',
        schema: { name: 'test' },
        signal: controller.signal,
      })).rejects.toBe(reason);
      expect(fetchStub).not.toHaveBeenCalled();
    });

    it('stops a network retry when the caller aborts during backoff', async () => {
      vi.useFakeTimers();
      env.SARVAM_API_KEY = 'test-key';
      const reason = new DOMException('cancelled during retry', 'AbortError');
      const controller = new AbortController();
      const fetchStub = vi.fn().mockRejectedValue(new Error('connection reset'));
      vi.stubGlobal('fetch', fetchStub);

      const request = extractStructured({
        systemPrompt: 'system',
        userMessage: 'user',
        schema: { name: 'test' },
        signal: controller.signal,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchStub).toHaveBeenCalledTimes(1);
      controller.abort(reason);
      await expect(request).rejects.toBe(reason);
      expect(fetchStub).toHaveBeenCalledTimes(1);
    });

    it('cancels retry backoff promptly without waiting for its full delay', async () => {
      vi.useFakeTimers();
      env.SARVAM_API_KEY = 'test-key';
      const controller = new AbortController();
      const reason = new DOMException('prompt cancellation', 'AbortError');
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection reset')));

      const request = extractStructured({
        systemPrompt: 'system',
        userMessage: 'user',
        schema: { name: 'test' },
        signal: controller.signal,
      });
      await vi.advanceTimersByTimeAsync(0);
      controller.abort(reason);
      let settled = false;
      request.then(
        () => { settled = true; },
        () => { settled = true; }
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(true);
      await expect(request).rejects.toBe(reason);
    });

    it('cancels Retry-After backoff without issuing another request', async () => {
      vi.useFakeTimers();
      env.SARVAM_API_KEY = 'test-key';
      const controller = new AbortController();
      const reason = new DOMException('cancelled after rate limit', 'AbortError');
      const fetchStub = vi.fn().mockResolvedValue(
        jsonResponse({}, 503, { 'retry-after': '60' })
      );
      vi.stubGlobal('fetch', fetchStub);

      const request = extractStructured({
        systemPrompt: 'system',
        userMessage: 'user',
        schema: { name: 'test' },
        signal: controller.signal,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchStub).toHaveBeenCalledTimes(1);
      controller.abort(reason);
      await expect(request).rejects.toBe(reason);
      expect(fetchStub).toHaveBeenCalledTimes(1);
    });

    it('does not retry HTTP 400 responses', async () => {
      env.SARVAM_API_KEY = 'test-key';
      const fetchStub = vi.fn().mockResolvedValue(jsonResponse({}, 400));
      vi.stubGlobal('fetch', fetchStub);

      await expect(extractStructured({
        systemPrompt: 'system',
        userMessage: 'user',
        schema: { name: 'test' },
      })).rejects.toMatchObject({ status: 400, invalidOutput: false });
      expect(fetchStub).toHaveBeenCalledTimes(1);
    });

    it('honors an HTTP-date Retry-After header', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      env.SARVAM_API_KEY = 'test-key';
      const retryAt = new Date('2026-01-01T00:00:05.000Z').toUTCString();
      const fetchStub = vi.fn()
        .mockResolvedValueOnce(jsonResponse({}, 503, { 'retry-after': retryAt }))
        .mockResolvedValueOnce(jsonResponse({
          choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
        }));
      vi.stubGlobal('fetch', fetchStub);

      const request = extractStructured({
        systemPrompt: 'system',
        userMessage: 'user',
        schema: { name: 'test' },
      });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(4999);
      expect(fetchStub).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(request).resolves.toEqual({ ok: true });
      expect(fetchStub).toHaveBeenCalledTimes(2);
    });

    function makeOcrZip(pages) {
      const zip = new AdmZip();
      for (const [name, text] of pages) zip.addFile(name, Buffer.from(text));
      return zip.toBuffer();
    }

    async function runOcr(
      status,
      pages = [['page-1.md', 'OCR text']],
      extra = {},
      downloadUrl = 'https://api.sarvam.ai/output.zip',
      downloadError = null,
      telemetry = {}
    ) {
      vi.useFakeTimers();
      env.SARVAM_API_KEY = 'test-key';
      env.PARSE_TIMEOUT_MS = 30_000;
      const zip = makeOcrZip(pages);
      const fetchStub = vi.fn()
        .mockResolvedValueOnce(jsonResponse({ job_id: 'job-1' }))
        .mockResolvedValueOnce(jsonResponse({ status, ...extra }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ url: downloadUrl }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }));
      if (downloadError) {
        fetchStub.mockRejectedValueOnce(downloadError);
      } else {
        fetchStub.mockResolvedValueOnce(new Response(zip, {
          status: 200,
          headers: { 'content-type': 'application/zip' },
        }));
      }
      vi.stubGlobal('fetch', fetchStub);
      const request = parseDocument({
        buffer: Buffer.from('pdf'),
        fileName: 'scan.pdf',
        mimeType: 'application/pdf',
        requestId: telemetry.requestId,
        documentIndex: telemetry.documentIndex,
      });
      return { request, fetchStub };
    }

    it('accepts completed OCR jobs', async () => {
      const { request } = await runOcr('completed');
      const assertion = expect(request).resolves.toMatchObject({ text: 'OCR text', partial: false });
      await vi.advanceTimersByTimeAsync(1500);
      await assertion;
    });

    it('records OCR stage durations without filenames or OCR content', async () => {
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const { request } = await runOcr(
        'completed',
        [['page-1.md', 'private OCR document content']],
        {},
        'https://api.sarvam.ai/output.zip',
        null,
        { requestId: 'ocr-request-1', documentIndex: 2 }
      );
      await vi.advanceTimersByTimeAsync(1500);
      await expect(request).resolves.toMatchObject({ text: 'private OCR document content' });

      const log = JSON.parse(infoSpy.mock.calls[0][0]);
      expect(log).toMatchObject({
        event: 'pathwise_ocr_timing',
        request_id: 'ocr-request-1',
        document_index: 2,
        submission_ms: expect.any(Number),
        polling_ms: expect.any(Number),
        download_ms: expect.any(Number),
        ocr_duration_ms: expect.any(Number),
        outcome: 'success',
      });
      expect(String(infoSpy.mock.calls[0][0])).not.toContain('private OCR document content');
      expect(String(infoSpy.mock.calls[0][0])).not.toContain('scan.pdf');
    });

    it('accepts the observed Azure Blob OCR download host', async () => {
      const { request } = await runOcr(
        'completed',
        [['page-1.md', 'OCR text']],
        {},
        'https://appsprodaksharpublicsa.blob.core.windows.net/output.zip?sig=signed-token'
      );
      const assertion = expect(request).resolves.toMatchObject({ text: 'OCR text' });
      await vi.advanceTimersByTimeAsync(1500);
      await assertion;
    });

    it('accepts existing trusted Sarvam download hosts', async () => {
      const { request } = await runOcr(
        'completed',
        [['page-1.md', 'OCR text']],
        {},
        'https://downloads.sarvam.ai/output.zip'
      );
      const assertion = expect(request).resolves.toMatchObject({ text: 'OCR text' });
      await vi.advanceTimersByTimeAsync(1500);
      await assertion;
    });

    it.each([
      ['an unrelated Azure Blob host', 'https://otheraccount.blob.core.windows.net/output.zip'],
      ['an arbitrary external host', 'https://downloads.example.test/output.zip'],
    ])('rejects %s', async (_label, downloadUrl) => {
      const { request } = await runOcr('completed', [['page-1.md', 'OCR text']], {}, downloadUrl);
      const assertion = expect(request).rejects.toMatchObject({ status: 502 });
      await vi.advanceTimersByTimeAsync(1500);
      await assertion;
    });

    it('rejects HTTP OCR download URLs', async () => {
      const { request } = await runOcr(
        'completed',
        [['page-1.md', 'OCR text']],
        {},
        'http://appsprodaksharpublicsa.blob.core.windows.net/output.zip'
      );
      const assertion = expect(request).rejects.toMatchObject({
        status: 502,
        message: 'Download URL must use HTTPS.',
      });
      await vi.advanceTimersByTimeAsync(1500);
      await assertion;
    });

    it('rejects redirects when downloading OCR output', async () => {
      const { request, fetchStub } = await runOcr(
        'completed',
        [['page-1.md', 'OCR text']],
        {},
        'https://appsprodaksharpublicsa.blob.core.windows.net/output.zip',
        new Error('redirect')
      );
      const assertion = expect(request).rejects.toMatchObject({
        status: 502,
        message: 'OCR download was redirected unexpectedly.',
      });
      await vi.advanceTimersByTimeAsync(1500);
      await assertion;
      expect(fetchStub).toHaveBeenCalledTimes(4);
    });

    it('returns partial OCR information for partially completed jobs', async () => {
      const { request } = await runOcr('partially_completed', [['page-1.md', 'Partial text']], {
        usage: { pages_processed: 1, pages_failed: 1 },
      });
      const assertion = expect(request).resolves.toMatchObject({
        text: 'Partial text',
        partial: true,
        pages: 1,
        pagesFailed: 1,
      });
      await vi.advanceTimersByTimeAsync(1500);
      await assertion;
    });

    it('reports failed OCR jobs', async () => {
      const { request } = await runOcr('failed', [], { error_message: 'bad scan' });
      const assertion = expect(request).rejects.toMatchObject({ status: 422 });
      await vi.advanceTimersByTimeAsync(1500);
      await assertion;
    });

    it('identifies an untrusted OCR download hostname without exposing the URL', async () => {
      const downloadUrl = 'https://downloads.example.test/output.zip?token=signed-secret';
      const { request, fetchStub } = await runOcr('completed', [['page-1.md', 'OCR text']], {}, downloadUrl);
      const assertion = expect(request).rejects.toMatchObject({
        status: 502,
        message: 'Download URL host is not trusted: downloads.example.test.',
      });
      await vi.advanceTimersByTimeAsync(1500);
      await assertion;
      expect(fetchStub).toHaveBeenCalledTimes(3);
      expect((await request.catch((error) => error)).message).not.toContain(downloadUrl);
      expect((await request.catch((error) => error)).message).not.toContain('signed-secret');
    });

    it('bounds unknown OCR statuses after three reads', async () => {
      vi.useFakeTimers();
      env.SARVAM_API_KEY = 'test-key';
      const fetchStub = vi.fn()
        .mockResolvedValueOnce(jsonResponse({ job_id: 'job-1' }))
        .mockImplementation(() => jsonResponse({ status: 'mystery' }));
      vi.stubGlobal('fetch', fetchStub);
      const request = parseDocument({
        buffer: Buffer.from('pdf'),
        fileName: 'scan.pdf',
        mimeType: 'application/pdf',
      });
      const assertion = expect(request).rejects.toMatchObject({ status: 502 });
      await vi.advanceTimersByTimeAsync(1500 + 2000 + 2000);
      await assertion;
      expect(fetchStub).toHaveBeenCalledTimes(4);
    });

    it('orders numeric OCR ZIP pages numerically', async () => {
      const { request } = await runOcr('completed', [
        ['page-10.md', 'ten'],
        ['page-2.md', 'two'],
        ['page-1.md', 'one'],
      ]);
      const assertion = expect(request).resolves.toMatchObject({
        text: '--- Page 1 ---\none\n\n--- Page 2 ---\ntwo\n\n--- Page 3 ---\nten',
      });
      await vi.advanceTimersByTimeAsync(1500);
      await assertion;
    });

    it('aborts sibling translation chunks after the first chunk fails', async () => {
      env.SARVAM_API_KEY = 'test-key';
      const controller = new AbortController();
      let siblingSignal;
      const fetchStub = vi.fn((_url, { signal }) => {
        siblingSignal = signal;
        return Promise.reject(new DOMException('first chunk failed', 'AbortError'));
      });
      vi.stubGlobal('fetch', fetchStub);
      const text = `${'a'.repeat(TRANSLATE_CHUNK)}\n\n${'b'.repeat(TRANSLATE_CHUNK)}`;
      await expect(translateText(text, 'hi-IN', 'en-IN', controller.signal))
        .rejects.toMatchObject({ name: 'AbortError' });
      expect(siblingSignal.aborted).toBe(true);
    });
  });

  describe('upstream cancellation', () => {
    it('does not retry when the caller aborts while fetch is pending', async () => {
      const previousKey = env.SARVAM_API_KEY;
      env.SARVAM_API_KEY = 'test-key';
      const controller = new AbortController();
      let fetchCalls = 0;
      const fetchStub = vi.fn((_url, { signal }) => {
        fetchCalls++;
        return new Promise((_, reject) => {
          signal.addEventListener('abort', () => {
            reject(signal.reason);
          }, { once: true });
        });
      });
      vi.stubGlobal('fetch', fetchStub);

      let abortedAt;
      const request = extractStructured({
        systemPrompt: 'system',
        userMessage: 'user',
        schema: { name: 'test' },
        signal: controller.signal,
      });
      setTimeout(() => {
        abortedAt = Date.now();
        controller.abort(new DOMException('cancelled', 'AbortError'));
      }, 10);

      try {
        await expect(request).rejects.toMatchObject({ name: 'AbortError' });
        expect(Date.now() - abortedAt).toBeLessThan(100);
        expect(fetchCalls).toBe(1);
      } finally {
        env.SARVAM_API_KEY = previousKey;
        vi.unstubAllGlobals();
      }
    });
  });

  it('extracts JSON from markdown code blocks', () => {
    const markdown = '```json\n{"key": "value"}\n```';
    const result = parseJsonLoose(markdown);
    expect(result).toEqual({ key: 'value' });
  });

  it('handles text before and after JSON', () => {
    const text = 'Here is the data: {"key": "value"} end of message';
    const result = parseJsonLoose(text);
    expect(result).toEqual({ key: 'value' });
  });

  it('throws on invalid JSON', () => {
    const invalid = 'this is not json at all';
    expect(() => parseJsonLoose(invalid)).toThrowError(
      expect.objectContaining({ invalidOutput: true })
    );
  });

  it('marks empty model output as invalid output', async () => {
    const previousKey = env.SARVAM_API_KEY;
    env.SARVAM_API_KEY = 'test-key';
    const previousFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '' }, finish_reason: 'stop' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    try {
      await expect(extractStructured({
        systemPrompt: 'system',
        userMessage: 'user',
        schema: { name: 'test' },
      })).rejects.toMatchObject({ invalidOutput: true });
    } finally {
      env.SARVAM_API_KEY = previousKey;
      globalThis.fetch = previousFetch;
    }
  });

  it('defaults SarvamError invalidOutput to false', () => {
    expect(new SarvamError('HTTP 503 upstream failure', 503).invalidOutput).toBe(false);
  });

  it('handles nested objects', () => {
    const json = '{"outer": {"inner": "value"}}';
    const result = parseJsonLoose(json);
    expect(result).toEqual({ outer: { inner: 'value' } });
  });

  it('handles arrays', () => {
    const json = '{"items": [1, 2, 3]}';
    const result = parseJsonLoose(json);
    expect(result).toEqual({ items: [1, 2, 3] });
  });
});
