/** @type {import('next').NextConfig} */
import { env } from "./lib/env.js";

const isDevelopment = process.env.NODE_ENV === "development";

const nextConfig = {
  reactCompiler: true,

  // Produces a small self-contained server (.next/standalone) for the Docker image.
  output: "standalone",

  // Keep these as plain Node requires instead of bundling them into the server build.
  serverExternalPackages: ["adm-zip", "unpdf"],

  // Remove the X-Powered-By: Next.js header
  poweredByHeader: false,

  // ── Security headers ────────────────────────────────────────────────────────
  // CSP note: Next.js 16 with reactCompiler:true may emit inline scripts
  // during hydration.  A nonce-based strict CSP would require a Proxy (proxy.js)
  // to inject a per-request nonce, which is out of scope for this phase.
  // We use a permissive but still protective CSP that restricts most attack
  // vectors while remaining compatible with the React Compiler output.
  // TODO: implement nonce-based CSP via proxy.js for stronger protection.
  async headers() {
    return [
      // ── Global security headers (all routes) ──────────────────────────────
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "geolocation=(), camera=(), microphone=()",
          },
          {
            // Permissive-but-protective CSP (compatible with React Compiler inline scripts).
            // 'unsafe-inline' for scripts is needed until nonce-based CSP is added.
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
              "style-src 'self' 'unsafe-inline'",  // required for CSS-in-JS patterns
              "img-src 'self' blob: data:",
              "font-src 'self'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              // Only enable this when TLS is terminated in front of the application.
              // Re-add only if HTTPS_ONLY=true is set
              ...(env.HTTPS_ONLY === "true" ? ["upgrade-insecure-requests"] : []),
            ].join("; "),
          },
        ],
      },

      // ── API route headers (no caching) ────────────────────────────────────
      {
        source: "/api/(.*)",
        headers: [
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
