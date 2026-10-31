import { MAX_CHARS_PER_SECTION, MAX_TOTAL_CHARS } from './limits.js';

// Extraction schema + prompt (unchanged from the hackathon version, except the date injection below).

export const EXTRACTION_SCHEMA = {
  name: "document_extractions",
  strict: true,
  schema: {
    type: "object",
    properties: {
      extractions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            document_type: { type: "string" },
            organization: { type: ["string", "null"] },
            title: { type: "string" },
            required_action: { type: "string" },
            required_documents: {
              type: "array",
              items: { type: "string" },
            },
            prerequisites: {
              type: "array",
              items: { type: "string" },
            },
            deadline: { type: ["string", "null"] },
            deadline_days: { type: ["integer", "null"] },
            appointment_date: { type: ["string", "null"] },
            appointment_time: { type: ["string", "null"] },
            office_location: { type: ["string", "null"] },
            estimated_time: { type: ["string", "null"] },
            fees: { type: ["string", "null"] },
            reference_number: { type: ["string", "null"] },
            government_department: { type: ["string", "null"] },
            consequence: { type: ["string", "null"] },
            confidence: { type: "number" },
            source_document: { type: "string" },
            source_page: { type: "string" },
            dependency_reason: { type: "string" },
            evidence_snippet: { type: ["string", "null"] },
            information_type: { type: "string" },
            conflicts: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: [
            "document_type",
            "organization",
            "title",
            "required_action",
            "required_documents",
            "prerequisites",
            "deadline",
            "deadline_days",
            "estimated_time",
            "confidence",
            "source_document",
            "source_page",
            "dependency_reason",
            "evidence_snippet",
            "information_type",
            "conflicts",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["extractions"],
    additionalProperties: false,
  },
};

const BASE_SYSTEM_PROMPT = `You are an expert document analysis AI that extracts structured, actionable information from any type of document. You analyze MULTIPLE documents simultaneously to identify relationships, dependencies, and conflicts between them.

Your task: extract structured information from each document AND detect relationships BETWEEN documents.

DOCUMENT TYPES YOU SUPPORT:
- Official notices (government, institutional, corporate)
- Contracts and agreements
- Invoices and billing statements
- Medical records and prescriptions
- Legal documents
- Educational documents (transcripts, certificates)
- Property documents
- Insurance policies
- Any document containing actionable information

For each document, extract:

1. **document_type**: Category (e.g., "Tax Notice", "Lease Agreement", "Medical Report", "Job Offer")
2. **organization**: Entity that created/issued the document (null if personal document)
3. **title**: Clear descriptive title
4. **required_action**: Primary action required, with specifics (location, date, time if mentioned)
5. **required_documents**: Documents needed to complete the action (empty array if none)
6. **prerequisites**: Actions that MUST be completed BEFORE this action. Look for explicit requirements like "requires", "must have", "depends on", "cannot proceed until". Match against other uploaded documents when referenced.
7. **deadline**: Explicit deadline with date/time if mentioned (null if none)
8. **deadline_days**: Days until deadline from today (null if no deadline)
9. **appointment_date**: Specific appointment/meeting date if mentioned (YYYY-MM-DD or null)
10. **appointment_time**: Specific appointment/meeting time if mentioned (HH:MM or null)
11. **office_location**: Physical location where action must be taken (null if not specified)
12. **estimated_time**: Estimated time to complete the action (null if unknown)
13. **fees**: Any fees, costs, or amounts mentioned (null if none)
14. **reference_number**: Reference/case/account/tracking number (null if none)
15. **government_department**: Government department if applicable (null otherwise)
16. **consequence**: What happens if action is not completed (null if not stated)
17. **confidence**: Your confidence in the extraction accuracy (0.0 to 1.0)
18. **source_document**: Document name and reference number for traceability
19. **source_page**: Page number where information was found (or "Full document")
20. **dependency_reason**: WHY prerequisites exist, with evidence from the document. Use "No dependencies detected" if none.
21. **evidence_snippet**: SHORT direct quote (1-2 sentences max) supporting the action/deadline (null if no specific quote)
22. **information_type**: How certain is this information? Use one of:
    - "explicitly_stated": Directly stated in the document
    - "clearly_inferred": Logically derived from stated information
    - "uncertain": Ambiguous or unclear in source document
23. **conflicts**: List any contradictions with OTHER uploaded documents (dates, amounts, requirements). Empty array if none.

MULTI-DOCUMENT REASONING:
- Analyze ALL documents together as a set
- Detect when documents reference each other
- Find blocking dependencies (Action A must complete before Action B can start)
- Identify conflicting deadlines, requirements, or instructions
- Match prerequisites to actual actions in other documents
- Note when one document provides information needed for another

CRITICAL RULES:
- NEVER hallucinate information not present in the documents
- If information is unavailable, use null or empty array
- Distinguish between "explicitly stated", "clearly inferred", and "uncertain"
- Extract EXACT text for dates, times, amounts, locations
- Every prerequisite MUST reference actual content from uploaded documents
- Quote actual document text for evidence_snippet (short quotes only)
- If unsure about any field, lower the confidence score
- Mark information as "uncertain" when ambiguous
- Detect and report conflicts between documents explicitly

DEPENDENCY DETECTION EXAMPLES:
- Document explicitly states: "Submit proof of address update before processing" - creates dependency
- Document mentions another document by name or reference number - potential dependency
- Document requires output from another document's action - creates dependency
- Two documents mention same appointment/office - potential relationship but not necessarily dependency

CONFLICT DETECTION EXAMPLES:
- Document A says deadline is March 15, Document B says March 20 for the same action
- Document A requires 3 copies, Document B requires 2 copies of the same item
- Document A lists fee as $100, Document B lists fee as $150

Return only accurate, verifiable, evidence-based extractions. When in doubt, mark as uncertain and explain in the evidence_snippet why.`;

/** The model can't know today's date, so deadline_days would be a guess without this. */
export function buildSystemPrompt(now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  return `${BASE_SYSTEM_PROMPT}\n\nTODAY'S DATE: ${today}. Compute deadline_days relative to this date. If no deadline is stated or deadline is uncertain, use null for deadline_days.`;
}

export function sanitizeLabel(str) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/[\r\n]+/g, ' ').replaceAll('---', '').trim();
}

/**
 * Section a long document into manageable chunks while preserving page boundaries.
 * @param {Object} doc - document with text and metadata
 * @returns {Array} array of document sections
 */
function sectionDocument(doc) {
  const text = doc.text || "";
  
  if (text.length <= MAX_CHARS_PER_SECTION) {
    return [doc]; // No sectioning needed
  }

  // Split on page markers if present (from PDF/OCR output)
  const pageMarkerPattern = /(?:^|\n)-{3,}\s*[Pp]age\s+\d+\s*-{3,}\n?/gim;
  let pages = text.split(pageMarkerPattern);
  if (pages.length > 1 && pages[0].trim() === "") {
    pages.shift();
  }
  
  if (pages.length === 1) {
    // No page markers - split on paragraphs
    const sections = [];
    let currentSection = "";
    const paragraphs = text.split(/\n\n+/);
    
    for (const para of paragraphs) {
      if ((currentSection + para).length > MAX_CHARS_PER_SECTION && currentSection) {
        sections.push(currentSection.trim());
        currentSection = para;
      } else {
        currentSection += (currentSection ? "\n\n" : "") + para;
      }
    }
    
    if (currentSection.trim()) {
      sections.push(currentSection.trim());
    }

    // Fallback: split any section > MAX_CHARS_PER_SECTION by characters
    const finalSections = [];
    for (const s of sections) {
      if (s.length > MAX_CHARS_PER_SECTION) {
        for (let i = 0; i < s.length; i += MAX_CHARS_PER_SECTION) {
          finalSections.push(s.slice(i, i + MAX_CHARS_PER_SECTION));
        }
      } else {
        finalSections.push(s);
      }
    }
    
    return finalSections.map((sectionText, idx) => ({
      ...doc,
      text: sectionText,
      _section: idx + 1,
      _totalSections: finalSections.length,
      _originalLength: text.length,
    }));
  }

  // Split by pages, grouping to stay under limit
  const sections = [];
  let currentSection = "";
  let currentPages = [];
  
  pages.forEach((pageText, idx) => {
    const pageNum = idx + 1;
    const pageWithMarker = `--- PAGE ${pageNum} ---\n${pageText}`;
    
    if ((currentSection + pageWithMarker).length > MAX_CHARS_PER_SECTION && currentSection) {
      sections.push({
        text: currentSection.trim(),
        pages: currentPages,
      });
      currentSection = pageWithMarker;
      currentPages = [pageNum];
    } else {
      currentSection += (currentSection ? "\n" : "") + pageWithMarker;
      currentPages.push(pageNum);
    }
  });
  
  if (currentSection.trim()) {
    sections.push({
      text: currentSection.trim(),
      pages: currentPages,
    });
  }
  
  return sections.map((section, idx) => ({
    ...doc,
    text: section.text,
    _section: idx + 1,
    _totalSections: sections.length,
    _pages: section.pages,
    _originalLength: text.length,
  }));
}

export function buildUserMessage(docs) {
  const messages = [];
  const warnings = [];
  
  // Section long documents
  const allSections = [];
  docs.forEach(doc => {
    const sections = sectionDocument(doc);
    if (sections.length > 1) {
      warnings.push({
        type: 'sectioned',
        fileName: doc.fileName || doc.title,
        originalLength: doc.text?.length || 0,
        sections: sections.length,
        message: `Document split into ${sections.length} sections for processing`,
      });
    }
    allSections.push(...sections);
  });
  
  // Check total size
  const totalChars = allSections.reduce((sum, sec) => sum + (sec.text?.length || 0), 0);
  
  if (totalChars > MAX_TOTAL_CHARS) {
    // Proportionally reduce sections
    const reductionFactor = MAX_TOTAL_CHARS / totalChars;
    allSections.forEach(section => {
      const originalLen = section.text?.length || 0;
      const targetLen = Math.floor(originalLen * reductionFactor);
      if (originalLen > targetLen) {
        const marker = "\n\n[...middle omitted...]\n\n";
        if (targetLen <= marker.length) {
          section.text = section.text.slice(0, targetLen);
        } else {
          const headLen = Math.floor(targetLen * 0.4);
          let tailLen = Math.floor(targetLen * 0.4);
          if (headLen + marker.length + tailLen > targetLen) {
            tailLen = Math.max(0, targetLen - marker.length - headLen);
          }
          section.text = section.text.slice(0, headLen) + marker + section.text.slice(section.text.length - tailLen);
        }
        warnings.push({
          type: 'truncation',
          fileName: section.fileName || section.title,
          section: section._section,
          originalLength: originalLen,
          truncatedLength: targetLen,
          message: `Section ${section._section} truncated due to total size limit`,
        });
      }
    });
  }
  
  allSections.forEach((section, idx) => {
    let pageLabel = '';
    if (section._pages && section._pages.length > 0) {
      if (section._pages.length === 1) {
        pageLabel = `, Pages ${section._pages[0]}`;
      } else {
        pageLabel = `, Pages ${section._pages[0]}–${section._pages[section._pages.length - 1]}`;
      }
    }
    const sectionInfo = section._section 
      ? ` (Section ${section._section}/${section._totalSections}${pageLabel})`
      : '';
    
    const safeTitle = sanitizeLabel(section.title) || "Untitled";
    const safeFilename = sanitizeLabel(section.fileName) || "Unknown";
    const safeSource = sanitizeLabel(section.source) || "Unknown";

    messages.push(
      `--- DOCUMENT ${idx + 1} ---\nTitle: ${safeTitle}${sectionInfo}\nFilename: ${safeFilename}\nSource: ${safeSource}\nContent:\n${section.text}\n---`
    );
  });
  
  return {
    message: messages.join("\n\n"),
    warnings,
    sections: allSections.length,
  };
}
