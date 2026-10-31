import { getDocumentProxy, extractText } from "unpdf";

// A page with fewer characters than this is treated as "probably scanned".
const MIN_CHARS_PER_PAGE = 40;

// Ratio threshold: if (letters + digits + Indic) / non-space chars < threshold → low quality
const TEXT_QUALITY_THRESHOLD = 0.6;

// Indic Unicode blocks: Devanagari, Gujarati, Gurmukhi, Bengali, Odia,
// Telugu, Kannada, Malayalam, Tamil, Sinhala (broad coverage)
const INDIC_RE = /[\u0900-\u097F\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F]/;

/**
 * Compute the ratio of "good" characters (letters, digits, Indic) to
 * total non-whitespace characters.  Returns a value in [0, 1].
 */
function textQualityRatio(text) {
  const nonSpace = text.replace(/\s/g, "");
  if (nonSpace.length === 0) return 0;
  let good = 0;
  for (const ch of nonSpace) {
    if (/[\p{L}\p{N}]/u.test(ch) || INDIC_RE.test(ch)) good++;
  }
  return good / nonSpace.length;
}

/**
 * Try to read a PDF's embedded text layer.
 *
 * Returns one of:
 *   { pages, hasTextLayer: true,  text }   → digital PDF, use `text` directly
 *   { pages, hasTextLayer: false, text }   → scanned/image PDF, send to Sarvam OCR
 *   { pages, lowTextQuality: true }        → garbage text (ratio < 0.6), fall back to OCR
 *   { encrypted: true, message }           → password-protected PDF
 */
export async function readPdfTextLayer(buffer) {
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buffer));
  } catch (err) {
    if (isPasswordError(err)) {
      return {
        encrypted: true,
        message:
          "This PDF is password-protected. Remove the password before uploading, or upload the original scanned images instead.",
      };
    }
    throw err;
  }

  let totalPages;
  let perPage;
  try {
    const result = await extractText(pdf, { mergePages: false });
    totalPages = result.totalPages;
    perPage = Array.isArray(result.text) ? result.text : [String(result.text || "")];
  } catch (err) {
    if (isPasswordError(err)) {
      return {
        encrypted: true,
        message:
          "This PDF is password-protected. Remove the password before uploading, or upload the original scanned images instead.",
      };
    }
    throw err;
  } finally {
    // Always destroy the document proxy to release WASM memory
    try {
      await pdf.destroy();
    } catch {
      /* ignore destroy errors */
    }
  }

  // Hard page limit (scanned PDFs > 10 pages are rejected at the OCR stage)
  if (totalPages > 10) {
    throw new Error(
      `PDF has ${totalPages} pages; maximum is 10 for text extraction. ` +
        `For scanned PDFs, split the document before uploading.`
    );
  }

  const pagesWithText = perPage.filter(
    (t) => t.replace(/\s+/g, "").length >= MIN_CHARS_PER_PAGE
  ).length;

  // Mixed PDFs go to OCR as a whole so no page is silently empty.
  const hasTextLayer = totalPages > 0 && pagesWithText / totalPages >= 0.8;

  // Page separators keep source_page reasoning possible in the LLM step.
  const joined = perPage
    .map((t, i) => `--- Page ${i + 1} ---\n${t.trim()}`)
    .join("\n\n");

  // Low text quality → likely garbage OCR or symbol-heavy scan
  if (hasTextLayer) {
    const ratio = textQualityRatio(joined);
    if (ratio < TEXT_QUALITY_THRESHOLD) {
      return { pages: totalPages, lowTextQuality: true };
    }
  }

  return {
    pages: totalPages,
    hasTextLayer,
    text: joined,
  };
}

function isPasswordError(err) {
  const msg = (err?.message || "").toLowerCase();
  const name = (err?.name || "").toLowerCase();
  return (
    name.includes("passwordexception") ||
    msg.includes("passwordexception") ||
    msg.includes("encrypted") ||
    msg.includes("password")
  );
}
