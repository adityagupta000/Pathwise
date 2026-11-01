/**
 * lib/limiter.js — Rate limiting, concurrency control, and IP extraction.
 *
 * Deployment model
 * ────────────────
 * TRUSTED_PROXY_HOPS (from lib/env.js, default 0):
 *   0  — Do NOT trust any forwarding headers. Use a fallback key ("unknown")
 *         for all requests.  Safe for direct internet exposure.
 *   N  — Take the Nth-from-right entry in X-Forwarded-For as the real client
 *         IP. Use N=1 behind one trusted reverse proxy (e.g. Railway, Render),
 *         N=2 behind two proxies, etc.
 *
 * This is a single-instance in-memory store. For multi-instance deployments,
 * replace the `buckets` Map with a Redis-backed implementation.
 */

import { env } from "./env.js";

// ─── Concurrency limiter ─────────────────────────────────────────────────────

/**
 * Create a concurrency limiter: at most `max` tasks run simultaneously.
 * Usage: const limit = createLimiter(3); await limit(() => doWork());
 */
export function createLimiter(max) {
  let active = 0;
  const queue = [];

  const next = () => {
    if (active >= max || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      });
  };

  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}

// ─── Extract-job concurrency cap ─────────────────────────────────────────────
// Tracks the number of in-flight extract jobs. Unlike createLimiter (which
// queues), this hard-caps and returns 503 immediately so clients get a fast
// response instead of hanging.
let activeExtractJobs = 0;

export function acquireExtractSlot() {
  if (activeExtractJobs >= env.MAX_CONCURRENT_EXTRACTS) return false;
  activeExtractJobs++;
  return true;
}

export function releaseExtractSlot() {
  if (activeExtractJobs > 0) activeExtractJobs--;
}

/** Exposed for tests only. */
export function _resetExtractSlots() {
  activeExtractJobs = 0;
}

// ─── Rate-limit buckets ───────────────────────────────────────────────────────

/** Fixed-window, in-memory rate limiter keyed by an identifier. */
const buckets = new Map();

/**
 * @param {string} key   - Unique bucket key (e.g. "extract:1.2.3.4")
 * @param {{ limit: number, windowMs: number }} opts
 * @returns {{ ok: boolean, remaining: number, retryAfterSec: number, resetAt: number }}
 */
export function rateLimit(key, { limit, windowMs }) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count++;

  // Opportunistic cleanup so the map can't grow forever
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (now >= v.resetAt) buckets.delete(k);
    }
  }

  return {
    ok: b.count <= limit,
    remaining: Math.max(0, limit - b.count),
    retryAfterSec: Math.ceil((b.resetAt - now) / 1000),
    resetAt: Math.ceil(b.resetAt / 1000), // Unix epoch seconds for RateLimit-Reset
  };
}

/** For tests: wipe all buckets. */
export function _resetBuckets() {
  buckets.clear();
}

// ─── Rate-limit response helpers ─────────────────────────────────────────────

/**
 * Build the standard rate-limit response headers.
 * Always attached to 429 responses.
 */
export function rateLimitHeaders(result, limit) {
  return {
    "Retry-After": String(result.retryAfterSec),
    "RateLimit-Limit": String(limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(result.resetAt),
  };
}

// ─── IP extraction ────────────────────────────────────────────────────────────

/**
 * Derive the client IP from the request.
 *
 * When TRUSTED_PROXY_HOPS === 0 (default), we do NOT trust any client-supplied
 * header.  We return "unknown" — safe because all untrusted traffic shares
 * one rate-limit bucket.
 *
 * When TRUSTED_PROXY_HOPS === N:
 *   XFF is appended left-to-right: [original_client, proxy1, ..., our_proxy].
 *   Our N trusted proxies each appended one entry.  The entry at index
 *   (parts.length - N) is the first entry not added by our own infrastructure,
 *   i.e. the real client IP (or the edge of our trust boundary).
 *
 *   Example: XFF="10.0.0.1, 10.0.0.2, 10.0.0.3" with hops=2
 *   → strip last 2 → real client = parts[3-2] = parts[1] = "10.0.0.2"
 */
export function clientIp(request) {
  const hops = env.TRUSTED_PROXY_HOPS;
  if (hops <= 0) return "unknown";

  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    // The real client is at index (parts.length - hops), i.e. just before
    // the N entries added by our own trusted proxies.
    const idx = parts.length - hops;
    if (idx >= 0 && parts[idx]) return parts[idx];
    // Fewer entries than hops → cannot trust any of them, return unknown
    return "unknown";
  }

  // Fall back to x-real-ip (set by nginx/etc.)
  return request.headers.get("x-real-ip") || "unknown";
}
