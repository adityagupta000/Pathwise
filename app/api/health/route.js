import packageJson from "@/package.json";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // never cache

/**
 * GET /api/health
 * Returns basic service health. Never exposes key values.
 * D4: version read from package.json, not npm_package_version env var.
 */
export async function GET() {
  return Response.json(
    {
      ok: true,
      version: packageJson.version || "0.1.0",
      configured: Boolean(env.SARVAM_API_KEY && env.SARVAM_API_KEY !== "your_sarvam_api_key_here"),
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
