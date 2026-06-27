// =============================================================================
// Edge Gateway — minimal Cloudflare Worker pass-through
// The full API surface is served by server.js (self-hosted via Railway/Docker).
// This Worker exists only to satisfy the Cloudflare app registration and
// provide a lightweight health-check endpoint.
// =============================================================================

const startedAt = Date.now();

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const corsHeaders = { "Access-Control-Allow-Origin": "*" };

    // Health check
    if (url.pathname === "/health" || url.pathname === "/" || url.pathname === "/ping") {
      return new Response(JSON.stringify({
        status: "ok",
        timestamp: new Date().toISOString(),
        uptime: Math.round((Date.now() - startedAt) / 1000),
        note: "This is the Cloudflare pass-through Worker. The full API runs on the self-hosted server.",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    return new Response(JSON.stringify({
      success: false,
      error: "not found — use the self-hosted server for the full API",
    }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  },
};
