/**
 * lib/env.js — Validated environment configuration.
 *
 * Import this module instead of accessing process.env directly so that
 * mis-configuration is caught at startup with a clear message rather than
 * at runtime with a cryptic error.
 *
 * NEVER log or expose the values of secret fields (SARVAM_API_KEY).
 */

import { z } from "zod";

// ── Helper: coerce a string env value to a positive integer ──────────────────
const envInt = (defaultVal) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? defaultVal : Number(v)))
    .pipe(z.number().int().nonnegative());

// ── Schema ────────────────────────────────────────────────────────────────────
const EnvSchema = z.object({
  // Secret: required in production, optional in test/development
  SARVAM_API_KEY: z
    .string()
    .min(1)
    .optional()
    .refine(
      (v) => process.env.NODE_ENV !== "production" || (v && v !== "your_sarvam_api_key_here"),
      { message: "SARVAM_API_KEY must be set to a real key in production." }
    ),

  // Per-IP rate limits
  RATE_LIMIT_PER_10_MIN: envInt(10),
  TRANSLATE_LIMIT_PER_10_MIN: envInt(120),

  // Global hourly budgets
  GLOBAL_EXTRACT_PER_HOUR: envInt(200),
  GLOBAL_TRANSLATE_PER_HOUR: envInt(1200),

  // Concurrency cap for simultaneous extract jobs
  MAX_CONCURRENT_EXTRACTS: envInt(5),

  // Sarvam model limits
  SARVAM_MAX_TOKENS: envInt(4096),
  PARSE_TIMEOUT_MS: envInt(180_000),

  // Localisation
  APP_TIMEZONE: z.string().optional().default("Asia/Kolkata"),

  // Reverse-proxy trust:
  //   0 = ignore all forwarding headers (direct internet exposure)
  //   N = trust the Nth-from-right entry in X-Forwarded-For
  TRUSTED_PROXY_HOPS: envInt(0),

  // Deprecated alias: TRUST_PROXY=true => TRUSTED_PROXY_HOPS=1
  TRUST_PROXY: z.string().optional(),

  // Node env (used in schema checks above)
  NODE_ENV: z.string().optional().default("development"),
});

// ── Parse & validate ──────────────────────────────────────────────────────────
function loadEnv() {
  const raw = EnvSchema.safeParse(process.env);

  if (!raw.success) {
    const issues = raw.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`[PathWise] Environment configuration error:\n${issues}`);
  }

  const cfg = raw.data;

  // Handle deprecated TRUST_PROXY alias
  if (cfg.TRUST_PROXY === "true" && cfg.TRUSTED_PROXY_HOPS === 0) {
    console.warn(
      "[PathWise] TRUST_PROXY=true is deprecated. " +
        "Set TRUSTED_PROXY_HOPS=1 (or the correct hop count) instead."
    );
    cfg.TRUSTED_PROXY_HOPS = 1;
  }

  return cfg;
}

export const env = loadEnv();
