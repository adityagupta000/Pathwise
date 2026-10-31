import { describe, it, expect } from 'vitest';
import { buildUserMessage, buildSystemPrompt, sanitizeLabel } from './extraction.js';
import { MAX_TOTAL_CHARS, MAX_CHARS_PER_SECTION } from './limits.js';

describe('buildUserMessage', () => {
  it('formats single document correctly', () => {
    const docs = [
      {
        title: 'Test Document',
        fileName: 'test.txt',
        source: 'Upload',
        text: 'This is the document content.',
      },
    ];

    const result = buildUserMessage(docs);
    expect(result.message).toContain('--- DOCUMENT 1 ---');
    expect(result.message).toContain('Title: Test Document');
    expect(result.message).toContain('Filename: test.txt');
    expect(result.message).toContain('This is the document content.');
    expect(result.warnings).toHaveLength(0);
  });

  it('formats multiple documents correctly', () => {
    const docs = [
      {
        title: 'Doc 1',
        fileName: 'doc1.txt',
        source: 'Upload',
        text: 'Content 1',
      },
      {
        title: 'Doc 2',
        fileName: 'doc2.txt',
        source: 'Upload',
        text: 'Content 2',
      },
    ];

    const result = buildUserMessage(docs);
    expect(result.message).toContain('--- DOCUMENT 1 ---');
    expect(result.message).toContain('--- DOCUMENT 2 ---');
    expect(result.message).toContain('Content 1');
    expect(result.message).toContain('Content 2');
  });

  it('sections long documents with warnings', () => {
    // Create document with paragraphs so sectioning works properly
    const para = 'A'.repeat(15000);
    const longText = Array(5).fill(para).join('\n\n'); // 75K total with paragraph breaks
    const docs = [
      {
        title: 'Long Document',
        fileName: 'long.txt',
        source: 'Upload',
        text: longText,
      },
    ];

    const result = buildUserMessage(docs);
    expect(result.sections).toBeGreaterThan(1);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some(w => w.type === 'sectioned')).toBe(true);
  });

  it('does not section short documents', () => {
    const docs = [
      {
        title: 'Short Document',
        fileName: 'short.txt',
        source: 'Upload',
        text: 'Short content',
      },
    ];

    const result = buildUserMessage(docs);
    expect(result.sections).toBe(1);
    expect(result.warnings).toHaveLength(0);
  });

  it('handles empty text', () => {
    const docs = [
      {
        title: 'Empty Document',
        fileName: 'empty.txt',
        source: 'Upload',
        text: '',
      },
    ];

    const result = buildUserMessage(docs);
    expect(result.message).toContain('--- DOCUMENT 1 ---');
    expect(result.warnings).toHaveLength(0);
  });

  it('preserves page markers when sectioning', () => {
    const textWithPages = '--- PAGE 1 ---\n' + 'A'.repeat(30000) + '\n--- PAGE 2 ---\n' + 'B'.repeat(30000);
    const docs = [
      {
        title: 'Multi-page Doc',
        fileName: 'pages.txt',
        source: 'Upload',
        text: textWithPages,
      },
    ];

    const result = buildUserMessage(docs);
    expect(result.message).toContain('PAGE 1');
    expect(result.message).toContain('PAGE 2');
  });
});

describe('buildSystemPrompt', () => {
  it('includes today\'s date', () => {
    const now = new Date('2025-03-15T10:00:00Z');
    const prompt = buildSystemPrompt(now);
    expect(prompt).toContain('TODAY\'S DATE: 2025-03-15');
  });

  it('instructs to use null for missing deadlines', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('use null for deadline_days');
  });

  it('contains general document instructions', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('any type of document');
    expect(prompt).not.toContain('government forms'); // should be generalized
  });

  it('includes evidence requirements', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('evidence_snippet');
    expect(prompt).toContain('dependency_reason');
  });

  it('includes conflict detection', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('conflicts');
    expect(prompt).toContain('CONFLICT DETECTION');
  });
});

describe('Item 1.8 sectioning and sanitization fixes', () => {
  it('first --- Page 1 --- at string start is consumed (not duplicated) after sectioning', () => {
    // String starting with --- Page 1 --- without leading newline
    const text = '--- Page 1 ---\n' + 'A'.repeat(30000) + '\n--- Page 2 ---\n' + 'B'.repeat(30000);
    const docs = [{ title: 'Doc', fileName: 'doc.txt', text }];
    const res = buildUserMessage(docs);
    // Should split into sections and not duplicate the page marker
    expect(res.sections).toBe(2);
    // Neither section should have duplicated PAGE 1 markers like "--- PAGE 1 ---\n--- Page 1 ---"
    expect(res.message).not.toMatch(/PAGE 1[\s\S]*PAGE 1/i);
  });

  it('section with 3 pages: label reads Pages 1–3 not Pages 1-2-3', () => {
    // 3 short pages combined into 1 section
    const text = '--- Page 1 ---\nShort 1\n--- Page 2 ---\nShort 2\n--- Page 3 ---\nShort 3';
    // If not exceeding MAX_CHARS_PER_SECTION, sectionDocument returns [doc] unless it triggers sectioning.
    // To trigger sectioning with 3 pages in one section:
    // Have doc > MAX_CHARS_PER_SECTION: say 3 pages of 18k chars each (total 54k) + 1 page of 10k chars (next section)
    const textMulti = '--- Page 1 ---\n' + '1'.repeat(15000) +
      '\n--- Page 2 ---\n' + '2'.repeat(15000) +
      '\n--- Page 3 ---\n' + '3'.repeat(15000) +
      '\n--- Page 4 ---\n' + '4'.repeat(30000);
    const docs = [{ title: 'Multi', fileName: 'm.txt', text: textMulti }];
    const res = buildUserMessage(docs);
    expect(res.sections).toBe(2);
    expect(res.message).toContain('Pages 1–3');
    expect(res.message).not.toContain('Pages 1-2-3');
  });

  it('single paragraph of 70,000 chars → split into ≥ 2 sections', () => {
    const singleHugePara = 'X'.repeat(70000);
    const docs = [{ title: 'Huge', fileName: 'huge.txt', text: singleHugePara }];
    const res = buildUserMessage(docs);
    expect(res.sections).toBeGreaterThanOrEqual(2);
  });

  it('truncated section: result contains both head chars and tail chars', () => {
    // Total chars exceeds MAX_TOTAL_CHARS (150,000)
    // Create text with distinct head and tail
    const head = 'HEAD_START_' + 'H'.repeat(100);
    const tail = 'T'.repeat(100) + '_TAIL_END';
    const middle = 'M'.repeat(160000);
    const docs = [{ title: 'Doc', fileName: 'd.txt', text: head + middle + tail }];
    const res = buildUserMessage(docs);
    expect(res.warnings.some(w => w.type === 'truncation')).toBe(true);
    expect(res.message).toContain('HEAD_START_');
    expect(res.message).toContain('_TAIL_END');
    expect(res.message).toContain('[...middle omitted...]');
  });

  it('sanitizeLabel strips --- and newlines from doc titles', () => {
    expect(sanitizeLabel('My---Title\nWith\r\nBreaks---')).toBe('MyTitle With Breaks');
    expect(sanitizeLabel('Normal Title')).toBe('Normal Title');
    expect(sanitizeLabel(null)).toBe('');
  });
});

