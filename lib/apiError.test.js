import { describe, it, expect } from "vitest";
import { apiError, mapSarvamError, CODE_STATUS } from "./apiError.js";

describe("lib/apiError.js", () => {
  describe("CODE_STATUS", () => {
    it("maps known codes to correct HTTP statuses", () => {
      expect(CODE_STATUS.INVALID_REQUEST).toBe(400);
      expect(CODE_STATUS.TOO_MANY_FILES).toBe(400);
      expect(CODE_STATUS.UNSUPPORTED_TYPE).toBe(415);
      expect(CODE_STATUS.FILE_TOO_LARGE).toBe(413);
      expect(CODE_STATUS.RATE_LIMITED).toBe(429);
      expect(CODE_STATUS.SERVER_BUSY).toBe(503);
      expect(CODE_STATUS.NO_READABLE_DOCUMENTS).toBe(422);
      expect(CODE_STATUS.OCR_FAILED).toBe(502);
      expect(CODE_STATUS.EXTRACTION_INVALID).toBe(502);
      expect(CODE_STATUS.UPSTREAM_AUTH).toBe(503);
      expect(CODE_STATUS.UPSTREAM_RATE_LIMITED).toBe(503);
      expect(CODE_STATUS.UPSTREAM_TIMEOUT).toBe(504);
      expect(CODE_STATUS.INTERNAL).toBe(500);
    });
  });

  describe("apiError()", () => {
    it("returns a Response with correct status and body shape", async () => {
      const res = apiError("INVALID_REQUEST", "Bad input");
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("INVALID_REQUEST");
      expect(body.error.message).toBe("Bad input");
      expect(typeof body.error.request_id).toBe("string");
      expect(body.error.request_id.length).toBeGreaterThan(0);
    });

    it("uses provided request_id when given", async () => {
      const res = apiError("INTERNAL", "Oops", { request_id: "test-id-123" });
      const body = await res.json();
      expect(body.error.request_id).toBe("test-id-123");
    });

    it("includes retry_after_sec and Retry-After header when provided", async () => {
      const res = apiError("RATE_LIMITED", "Slow down", { retry_after_sec: 30 });
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("30");
      const body = await res.json();
      expect(body.error.retry_after_sec).toBe(30);
    });

    it("omits retry_after_sec from body when not provided", async () => {
      const res = apiError("INTERNAL", "Oops");
      const body = await res.json();
      expect(body.error.retry_after_sec).toBeUndefined();
    });

    it("sets Cache-Control: no-store header", () => {
      const res = apiError("INTERNAL", "Oops");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    });

    it("merges extraHeaders into response headers", () => {
      const res = apiError("RATE_LIMITED", "Slow down", {
        extraHeaders: { "X-Custom": "value" },
      });
      expect(res.headers.get("X-Custom")).toBe("value");
    });

    it("falls back to 500 for unknown code", () => {
      const res = apiError("UNKNOWN_CODE", "Unexpected");
      expect(res.status).toBe(500);
    });
  });

  describe("mapSarvamError()", () => {
    it("maps 401 to UPSTREAM_AUTH (503)", async () => {
      const err = { status: 401 };
      const res = mapSarvamError(err, "req-1");
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error.code).toBe("UPSTREAM_AUTH");
    });

    it("maps 403 to UPSTREAM_AUTH (503)", async () => {
      const err = { status: 403 };
      const res = mapSarvamError(err, "req-2");
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error.code).toBe("UPSTREAM_AUTH");
    });

    it("maps 429 to UPSTREAM_RATE_LIMITED with Retry-After", async () => {
      const err = { status: 429 };
      const res = mapSarvamError(err, "req-3");
      expect(res.status).toBe(503);
      expect(res.headers.get("Retry-After")).toBe("60");
      const body = await res.json();
      expect(body.error.code).toBe("UPSTREAM_RATE_LIMITED");
    });

    it("maps 504 to UPSTREAM_TIMEOUT", async () => {
      const err = { status: 504 };
      const res = mapSarvamError(err, "req-4");
      expect(res.status).toBe(504);
      const body = await res.json();
      expect(body.error.code).toBe("UPSTREAM_TIMEOUT");
    });

    it("maps AbortError to UPSTREAM_TIMEOUT", async () => {
      const err = { name: "AbortError", message: "Aborted" };
      const res = mapSarvamError(err, "req-5");
      expect(res.status).toBe(504);
      const body = await res.json();
      expect(body.error.code).toBe("UPSTREAM_TIMEOUT");
    });

    it("maps 'timeout' message to UPSTREAM_TIMEOUT", async () => {
      const err = { message: "Request timeout exceeded" };
      const res = mapSarvamError(err, "req-6");
      expect(res.status).toBe(504);
    });

    it("maps 502/503 upstream to UPSTREAM_AUTH (503)", async () => {
      const err502 = { status: 502 };
      const err503 = { status: 503 };
      const res502 = mapSarvamError(err502, "req-7");
      const res503 = mapSarvamError(err503, "req-8");
      expect(res502.status).toBe(503);
      expect(res503.status).toBe(503);
    });

    it("maps unknown error to INTERNAL (500)", async () => {
      const err = { status: 418, message: "I'm a teapot" };
      const res = mapSarvamError(err, "req-9");
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error.code).toBe("INTERNAL");
    });

    it("never exposes upstream message in returned body", async () => {
      const err = { status: 500, message: "SECRET_KEY=sk_abc123" };
      const res = mapSarvamError(err, "req-10");
      const body = await res.json();
      expect(body.error.message).not.toContain("SECRET_KEY");
    });

    it("preserves provided request_id", async () => {
      const res = mapSarvamError({ status: 500 }, "my-req-id");
      const body = await res.json();
      expect(body.error.request_id).toBe("my-req-id");
    });
  });
});
