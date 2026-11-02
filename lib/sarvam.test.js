import { describe, it, expect, vi } from 'vitest';
import { chunkText, parseJsonLoose, extractStructured } from './sarvam.js';
import { env } from './env.js';

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
    expect(() => parseJsonLoose(invalid)).toThrow();
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
