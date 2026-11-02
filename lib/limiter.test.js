import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// We control TRUSTED_PROXY_HOPS via vi.mock of env.js
vi.mock("./env.js", () => ({
  env: { TRUSTED_PROXY_HOPS: 0, MAX_CONCURRENT_EXTRACTS: 2 },
}));

import {
  rateLimit,
  rateLimitHeaders,
  clientIp,
  acquireExtractSlot,
  releaseExtractSlot,
  _resetBuckets,
  _resetExtractSlots,
} from "./limiter.js";
import { env } from "./env.js";

function makeRequest(headers = {}) {
  return {
    headers: {
      get: (key) => headers[key.toLowerCase()] || null,
    },
  };
}

describe("clientIp", () => {
  beforeEach(() => _resetBuckets());

  it("returns 'unknown' when TRUSTED_PROXY_HOPS=0 (ignore all headers)", () => {
    env.TRUSTED_PROXY_HOPS = 0;
    const req = makeRequest({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8" });
    expect(clientIp(req)).toBe("unknown");
  });

  it("with hops=1 picks the entry at parts.length - hops", () => {
    env.TRUSTED_PROXY_HOPS = 1;
    // XFF: "client, our_proxy_ip" — our proxy appended its own IP last.
    // Real client = parts[2-1] = parts[1] = "10.0.0.2"
    // (In this model, hops=1 means we trust the rightmost entry was appended
    // by OUR proxy, so the real client is the entry AT that index.)
    const req = makeRequest({ "x-forwarded-for": "10.0.0.1, 10.0.0.2" });
    expect(clientIp(req)).toBe("10.0.0.2");
  });

  it("with hops=2 picks the entry at parts.length - hops", () => {
    env.TRUSTED_PROXY_HOPS = 2;
    // XFF: "c1, c2, proxy1, proxy2" — 2 trusted proxies appended last 2 entries.
    // Real client = parts[4-2] = parts[2] = "10.0.0.3"
    const req = makeRequest({ "x-forwarded-for": "10.0.0.1, 10.0.0.2, 10.0.0.3, 10.0.0.4" });
    expect(clientIp(req)).toBe("10.0.0.3");
  });

  it("falls back to x-real-ip when XFF absent and hops>0", () => {
    env.TRUSTED_PROXY_HOPS = 1;
    const req = makeRequest({ "x-real-ip": "9.9.9.9" });
    expect(clientIp(req)).toBe("9.9.9.9");
  });

  it("spoofed x-real-ip has no effect when hops=0", () => {
    env.TRUSTED_PROXY_HOPS = 0;
    const req = makeRequest({ "x-real-ip": "6.6.6.6" });
    expect(clientIp(req)).toBe("unknown");
  });

  it("does not create separate per-IP buckets when hops=0", () => {
    env.TRUSTED_PROXY_HOPS = 0;
    expect(clientIp(makeRequest({ "x-forwarded-for": "1.1.1.1" }))).toBe("unknown");
    expect(clientIp(makeRequest({ "x-forwarded-for": "2.2.2.2" }))).toBe("unknown");
    expect(rateLimit("extract:unknown", { limit: 1, windowMs: 60_000 }).ok).toBe(true);
    expect(rateLimit("extract:unknown", { limit: 1, windowMs: 60_000 }).ok).toBe(false);
  });
});

describe("rateLimit", () => {
  beforeEach(() => _resetBuckets());

  it("allows requests up to the limit", () => {
    for (let i = 0; i < 5; i++) {
      expect(rateLimit("test-key", { limit: 5, windowMs: 60_000 }).ok).toBe(true);
    }
  });

  it("blocks on limit+1", () => {
    for (let i = 0; i < 5; i++) rateLimit("key2", { limit: 5, windowMs: 60_000 });
    expect(rateLimit("key2", { limit: 5, windowMs: 60_000 }).ok).toBe(false);
  });

  it("returns Retry-After > 0 when blocked", () => {
    for (let i = 0; i < 3; i++) rateLimit("key3", { limit: 3, windowMs: 60_000 });
    const r = rateLimit("key3", { limit: 3, windowMs: 60_000 });
    expect(r.ok).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
  });

  it("resets after window", async () => {
    rateLimit("key4", { limit: 1, windowMs: 10 });
    await new Promise((r) => setTimeout(r, 15));
    expect(rateLimit("key4", { limit: 1, windowMs: 10 }).ok).toBe(true);
  });
});

describe("rateLimitHeaders", () => {
  it("includes all three standard headers", () => {
    _resetBuckets();
    const r = rateLimit("hdr-test", { limit: 10, windowMs: 60_000 });
    const hdrs = rateLimitHeaders(r, 10);
    expect(hdrs["Retry-After"]).toBeDefined();
    expect(hdrs["RateLimit-Limit"]).toBe("10");
    expect(hdrs["RateLimit-Remaining"]).toBeDefined();
    expect(hdrs["RateLimit-Reset"]).toBeDefined();
  });
});

describe("acquireExtractSlot / releaseExtractSlot", () => {
  beforeEach(() => _resetExtractSlots());

  it("allows up to MAX_CONCURRENT_EXTRACTS slots", () => {
    env.MAX_CONCURRENT_EXTRACTS = 2;
    expect(acquireExtractSlot()).toBe(true);
    expect(acquireExtractSlot()).toBe(true);
  });

  it("returns false when cap is reached", () => {
    env.MAX_CONCURRENT_EXTRACTS = 2;
    acquireExtractSlot();
    acquireExtractSlot();
    expect(acquireExtractSlot()).toBe(false);
  });

  it("allows again after releasing", () => {
    env.MAX_CONCURRENT_EXTRACTS = 2;
    acquireExtractSlot();
    acquireExtractSlot();
    releaseExtractSlot();
    expect(acquireExtractSlot()).toBe(true);
  });
});
