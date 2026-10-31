/**
 * P-1 extended: test with higher max_tokens, and without strict.
 * P-2 extended: inspect reasoning_content field.
 *
 * Run: node scripts/preflight/p1_p2_extended.mjs
 */
import { readFileSync } from "fs";

const key = (() => {
  try {
    return readFileSync(".env.local", "utf8").match(/SARVAM_API_KEY=(\S+)/)?.[1];
  } catch {
    return process.env.SARVAM_API_KEY;
  }
})();

async function chat(label, body) {
  console.log(`\n--- ${label} ---`);
  const res = await fetch("https://api.sarvam.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-subscription-key": key },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  const choice = data.choices?.[0];
  const msg = choice?.message ?? {};
  console.log("STATUS:", res.status);
  console.log("FINISH_REASON:", choice?.finish_reason);
  console.log("CONTENT:", msg.content ?? "(empty/null)");
  console.log("REASONING_CONTENT length:", msg.reasoning_content?.length ?? 0);
  console.log("MESSAGE KEYS:", Object.keys(msg));
  return { choice, content: msg.content, reasoning: msg.reasoning_content };
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

// Test 1: json_schema with strict, 512 tokens
const t1 = await chat("T1: json_schema strict=true, max_tokens=512", {
  model: "sarvam-105b",
  messages: [{ role: "user", content: 'Reply with greeting="HELLO" and number=42.' }],
  response_format: { type: "json_schema", json_schema: schema },
  temperature: 0,
  max_tokens: 512,
});

// Test 2: json_schema without strict
const schemaNoStrict = { ...schema, strict: false };
const t2 = await chat("T2: json_schema strict=false, max_tokens=512", {
  model: "sarvam-105b",
  messages: [{ role: "user", content: 'Reply with greeting="HELLO" and number=42.' }],
  response_format: { type: "json_schema", json_schema: schemaNoStrict },
  temperature: 0,
  max_tokens: 512,
});

// Test 3: json_object format (simpler)
const t3 = await chat("T3: response_format=json_object, max_tokens=512", {
  model: "sarvam-105b",
  messages: [{ role: "user", content: 'Reply ONLY with JSON: {"greeting":"HELLO","number":42}' }],
  response_format: { type: "json_object" },
  temperature: 0,
  max_tokens: 512,
});

// Test 4: no response_format (plain text)
const t4 = await chat("T4: no response_format, max_tokens=512", {
  model: "sarvam-105b",
  messages: [{ role: "user", content: 'Reply ONLY with JSON: {"greeting":"HELLO","number":42}' }],
  temperature: 0,
  max_tokens: 512,
});

console.log("\n=== SUMMARY ===");
for (const [label, result] of [
  ["T1 json_schema strict", t1],
  ["T2 json_schema no-strict", t2],
  ["T3 json_object", t3],
  ["T4 plain", t4],
]) {
  let valid = false;
  try {
    if (result.content) { JSON.parse(result.content); valid = true; }
  } catch {}
  console.log(label + ": content=" + (result.content?.slice(0,80)||"(empty)") + " | valid_json=" + valid);
}

