import { translateText, SarvamError } from "@/lib/sarvam";
import { LANGUAGE_CODES } from "@/lib/languages";
import { rateLimit, rateLimitHeaders, clientIp } from "@/lib/limiter";
import { MAX_TRANSLATE_CHARS } from "@/lib/limits";
import { apiError, mapSarvamError } from "@/lib/apiError";
import { env } from "@/lib/env";
import crypto from "crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request) {
  const request_id = crypto.randomUUID();
  const t0 = Date.now();

  // Rate limit
  const ip = clientIp(request);
  const rl = rateLimit(`translate:${ip}`, {
    limit: env.TRANSLATE_LIMIT_PER_10_MIN,
    windowMs: 10 * 60 * 1000,
  });
  if (!rl.ok) {
    return apiError(
      "RATE_LIMITED",
      `Too many requests. Please try again in ${Math.ceil(rl.retryAfterSec / 60)} minute(s).`,
      {
        request_id,
        retry_after_sec: rl.retryAfterSec,
        extraHeaders: rateLimitHeaders(rl, env.TRANSLATE_LIMIT_PER_10_MIN),
        durationMs: Date.now() - t0,
      }
    );
  }

  // Global translate budget
  const globalRl = rateLimit("global:translate", {
    limit: env.GLOBAL_TRANSLATE_PER_HOUR,
    windowMs: 60 * 60 * 1000,
  });
  if (!globalRl.ok) {
    return apiError("SERVER_BUSY", "The service is temporarily at capacity. Please try again shortly.", {
      request_id,
      retry_after_sec: 60,
      durationMs: Date.now() - t0,
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_REQUEST", "Send a JSON body with { text, target }.", {
      request_id,
      durationMs: Date.now() - t0,
    });
  }

  const { text, target } = body || {};
  if (typeof text !== "string" || !text.trim()) {
    return apiError("INVALID_REQUEST", "The 'text' field is required and must be a non-empty string.", {
      request_id,
      durationMs: Date.now() - t0,
    });
  }
  if (text.length > MAX_TRANSLATE_CHARS) {
    return apiError(
      "INVALID_REQUEST",
      `Text too long. Translate at most ${MAX_TRANSLATE_CHARS} characters at a time.`,
      { request_id, durationMs: Date.now() - t0 }
    );
  }
  if (!LANGUAGE_CODES.has(target)) {
    return apiError("INVALID_REQUEST", `"${target}" is not a supported target language.`, {
      request_id,
      durationMs: Date.now() - t0,
    });
  }

  try {
    const translated = await translateText(text, target, "en-IN", request.signal);
    return Response.json({ translated, target }, { status: 200, headers: NO_STORE });
  } catch (err) {
    if (err.name === "AbortError") {
      return apiError("INTERNAL", "Request was cancelled.", { request_id, durationMs: Date.now() - t0 });
    }
    if (err instanceof SarvamError) {
      return mapSarvamError(err, request_id, Date.now() - t0);
    }
    console.error("[PathWise] translate unhandled:", err.message);
    return apiError("INTERNAL", "An unexpected error occurred. Please try again.", {
      request_id,
      durationMs: Date.now() - t0,
    });
  }
}
