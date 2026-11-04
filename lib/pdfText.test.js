import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock unpdf before importing pdfText
vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(),
  extractText: vi.fn(),
}));

import { getDocumentProxy, extractText } from "unpdf";
import { readPdfTextLayer } from "./pdfText.js";

/** Helper: build a mock pdf proxy with a destroy spy. */
function makePdf() {
  return { destroy: vi.fn().mockResolvedValue(undefined) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("lib/pdfText.js – readPdfTextLayer()", () => {
  it("returns hasTextLayer:true for a digital PDF with good text", async () => {
    const pdf = makePdf();
    getDocumentProxy.mockResolvedValue(pdf);
    // 2 pages, each with plenty of good ASCII text
    const page1 = "Hello world this is a test. ".repeat(10); // 280 chars
    const page2 = "Document content for processing. ".repeat(8); // 256 chars
    extractText.mockResolvedValue({ totalPages: 2, text: [page1, page2] });

    const result = await readPdfTextLayer(Buffer.alloc(4));
    expect(result.hasTextLayer).toBe(true);
    expect(result.pages).toBe(2);
    expect(result.text).toContain("--- Page 1 ---");
    expect(result.text).toContain("--- Page 2 ---");
    expect(pdf.destroy).toHaveBeenCalledOnce();
  });

  it("returns hasTextLayer:false for a scanned PDF (empty pages)", async () => {
    const pdf = makePdf();
    getDocumentProxy.mockResolvedValue(pdf);
    // Both pages are blank (scanned image PDF, no text layer)
    extractText.mockResolvedValue({ totalPages: 2, text: ["", ""] });

    const result = await readPdfTextLayer(Buffer.alloc(4));
    expect(result.hasTextLayer).toBe(false);
    expect(result.pages).toBe(2);
    expect(pdf.destroy).toHaveBeenCalledOnce();
  });

  it("returns encrypted:true when getDocumentProxy throws password error", async () => {
    getDocumentProxy.mockRejectedValue(new Error("PasswordException: password required"));

    const result = await readPdfTextLayer(Buffer.alloc(4));
    expect(result.encrypted).toBe(true);
    expect(typeof result.message).toBe("string");
  });

  it("returns encrypted:true when extractText throws password error", async () => {
    const pdf = makePdf();
    getDocumentProxy.mockResolvedValue(pdf);
    extractText.mockRejectedValue(new Error("PDF is encrypted"));

    const result = await readPdfTextLayer(Buffer.alloc(4));
    expect(result.encrypted).toBe(true);
    // destroy should still be called in finally
    expect(pdf.destroy).toHaveBeenCalledOnce();
  });

  it("throws for non-password errors from getDocumentProxy", async () => {
    getDocumentProxy.mockRejectedValue(new Error("Corrupt PDF structure"));

    await expect(readPdfTextLayer(Buffer.alloc(4))).rejects.toThrow("Corrupt PDF structure");
  });

  it('returns text for a digital PDF with >10 pages (no page limit for text-layer PDFs)', async () => {
    const pdf = makePdf();
    getDocumentProxy.mockResolvedValue(pdf);
    // Digital PDFs with text layers are not subject to the OCR page limit.
    const pages = Array(11).fill("Hello world this is a test. ".repeat(5));
    extractText.mockResolvedValue({ totalPages: 11, text: pages });

    const result = await readPdfTextLayer(Buffer.alloc(4));
    expect(result.hasTextLayer).toBe(true);
    expect(result.pages).toBe(11);
    expect(pdf.destroy).toHaveBeenCalledOnce();
  });

  it("returns lowTextQuality:true when text is mostly garbage symbols", async () => {
    const pdf = makePdf();
    getDocumentProxy.mockResolvedValue(pdf);
    // Pages full of symbols/punctuation — low letter ratio
    const garbagePage = "!@#$%^&*()_+|<>?~`[]{}\\;':\",./ ".repeat(20);
    extractText.mockResolvedValue({ totalPages: 1, text: [garbagePage] });

    const result = await readPdfTextLayer(Buffer.alloc(4));
    expect(result.lowTextQuality).toBe(true);
    expect(pdf.destroy).toHaveBeenCalledOnce();
  });

  it("always calls pdf.destroy() even when extractText fails", async () => {
    const pdf = makePdf();
    getDocumentProxy.mockResolvedValue(pdf);
    extractText.mockRejectedValue(new Error("Corrupt xref"));

    await expect(readPdfTextLayer(Buffer.alloc(4))).rejects.toThrow("Corrupt xref");
    expect(pdf.destroy).toHaveBeenCalledOnce();
  });

  it("handles extractText returning a string instead of array", async () => {
    const pdf = makePdf();
    getDocumentProxy.mockResolvedValue(pdf);
    const bigText = "This is a single string. ".repeat(20);
    extractText.mockResolvedValue({ totalPages: 1, text: bigText });

    const result = await readPdfTextLayer(Buffer.alloc(4));
    expect(result.pages).toBe(1);
    expect(result.text).toContain("--- Page 1 ---");
  });
});
