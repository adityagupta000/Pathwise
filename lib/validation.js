// Evidence validation: verify that model-generated source pages and evidence snippets
// are actually present in the parsed documents.

/**
 * Validate that a source_page reference points to an actual page in the document.
 * @param {string} sourcePageStr - e.g., "Page 3", "Pages 1-2", "Full document"
 * @param {number|null} totalPages - total pages in the document
 * @returns {Object} { valid: boolean, reason: string, status: 'verified'|'unverifiable'|'invalid' }
 */
export function validateSourcePage(sourcePageStr, totalPages) {
  if (sourcePageStr === null || sourcePageStr === undefined || sourcePageStr === '') {
    return { valid: false, reason: "Source page is missing", status: 'invalid' };
  }

  const normalized = String(sourcePageStr).trim().toLowerCase();

  // "Full document" references cannot verify specific page claims
  if (normalized.includes("full") || normalized.includes("entire") || normalized.includes("all")) {
    return { 
      valid: false, 
      reason: "Full document reference cannot verify specific page location",
      status: 'unverifiable'
    };
  }

  // If we don't know the page count, we can't validate
  if (typeof totalPages !== 'number' || totalPages === 0) {
    return { valid: false, reason: "Page count unknown, cannot verify", status: 'unverifiable' };
  }

  // Extract page numbers: "Page 3", "Pages 1-3", "p. 5"
  const pageMatch = normalized.match(/(\d+)/g);
  if (!pageMatch || pageMatch.length === 0) {
    return { valid: false, reason: "No page number found in reference", status: 'invalid' };
  }

  const referencedPages = pageMatch.map(Number);
  const maxReferenced = Math.max(...referencedPages);

  if (maxReferenced > totalPages) {
    return {
      valid: false,
      reason: `References page ${maxReferenced} but document only has ${totalPages} pages`,
      status: 'invalid'
    };
  }

  return { valid: true, reason: `Page ${referencedPages.join("-")} exists`, status: 'verified' };
}

/**
 * Split document text into pages based on --- Page N --- markers.
 * @param {string} text
 * @returns {Array<{pageNum: number|null, text: string}>}
 */
export function splitPages(text) {
  if (!text || typeof text !== 'string') {
    return [{ pageNum: null, text: '' }];
  }
  const pageRegex = /(?:^|\n)-{3,}\s*[Pp]age\s+(\d+)\s*-{3,}\n?/g;
  const matches = [...text.matchAll(pageRegex)];
  if (matches.length === 0) {
    return [{ pageNum: null, text }];
  }
  const pages = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const pageNum = parseInt(match[1], 10);
    const startIndex = match.index + match[0].length;
    const endIndex = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const pageContent = text.slice(startIndex, endIndex).trim();
    pages.push({ pageNum, text: pageContent });
  }
  return pages;
}

function normalizeVerbatimQuote(text) {
  if (!text || typeof text !== 'string') return '';
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

export function prepareSource(sourceText) {
  const exactNormalized = normalizeVerbatimQuote(sourceText);
  return { exactNormalized };
}

/**
 * Validate that an evidence snippet appears in the source text.
 * Requires a contiguous, case- and punctuation-preserving source span.
 * @param {string} evidenceSnippet - quoted text from model
 * @param {string} sourceText - full document text
 * @returns {Object} { valid: boolean, reason: string, status: 'found'|'not_found'|'unavailable'|'no_evidence', foundAt: number|null }
 */
export function validateEvidenceSnippet(evidenceSnippet, sourceText, prepared = null) {
  if (!evidenceSnippet || typeof evidenceSnippet !== 'string' || !evidenceSnippet.trim()) {
    // B5 fix: null/empty evidence => not verified (no evidence to check)
    return { valid: false, reason: "No evidence snippet provided", status: 'no_evidence', foundAt: null };
  }

  if (!sourceText || typeof sourceText !== 'string') {
    return { valid: false, reason: "Source text is missing", status: 'unavailable', foundAt: null };
  }

  const normalizedEvidence = normalizeVerbatimQuote(evidenceSnippet);
  const source = prepared || prepareSource(sourceText);
  const normalizedSource = source.exactNormalized;

  // Very short fragments do not provide enough context to establish provenance.
  if (normalizedEvidence.length < 8) {
    return { 
      valid: false, 
      reason: "Evidence snippet too short to verify conclusively", 
      status: 'unavailable',
      foundAt: null 
    };
  }

  const foundAt = normalizedSource.indexOf(normalizedEvidence);
  if (foundAt >= 0) {
    return { valid: true, reason: "Verbatim evidence found contiguously in source text", status: 'found', foundAt };
  }

  return {
    valid: false,
    reason: "Evidence not found in source text",
    status: 'not_found',
    foundAt: null,
  };
}

function validateCitation(quote, citedPage, sourceDoc, pages, hasPerPageText, prepared) {
  const sourceValidation = validateEvidenceSnippet(quote, sourceDoc.text, prepared);
  if (!sourceValidation.valid) {
    return { verification_status: 'unverified', evidence_status: sourceValidation.status, source_page_status: 'unverified' };
  }

  const totalPages = typeof sourceDoc.pages === 'number' && sourceDoc.pages > 0
    ? sourceDoc.pages
    : (hasPerPageText ? pages.length : null);
  if (hasPerPageText || (totalPages !== null && totalPages > 1)) {
    if (!Number.isInteger(citedPage)) {
      return { verification_status: 'unverified', evidence_status: 'found', source_page_status: 'invalid' };
    }
    const pageValidation = validateSourcePage(`Page ${citedPage}`, totalPages);
    if (!pageValidation.valid) {
      return { verification_status: 'unverified', evidence_status: 'found', source_page_status: pageValidation.status };
    }
    if (!hasPerPageText) {
      return { verification_status: 'partially_verified', evidence_status: 'found', source_page_status: 'unverifiable' };
    }
    const page = pages.find((candidate) => candidate.pageNum === citedPage);
    const pageEvidence = page
      ? validateEvidenceSnippet(quote, page.text)
      : { valid: false, status: 'not_found' };
    return {
      verification_status: pageEvidence.valid ? 'verified' : 'unverified',
      evidence_status: pageEvidence.status,
      source_page_status: pageEvidence.valid ? 'verified' : 'invalid',
    };
  }

  if (Number.isInteger(citedPage) && totalPages === 1 && citedPage !== 1) {
    return { verification_status: 'unverified', evidence_status: 'found', source_page_status: 'invalid' };
  }
  return { verification_status: 'verified', evidence_status: 'found', source_page_status: 'unverifiable' };
}

function expectedFieldEvidence(extraction) {
  const expected = [];
  if (typeof extraction.required_action === 'string' && extraction.required_action.trim()) {
    expected.push({ field: 'required_action', value: extraction.required_action });
  }
  for (const value of extraction.required_documents || []) {
    expected.push({ field: 'required_documents', value });
  }
  const deadlineValue = extraction.deadline_text || extraction.deadline_date;
  if (deadlineValue) expected.push({ field: 'deadline', value: deadlineValue });
  for (const requirement of extraction.conditional_requirements || []) {
    expected.push({
      field: 'conditional_trigger',
      value: requirement.condition,
      source_page: requirement.source_page,
    });
    if (requirement.deadline_text && requirement.deadline_text !== deadlineValue) {
      expected.push({
        field: 'deadline',
        value: requirement.deadline_text,
        source_page: requirement.source_page,
      });
    }
    if (requirement.consequence) {
      expected.push({ field: 'consequence', value: requirement.consequence, source_page: requirement.source_page });
    }
  }
  if (extraction.consequence) {
    expected.push({ field: 'consequence', value: extraction.consequence });
  }
  return expected;
}

/**
 * Validate all extractions against their source documents.
 * @param {Array} extractions - extracted document objects
 * @param {Array} sourceDocs - original documents with text and page count
 * @returns {Array} extractions with validation_status added
 */
export function validateExtractions(extractions, sourceDocs) {
  if (!Array.isArray(extractions) || extractions.length === 0) {
    return [];
  }

  // The route assigns doc_index before digitisation. Filenames are user-controlled
  // and may be duplicated, so identity is resolved only by this stable index.
  const sourceMap = new Map();
  const preparedMap = new Map();
  if (Array.isArray(sourceDocs)) {
    sourceDocs.forEach((doc) => {
      if (typeof doc.doc_index === 'number') {
        sourceMap.set(doc.doc_index, doc);
      }
      preparedMap.set(doc, prepareSource(doc.text));
    });
  }

  return extractions.map((ext) => {
    const validation = {
      source_page_valid: false,
      evidence_valid: false,
      source_page_reason: "Not validated",
      evidence_reason: "Not validated",
      source_page_status: 'unverifiable',
      evidence_status: 'unavailable',
      overall_verified: false,
      verification_status: 'unverified',
      source_document_matched: false,
    };

    // Find the source document using the route-owned stable index only.
    let sourceDoc = null;
    if (typeof ext.doc_index === 'number' && sourceMap.has(ext.doc_index)) {
      sourceDoc = sourceMap.get(ext.doc_index);
    }

    if (!sourceDoc) {
      validation.source_page_reason = `Source document not found in uploaded files`;
      validation.evidence_reason = `Source document not found in uploaded files`;
      validation.source_page_status = 'invalid';
      validation.evidence_status = 'unavailable';
      validation.verification_status = 'unverified';
      return {
        ...ext,
        confidence: typeof ext.confidence === 'number' && ext.confidence > 0.4 ? 0.4 : ext.confidence,
        information_type: 'uncertain',
        verification_status: 'unverified',
        field_evidence_status: [],
        field_evidence_coverage: { verified: 0, required: expectedFieldEvidence(ext).length, ratio: 0 },
        validation_status: validation,
      };
    }

    validation.source_document_matched = true;

    // Split pages from document text
    const pages = splitPages(sourceDoc.text);
    const hasPerPerPageText = pages.length > 1 || (pages.length === 1 && pages[0].pageNum !== null);
    const totalPages = typeof sourceDoc.pages === 'number' && sourceDoc.pages > 0
      ? sourceDoc.pages
      : (hasPerPerPageText ? pages.length : null);

    // Validate source page
    const pageValidation = validateSourcePage(ext.source_page, totalPages);
    validation.source_page_valid = pageValidation.valid;
    validation.source_page_reason = pageValidation.reason;
    validation.source_page_status = pageValidation.status;

    // Validate evidence snippet in document text
    const prepared = preparedMap.get(sourceDoc) || prepareSource(sourceDoc.text);
    const evidenceValidation = validateEvidenceSnippet(ext.evidence_snippet, sourceDoc.text, prepared);
    validation.evidence_valid = evidenceValidation.valid;
    validation.evidence_reason = evidenceValidation.reason;
    validation.evidence_status = evidenceValidation.status;

    const fieldEvidenceStatus = (ext.field_evidence || []).map((citation) => ({
      ...citation,
      ...validateCitation(citation.quote, citation.source_page, sourceDoc, pages, hasPerPerPageText, prepared),
    }));
    const expectedEvidence = expectedFieldEvidence(ext);
    const verifiedEvidence = expectedEvidence.filter((expected) =>
      fieldEvidenceStatus.some((citation) =>
        citation.field === expected.field &&
        citation.value === expected.value &&
        (expected.source_page === undefined || citation.source_page === expected.source_page) &&
        citation.verification_status === 'verified'
      )
    ).length;
    const fieldEvidenceCoverage = {
      verified: verifiedEvidence,
      required: expectedEvidence.length,
      ratio: expectedEvidence.length ? Number((verifiedEvidence / expectedEvidence.length).toFixed(3)) : 1,
    };
    const conditionalRequirements = (ext.conditional_requirements || []).map((requirement) => ({
      ...requirement,
      ...validateCitation(requirement.evidence_quote, requirement.source_page, sourceDoc, pages, hasPerPerPageText, prepared),
    }));

    let verification_status = 'unverified';

    if (!ext.evidence_snippet) {
      // B5: No evidence snippet at all → unverified (not verified)
      verification_status = 'unverified';
    } else if (!evidenceValidation.valid) {
      verification_status = 'unverified';
    } else {
      // Evidence found — now check page claim
      const hasPageConcept = hasPerPerPageText || (totalPages !== null && totalPages > 0);
      const hasPageClaim = ext.source_page && 
        !String(ext.source_page).toLowerCase().includes('full') &&
        !String(ext.source_page).toLowerCase().includes('entire');

      if (!hasPageConcept) {
        // Text doc (no pages) — evidence found, no page to check: verified.
        verification_status = 'verified';
      } else if (!hasPageClaim) {
        // Evidence found, no specific page claim → verified
        verification_status = 'verified';
      } else if (!pageValidation.valid) {
        verification_status = 'unverified';
      } else if (hasPerPerPageText) {
        // Per-page text available — check evidence is on cited page
        const match = String(ext.source_page).match(/\d+/);
        const citedPage = match ? parseInt(match[0], 10) : null;
        const pageObj = citedPage ? pages.find((p) => p.pageNum === citedPage) : null;

        if (pageObj) {
          const onPage = validateEvidenceSnippet(ext.evidence_snippet, pageObj.text);
          if (onPage.valid && onPage.status !== 'no_evidence') {
            verification_status = 'verified';
          } else {
            verification_status = 'unverified';
            validation.source_page_valid = false;
            validation.source_page_reason = `Evidence found in document, but not on cited page ${citedPage}`;
          }
        } else {
          // Page claimed but page text not found
          verification_status = 'unverified';
        }
      } else {
        // Page number claimed, totalPages known, but no per-page text to verify against
        verification_status = 'partially_verified';
      }
    }

    validation.overall_verified = (verification_status === 'verified');
    validation.verification_status = verification_status;

    let confidence = ext.confidence;
    let information_type = ext.information_type;
    if (verification_status === 'unverified') {
      if (typeof confidence === 'number' && confidence > 0.4) {
        confidence = 0.4;
      }
      information_type = 'uncertain';
    }

    return {
      ...ext,
      conditional_requirements: conditionalRequirements,
      confidence,
      information_type,
      verification_status,
      field_evidence_status: fieldEvidenceStatus,
      field_evidence_coverage: fieldEvidenceCoverage,
      validation_status: validation,
    };
  });
}

/**
 * Generate a user-facing summary of validation issues.
 * @param {Array} extractions - validated extractions
 * @returns {Array} list of warnings
 */
export function getValidationWarnings(extractions) {
  const warnings = [];

  if (!Array.isArray(extractions)) {
    return warnings;
  }

  const unverified = extractions.filter(
    (ext) => ext.verification_status === 'unverified'
  );

  if (unverified.length === 0) {
    return warnings;
  }

  unverified.forEach((ext) => {
    const v = ext.validation_status;
    if (!v) return;

    const issues = [];
    if (!v.source_page_valid) issues.push(v.source_page_reason);
    if (!v.evidence_valid) issues.push(v.evidence_reason);

    if (issues.length > 0) {
      warnings.push({
        action: ext.required_action,
        confidence: ext.confidence,
        issues,
      });
    }
  });

  return warnings;
}
