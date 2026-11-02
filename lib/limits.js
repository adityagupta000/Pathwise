// lib/limits.js — single source of truth for all size limits.
export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;   // 25 MB per file
export const MAX_TOTAL_BYTES = 60 * 1024 * 1024;  // 60 MB total upload
export const MAX_CHARS_PER_SECTION = 50_000;       // per LLM section
export const MAX_TOTAL_CHARS = 150_000;            // total prompt chars
export const MAX_SECTIONS_PER_DOC = 6;             // max Stage A calls per document
export const TRANSLATE_CHUNK = 1_800;              // sarvam-translate:v1 chunk size
export const MAX_TRANSLATE_CHARS = 12_000;         // translate endpoint input cap
export const MAX_TEXT_CHARS = 1_000_000;           // text-type document input cap (1 MB of text)

