import { describe, it, expect, afterEach, vi } from "vitest";

describe("lib/env.js", () => {
  const ORIGINAL = { ...process.env };

  afterEach(async () => {
    // Restore env between tests
    for (const k of Object.keys(process.env)) {
      if (!(k in ORIGINAL)) delete process.env[k];
    }
    Object.assign(process.env, ORIGINAL);
    vi.resetModules();
  });

  it("accepts valid config and returns parsed numerics", async () => {
    vi.resetModules();
    process.env.SARVAM_API_KEY = "sk_test_validkey";
    process.env.RATE_LIMIT_PER_10_MIN = "20";
    process.env.TRUSTED_PROXY_HOPS = "2";
    process.env.NODE_ENV = "development";

    const { env } = await import("./env.js");
    expect(env.RATE_LIMIT_PER_10_MIN).toBe(20);
    expect(env.TRUSTED_PROXY_HOPS).toBe(2);
    expect(env.APP_TIMEZONE).toBe("Asia/Kolkata"); // default
  });

  it("applies numeric defaults when vars are absent", async () => {
    vi.resetModules();
    process.env.SARVAM_API_KEY = "sk_test_key";
    process.env.NODE_ENV = "development";
    delete process.env.RATE_LIMIT_PER_10_MIN;
    delete process.env.SARVAM_MAX_TOKENS;
    delete process.env.PARSE_TIMEOUT_MS;

    const { env } = await import("./env.js");
    expect(env.RATE_LIMIT_PER_10_MIN).toBe(10);
    expect(env.SARVAM_MAX_TOKENS).toBe(4096);
    expect(env.PARSE_TIMEOUT_MS).toBe(180_000);
  });

  it("keeps reasoning effort unset unless explicitly configured", async () => {
    vi.resetModules();
    delete process.env.SARVAM_REASONING_EFFORT;

    const { env } = await import("./env.js");
    expect(env.SARVAM_REASONING_EFFORT).toBeUndefined();
  });

  it.each(["none", "low", "high", "max"])("accepts reasoning effort %s", async (effort) => {
    vi.resetModules();
    process.env.SARVAM_REASONING_EFFORT = effort;

    const { env } = await import("./env.js");
    expect(env.SARVAM_REASONING_EFFORT).toBe(effort);
  });

  it("rejects unsupported reasoning effort values", async () => {
    vi.resetModules();
    process.env.SARVAM_REASONING_EFFORT = "minimal";

    await expect(import("./env.js")).rejects.toThrow(/SARVAM_REASONING_EFFORT/);
  });

  it("throws a readable error when SARVAM_API_KEY is missing in production", async () => {
    vi.resetModules();
    // Use vi.stubEnv to properly override env vars even when .env.local is loaded
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SARVAM_API_KEY", "");

    try {
      await expect(import("./env.js")).rejects.toThrow(/SARVAM_API_KEY/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("handles TRUST_PROXY=true alias: sets TRUSTED_PROXY_HOPS=1 and warns", async () => {
    vi.resetModules();
    process.env.SARVAM_API_KEY = "sk_test_key";
    process.env.TRUST_PROXY = "true";
    process.env.NODE_ENV = "development";
    delete process.env.TRUSTED_PROXY_HOPS;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { env } = await import("./env.js");
    expect(env.TRUSTED_PROXY_HOPS).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("deprecated"));
    warnSpy.mockRestore();
  });
});
