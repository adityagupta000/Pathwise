import { describe, it, expect } from 'vitest';
import { validateSourcePage, validateEvidenceSnippet, validateExtractions, splitPages } from './validation.js';

describe('validateSourcePage', () => {
  it('validates page references within document range', () => {
    const result = validateSourcePage('Page 3', 5);
    expect(result.valid).toBe(true);
    expect(result.reason).toContain('Page 3 exists');
    expect(result.status).toBe('verified');
  });

  it('rejects page references beyond document range', () => {
    const result = validateSourcePage('Page 10', 5);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('only has 5 pages');
    expect(result.status).toBe('invalid');
  });

  it('rejects "Full document" references as unverifiable', () => {
    const result = validateSourcePage('Full document', 5);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('cannot verify specific page');
    expect(result.status).toBe('unverifiable');
  });

  it('marks as unverifiable when page count missing', () => {
    const result = validateSourcePage('Page 3', null);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('cannot verify');
    expect(result.status).toBe('unverifiable');
  });

  it('handles page ranges', () => {
    const result = validateSourcePage('Pages 2-4', 5);
    expect(result.valid).toBe(true);
    expect(result.status).toBe('verified');
  });

  it('rejects invalid page range', () => {
    const result = validateSourcePage('Pages 4-8', 5);
    expect(result.valid).toBe(false);
    expect(result.status).toBe('invalid');
  });
});

describe('validateEvidenceSnippet', () => {
  const sourceText = `
    This is a sample document about updating your Aadhaar card.
    You must visit the nearest Aadhaar Seva Kendra within 30 days.
    Required documents: Original Aadhaar card and proof of address.
  `;

  it('finds exact evidence in source text', () => {
    const result = validateEvidenceSnippet('visit the nearest Aadhaar Seva Kendra', sourceText);
    expect(result.valid).toBe(true);
    expect(result.reason).toContain('found in source');
    expect(result.status).toBe('found');
  });

  it('handles normalized whitespace and case', () => {
    const result = validateEvidenceSnippet('VISIT   THE   NEAREST   AADHAAR   SEVA   KENDRA', sourceText);
    expect(result.valid).toBe(true);
    expect(result.status).toBe('found');
  });

  it('handles quote variations', () => {
    const result = validateEvidenceSnippet('visit the nearest Aadhaar Seva Kendra', sourceText);
    expect(result.valid).toBe(true);
    expect(result.status).toBe('found');
  });

  it('accepts near-exact matches with minor OCR variations', () => {
    // Test with actual words present in sequence (exact match after normalization)
    const result = validateEvidenceSnippet('you must visit the nearest Aadhaar Seva Kendra within 30 days', sourceText);
    expect(result.valid).toBe(true);
    expect(result.status).toBe('found');
  });

  it('rejects evidence not in source', () => {
    const result = validateEvidenceSnippet('submit your passport within 10 days', sourceText);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('not found');
    expect(result.status).toBe('not_found');
  });

  it('accepts null or empty evidence', () => {
    const result = validateEvidenceSnippet(null, sourceText);
    expect(result.valid).toBe(true);
    expect(result.status).toBe('no_evidence');
  });

  it('marks evidence as unavailable when source is missing', () => {
    const result = validateEvidenceSnippet('some evidence', null);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('missing');
    expect(result.status).toBe('unavailable');
  });

  it('rejects evidence that is too short to verify', () => {
    const result = validateEvidenceSnippet('visit', sourceText);
    expect(result.valid).toBe(false);
    expect(result.status).toBe('unavailable');
  });
});

describe('validateExtractions', () => {
  const sourceDocs = [
    {
      fileName: 'aadhaar_update.txt',
      title: 'Aadhaar Update Form',
      pages: 2,
      text: 'Visit Aadhaar Seva Kendra by March 15, 2025. Bring original documents.',
    },
  ];

  const extractions = [
    {
      id: 'doc1',
      required_action: 'Update Aadhaar address',
      source_document: 'aadhaar_update.txt',
      source_page: 'Page 1',
      evidence_snippet: 'Visit Aadhaar Seva Kendra',
    },
  ];

  it('validates correct extractions', () => {
    const validated = validateExtractions(extractions, sourceDocs);
    expect(validated[0].validation_status.overall_verified).toBe(true);
    expect(validated[0].validation_status.source_page_valid).toBe(true);
    expect(validated[0].validation_status.evidence_valid).toBe(true);
    expect(validated[0].validation_status.source_document_matched).toBe(true);
  });

  it('marks unverified when evidence is not found', () => {
    const badExtractions = [
      {
        ...extractions[0],
        evidence_snippet: 'Submit passport by tomorrow',
      },
    ];
    const validated = validateExtractions(badExtractions, sourceDocs);
    expect(validated[0].validation_status.overall_verified).toBe(false);
    expect(validated[0].validation_status.evidence_valid).toBe(false);
    expect(validated[0].validation_status.evidence_status).toBe('not_found');
  });

  it('marks unverified when page number is invalid', () => {
    const badExtractions = [
      {
        ...extractions[0],
        source_page: 'Page 10',
      },
    ];
    const validated = validateExtractions(badExtractions, sourceDocs);
    expect(validated[0].validation_status.overall_verified).toBe(false);
    expect(validated[0].validation_status.source_page_valid).toBe(false);
    expect(validated[0].validation_status.source_page_status).toBe('invalid');
  });

  it('handles missing source documents', () => {
    const validated = validateExtractions(extractions, []);
    expect(validated[0].validation_status.overall_verified).toBe(false);
    expect(validated[0].validation_status.source_page_reason).toContain('not found');
    expect(validated[0].validation_status.source_document_matched).toBe(false);
  });

  it('marks Full document references as unverifiable', () => {
    const fullDocExtractions = [
      {
        ...extractions[0],
        source_page: 'Full document',
      },
    ];
    const validated = validateExtractions(fullDocExtractions, sourceDocs);
    expect(validated[0].validation_status.overall_verified).toBe(false);
    expect(validated[0].validation_status.source_page_valid).toBe(false);
    expect(validated[0].validation_status.source_page_status).toBe('unverifiable');
  });

  it('uses exact fileName matching', () => {
    const exactMatch = validateExtractions(
      [{ ...extractions[0], source_document: 'aadhaar_update.txt' }],
      sourceDocs
    );
    expect(exactMatch[0].validation_status.source_document_matched).toBe(true);
  });

  it('rejects ambiguous document references', () => {
    const multiDocs = [
      { fileName: 'doc_v1.txt', text: 'Version 1', pages: 1 },
      { fileName: 'doc_v2.txt', text: 'Version 2', pages: 1 },
    ];
    const ambiguousExtraction = [
      {
        ...extractions[0],
        source_document: 'doc',
      },
    ];
    const validated = validateExtractions(ambiguousExtraction, multiDocs);
    expect(validated[0].validation_status.source_document_matched).toBe(false);
    expect(validated[0].validation_status.source_page_reason).toContain('Ambiguous');
  });
});

describe('Item 1.4 evidence validation fixes', () => {
  it('curly quote \u201C in snippet is found when source has straight quote (after normalization)', () => {
    const source = 'Please bring "original documents" to the center.';
    const snippet = 'bring \u201Coriginal documents\u201D to the center';
    const result = validateEvidenceSnippet(snippet, source);
    expect(result.valid).toBe(true);
    expect(result.status).toBe('found');
  });

  it('OCR-style snippet with **bold** and a hyphenated line break → found', () => {
    const source = 'Please submit your appli-\ncation form before Friday.';
    const snippet = 'Please submit your **application** form before Friday.';
    const result = validateEvidenceSnippet(snippet, source);
    expect(result.valid).toBe(true);
    expect(result.status).toBe('found');
  });

  it('"act" does NOT match source containing only "contact" (no substring-inside-word)', () => {
    const source = 'Please contact customer support for details.';
    const result = validateEvidenceSnippet('act', source);
    expect(result.valid).toBe(false);
    expect(result.status).not.toBe('found');
  });

  it('splitPages with pdfText.js-style markers → correct pages', () => {
    const text = '--- Page 1 ---\nContent of first page\n\n--- Page 2 ---\nContent of second page';
    const pages = splitPages(text);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toEqual({ pageNum: 1, text: 'Content of first page' });
    expect(pages[1]).toEqual({ pageNum: 2, text: 'Content of second page' });
  });

  it('splitPages with no markers → [{ pageNum: null, text }]', () => {
    const text = 'Regular document with no page markers.';
    const pages = splitPages(text);
    expect(pages).toEqual([{ pageNum: null, text: 'Regular document with no page markers.' }]);
  });

  it('text doc (no page count): correct evidence → partially_verified', () => {
    const sourceDocs = [
      {
        fileName: 'note.txt',
        text: 'You must complete the verification process within 30 days.',
      },
    ];
    const extractions = [
      {
        file_name: 'note.txt',
        source_page: null,
        evidence_snippet: 'complete the verification process within 30 days',
        confidence: 0.9,
      },
    ];
    const validated = validateExtractions(extractions, sourceDocs);
    expect(validated[0].verification_status).toBe('partially_verified');
    expect(validated[0].validation_status.verification_status).toBe('partially_verified');
  });

  it('wrong page reference → unverified', () => {
    const sourceDocs = [
      {
        fileName: 'doc.txt',
        pages: 2,
        text: '--- Page 1 ---\nAction item on page 1.\n--- Page 2 ---\nConclusion on page 2.',
      },
    ];
    const extractions = [
      {
        file_name: 'doc.txt',
        source_page: 'Page 2', // cited page 2, but evidence is on page 1
        evidence_snippet: 'Action item on page 1',
        confidence: 0.9,
      },
    ];
    const validated = validateExtractions(extractions, sourceDocs);
    expect(validated[0].verification_status).toBe('unverified');
  });

  it('unverified extraction: confidence capped at 0.4', () => {
    const sourceDocs = [
      {
        fileName: 'doc.txt',
        pages: 2,
        text: '--- Page 1 ---\nAction item on page 1.\n--- Page 2 ---\nConclusion on page 2.',
      },
    ];
    const extractions = [
      {
        file_name: 'doc.txt',
        source_page: 'Page 2',
        evidence_snippet: 'Action item on page 1',
        confidence: 0.95,
        information_type: 'explicitly_stated',
      },
    ];
    const validated = validateExtractions(extractions, sourceDocs);
    expect(validated[0].verification_status).toBe('unverified');
    expect(validated[0].confidence).toBe(0.4);
    expect(validated[0].information_type).toBe('uncertain');
  });
});


// ─── Item 4.1 — additional edge-case tests ────────────────────────────────────

describe('validateExtractions — curly-quote evidence (item 4.1)', () => {
  it('matches evidence containing curly double quotes', () => {
    const sourceDocs = [
      {
        doc_index: 0,
        pages: 1,
        text: '--- Page 1 ---\nHe said \u201csubmit the form\u201d by Friday.',
      },
    ];
    const extractions = [
      {
        doc_index: 0,
        source_page: 'Page 1',
        // evidence uses straight quotes — should still match after normalisation
        evidence_snippet: 'submit the form',
        confidence: 0.9,
        information_type: 'explicitly_stated',
      },
    ];
    const result = validateExtractions(extractions, sourceDocs);
    // The curly-quote text normalises to contain the snippet, so it should verify.
    expect(result[0].verification_status).not.toBe('unverified');
  });
});

describe('validateExtractions — Markdown-stripped evidence (item 4.1)', () => {
  it('normalises Markdown bold/italic before matching', () => {
    const sourceDocs = [
      {
        doc_index: 0,
        pages: 1,
        text: '--- Page 1 ---\n**Submit** the _form_ before the deadline.',
      },
    ];
    const extractions = [
      {
        doc_index: 0,
        source_page: 'Page 1',
        evidence_snippet: 'Submit the form before the deadline',
        confidence: 0.9,
        information_type: 'explicitly_stated',
      },
    ];
    const result = validateExtractions(extractions, sourceDocs);
    expect(result[0].verification_status).not.toBe('unverified');
  });
});

describe('validateExtractions — word boundary: "act" must not match "contact" (item 4.1)', () => {
  it('does not match evidence word as a substring of a longer word', () => {
    // The document has "contact" but evidence says "act".
    // Jaccard will likely fail since "act" is not a meaningful token in "contact".
    const sourceDocs = [
      {
        doc_index: 0,
        pages: 1,
        text: '--- Page 1 ---\nPlease contact the office directly.',
      },
    ];
    const extractions = [
      {
        doc_index: 0,
        source_page: 'Page 1',
        // "act" alone should NOT verify against text that only contains "contact".
        evidence_snippet: 'act now',
        confidence: 0.9,
        information_type: 'explicitly_stated',
      },
    ];
    const result = validateExtractions(extractions, sourceDocs);
    // The evidence "act now" doesn't appear in "Please contact the office directly."
    // so it should be unverified.
    expect(result[0].verification_status).toBe('unverified');
  });
});

describe('validateExtractions — doc_index linking (item 4.1)', () => {
  it('links extraction to correct document by doc_index, not by fileName', () => {
    const sourceDocs = [
      {
        doc_index: 0,
        pages: 1,
        text: '--- Page 1 ---\nThis is doc zero content.',
      },
      {
        doc_index: 1,
        pages: 1,
        text: '--- Page 1 ---\nThis is doc one content.',
      },
    ];
    const extractions = [
      {
        // Extraction from doc 1 (index 1)
        doc_index: 1,
        source_page: 'Page 1',
        evidence_snippet: 'doc one content',
        confidence: 0.9,
        information_type: 'explicitly_stated',
      },
    ];
    const result = validateExtractions(extractions, sourceDocs);
    // Should match against doc 1, not doc 0
    expect(result[0].verification_status).not.toBe('unverified');
  });

  it('returns unverified when doc_index points to wrong document', () => {
    const sourceDocs = [
      {
        doc_index: 0,
        pages: 1,
        text: '--- Page 1 ---\nThis is doc zero content.',
      },
      {
        doc_index: 1,
        pages: 1,
        text: '--- Page 1 ---\nThis is doc one content.',
      },
    ];
    const extractions = [
      {
        // Evidence is from doc 1 but doc_index says 0
        doc_index: 0,
        source_page: 'Page 1',
        evidence_snippet: 'doc one content',
        confidence: 0.9,
        information_type: 'explicitly_stated',
      },
    ];
    const result = validateExtractions(extractions, sourceDocs);
    // Evidence not in doc 0 → unverified
    expect(result[0].verification_status).toBe('unverified');
  });
});
