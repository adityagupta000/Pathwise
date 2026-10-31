/**
 * P-6: Does sarvam-translate:v1 preserve single newlines?
 *      Does 2000-char limit hold? Is numerals_format:"international" valid?
 *
 * Run: node scripts/preflight/p6_translate.mjs
 */
import { readFileSync } from "fs";

const key = (() => {
  try {
    return readFileSync(".env.local", "utf8").match(/SARVAM_API_KEY=(\S+)/)?.[1];
  } catch {
    return process.env.SARVAM_API_KEY;
  }
})();

if (!key) {
  console.error("SARVAM_API_KEY not found. Set it in .env.local");
  process.exit(1);
}

// 6 lines, single \n separators
const testText = [
  "Task 1: Visit the Aadhaar Seva Kendra by November 15.",
  "Deadline: 15 November 2024 (30 days left).",
  "Task 2: Submit bank KYC form.",
  "Required documents: PAN card, Aadhaar card.",
  "Fees: Rs. 50.",
  "Task 3: Complete income tax return filing.",
].join("\n");

console.log("Input text (" + testText.length + " chars, " + testText.split("\n").length + " lines):");
console.log(JSON.stringify(testText));

const res = await fetch("https://api.sarvam.ai/translate", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "api-subscription-key": key,
  },
  body: JSON.stringify({
    input: testText,
    source_language_code: "en-IN",
    target_language_code: "hi-IN",
    model: "sarvam-translate:v1",
    mode: "formal",
    numerals_format: "international",
  }),
});

const data = await res.json();
console.log("\n=== HTTP STATUS:", res.status);
console.log("=== RESPONSE KEYS:", Object.keys(data));

if (data.translated_text) {
  const outputLines = data.translated_text.split("\n").length;
  const inputLines = testText.split("\n").length;
  console.log("\nP-6 TRANSLATED (raw):", JSON.stringify(data.translated_text));
  console.log("P-6 INPUT_LINES:", inputLines, "OUTPUT_LINES:", outputLines);
  console.log("P-6 KEEPS_NEWLINES:", inputLines === outputLines ? "YES" : "NO — lines merged or split");
} else {
  console.log("P-6 ERROR — no translated_text in response:", JSON.stringify(data));
}

