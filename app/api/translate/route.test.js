// app/api/translate/route.test.js
// Tests for POST /api/translate  (C7)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";

// ── Mock sarvam translateText ─────────────────────────────────
vi.mock("@/lib/sarvam", () => ({
  translateText: vi.fn(async (text) => `[translated] ${text}`),
  SarvamError: class SarvamError extends Error {
    constructor(message, status) {
      super(message);
      this.name = "SarvamError";
      this.status = status;
    }
  },
}));

function makeRequest(body, headers = {}) {
  const json = JSON.stringify(body);
  return new Request("http://localhost/api/translate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(json)),
      ...headers,
    },
    body: json,
  });
}

describe("POST /api/translate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path — translates text to valid target", async () => {
    const req = makeRequest({ text: "Hello world", target: "hi-IN" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.translated).toBe("string");
    expect(data.target).toBe("hi-IN");
  });

  it("returns 400 for empty text", async () => {
    const req = makeRequest({ text: "   ", target: "hi-IN" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe("INVALID_REQUEST");
  });

  it("returns 400 for unsupported target language", async () => {
    const req = makeRequest({ text: "Hello", target: "xx-XX" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe("INVALID_REQUEST");
  });

  it("B16 — rejects oversized Content-Length before parsing (returns 413)", async () => {
    const req = makeRequest({ text: "ok", target: "hi-IN" }, {
      "Content-Length": String(65 * 1024 + 1), // >64 KB
    });
    const res = await POST(req);
    // FILE_TOO_LARGE maps to 413
    expect(res.status).toBe(413);
    const data = await res.json();
    expect(data.error.code).toBe("FILE_TOO_LARGE");
  });

  it("returns 400 for non-JSON body", async () => {
    const req = new Request("http://localhost/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

