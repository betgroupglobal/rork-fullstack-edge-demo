// Edge Gateway — Cloudflare Worker compatibility shim.
// The real backend runs as server.js + proxy-manager.js via Docker/Railway.
// This Worker acts as a lightweight proxy/health endpoint for the CF deployment check.

export default {
  async fetch(request: Request, env: Record<string, string>, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") ?? "*";

    const corsHeaders: Record<string, string> = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Health check
    if (url.pathname === "/health" || url.pathname === "/" || url.pathname === "/ping") {
      return new Response(
        JSON.stringify({
          status: "ok",
          timestamp: new Date().toISOString(),
          uptime: 0,
          itemCount: 0,
          proxyCount: 0,
          interceptCount: 0,
          trafficCount: 0,
          interceptLabMode: "false",
          region: "edge",
          meta: { latencyMs: 0, cache: "BYPASS", edgeLatency: null, rateLimit: null, rateRemaining: null },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Proxy tunnel endpoints — stub for frontend compat
    if (url.pathname === "/api/proxy/tunnels") {
      return new Response(
        JSON.stringify({ success: true, data: [], count: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (url.pathname === "/api/proxy/status") {
      return new Response(
        JSON.stringify({
          success: true,
          data: { status: "ok", tunnelCount: 0, tunnelsRunning: 0, totalBytesTransferred: 0, totalActiveConns: 0, config: { bindAddr: "0.0.0.0", bindPort: 7000 } },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Proxies stub
    if (url.pathname === "/api/proxies") {
      return new Response(
        JSON.stringify({ success: true, data: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Items stub
    if (url.pathname === "/api/items") {
      return new Response(
        JSON.stringify({ success: true, data: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Traffic stub — must include data + stats to avoid frontend crash
    if (url.pathname === "/api/traffic") {
      return new Response(
        JSON.stringify({ success: true, data: [], stats: { total: 0, avgLatency: 0, errorCount: 0, cacheHits: 0 } }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Intercepts stub
    if (url.pathname === "/api/intercepts") {
      return new Response(
        JSON.stringify({ success: true, data: [], count: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Config stub
    if (url.pathname === "/api/config") {
      return new Response(
        JSON.stringify({ success: true, data: {} }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Default: redirect to self-hosted backend
    return new Response(
      JSON.stringify({
        success: true,
        message: "Edge Gateway backend is self-hosted (Pangolin/frp/NetBird). This CF Worker is a compatibility shim.",
        health: `${url.origin}/health`,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  },
};
