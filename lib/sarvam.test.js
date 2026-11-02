import AdmZip from 'adm-zip';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  chunkText,
  parseJsonLoose,
  extractStructured,
  parseDocument,
  translateText,
  SarvamError,
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
    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
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

    async function runOcr(status, pages = [['page-1.md', 'OCR text']], extra = {}) {
      vi.useFakeTimers();
      env.SARVAM_API_KEY = 'test-key';
      env.PARSE_TIMEOUT_MS = 30_000;
      const zip = makeOcrZip(pages);
      const fetchStub = vi.fn()
        .mockResolvedValueOnce(jsonResponse({ job_id: 'job-1' }))
        .mockResolvedValueOnce(jsonResponse({ status, ...extra }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ url: 'https://api.sarvam.ai/output.zip' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
        .mockResolvedValueOnce(new Response(zip, {
          status: 200,
          headers: { 'content-type': 'application/zip' },
        }));
      vi.stubGlobal('fetch', fetchStub);
      const request = parseDocument({
        buffer: Buffer.from('pdf'),
        fileName: 'scan.pdf',
        mimeType: 'application/pdf',
      });
      return { request, fetchStub };
    }

    it('accepts completed OCR jobs', async () => {
      const { request } = await runOcr('completed');
      const assertion = expect(request).resolves.toMatchObject({ text: 'OCR text', partial: false });
      await vi.advanceTimersByTimeAsync(1500);
      await assertion;
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
