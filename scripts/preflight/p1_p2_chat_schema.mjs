/**
 * P-1: Does sarvam-105b honour response_format: { type:"json_schema", json_schema } including strict?
 * P-2: Does message.content hold only the answer, or does it also carry <think> / reasoning_content?
 *
 * NEVER prints the API key. Never logs document text.
 * Run: node scripts/preflight/p1_p2_chat_schema.mjs
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

const schema = {
  name: "p1_test",
  strict: true,
  schema: {
    type: "object",
    properties: {
      greeting: { type: "string" },
      number: { type: "integer" },
    },
    required: ["greeting", "number"],
    additionalProperties: false,
  },
};

console.log("Sending tiny json_schema request to sarvam-105b ...");

const res = await fetch("https://api.sarvam.ai/v1/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "api-subscription-key": key,
  },
  body: JSON.stringify({
    model: "sarvam-105b",
    messages: [
      {
        role: "user",
        content: 'Reply with greeting="HELLO" and number=42.',
      },
    ],
    response_format: { type: "json_schema", json_schema: schema },
    temperature: 0,
    max_tokens: 100,
  }),
});

const data = await res.json();
console.log("\n=== HTTP STATUS:", res.status);
const choice = data.choices?.[0];
const content = choice?.message?.content ?? "";

console.log("=== FINISH_REASON:", choice?.finish_reason);
console.log("=== CONTENT (raw):", content);
console.log("=== MESSAGE KEYS:", Object.keys(choice?.message ?? {}));
console.log("=== RESPONSE TOP-LEVEL KEYS:", Object.keys(data));

// P-1: does it parse as valid JSON matching the schema?
try {
  const parsed = JSON.parse(content);
  console.log("\nP-1 RESULT: json_schema SUPPORTED — parsed OK:", JSON.stringify(parsed));
} catch {
  console.log("\nP-1 RESULT: json_schema NOT SUPPORTED or malformed — content is not JSON");
}

// P-2: think blocks?
const hasThinkTag = content.includes("<think>");
const hasReasoningContent = "reasoning_content" in (choice?.message ?? {});
console.log("P-2 RESULT: <think> in content =", hasThinkTag);
console.log("P-2 RESULT: reasoning_content field present =", hasReasoningContent);

