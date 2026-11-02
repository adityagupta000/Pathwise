// app/api/health/route.test.js  (C7 — D4)

import { describe, it, expect } from "vitest";
import { GET } from "./route";

describe("GET /api/health", () => {
  it("returns ok: true", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it("returns configured boolean based on SARVAM_API_KEY presence", async () => {
    const res = await GET();
    const data = await res.json();
    // configured is a boolean
    expect(typeof data.configured).toBe("boolean");
  });

  it("never exposes the actual key value", async () => {
    const res = await GET();
    const text = await res.text();
    // Should not contain typical key patterns
    expect(text).not.toMatch(/sk-[a-zA-Z0-9]/);
  });

  it("returns a version string", async () => {
    const res = await GET();
    const data = await res.json();
    expect(typeof data.version).toBe("string");
    expect(data.version.length).toBeGreaterThan(0);
  });

  it("sets Cache-Control: no-store", async () => {
    const res = await GET();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

