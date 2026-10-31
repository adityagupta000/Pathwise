export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // never cache

/**
 * GET /api/health
 * Returns basic service health. Never exposes key values.
 */
export async function GET() {
  return Response.json(
    {
      ok: true,
      version: process.env.npm_package_version || "0.1.0",
      configured: Boolean(
        process.env.SARVAM_API_KEY &&
          process.env.SARVAM_API_KEY !== "your_sarvam_api_key_here"
      ),
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    }
  );
}

