// Edge Gateway entrypoint — a vanilla Cloudflare Worker that fronts the
// ItemsStore Durable Object. It handles CORS, security headers, per-IP rate
// limiting (in the DO), and real edge caching for GET reads via the Cache API.

export { ItemsStore } from "./items-store";

type Env = {
  DO: Fetcher;
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
  /** TTL in seconds for intercept captures (default: 600 = 10 min). */
  INTERCEPT_TTL_SECONDS?: string;
  /** Bearer token required on all write, intercept, and config endpoints. */
  API_KEY?: string;
  /** Comma-separated CORS origins; empty or unset allows * (any). */
  ALLOWED_ORIGINS?: string;
};

const CF_API = "https://api.cloudflare.com/client/v4";

/**
 * Build Cloudflare API auth headers from the configured credentials. A scoped
 * Bearer token wins if present, otherwise the global key + account email is
 * used. Returns null when nothing is configured.
 */
function cfAuthHeaders(env: Env): Record<string, string> | null {
  if (env.CF_API_TOKEN) {
    return { Authorization: `Bearer ${env.CF_API_TOKEN}` };
  }
  if (env.CF_API_KEY && env.CF_API_EMAIL) {
    return { "X-Auth-Email": env.CF_API_EMAIL, "X-Auth-Key": env.CF_API_KEY };
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
  const auth = cfAuthHeaders(env);
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
  return env.DO.fetch(req);
}

/**
 * Allocate a purchased Cloudflare domain to a proxy target. Creates a proxied
 * CNAME record in the chosen zone pointing at this gateway host, then records
 * the hostname on the target so the app can surface it. Body:
 * `{ proxyId, zoneId, hostname }`.
 */
async function allocateDomain(request: Request, env: Env): Promise<Response> {
  const auth = cfAuthHeaders(env);
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

// Hop-by-hop headers must never be forwarded between client <-> origin.
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

const STORE_ID = "global";

/**
 * Resolve the CORS Allow-Origin header for a request. Uses the ALLOWED_ORIGINS
 * env var (comma-separated list) if set, otherwise falls back to *.
 */
function resolveCorsOrigin(request: Request, env: Env): string {
  const allowed = (env.ALLOWED_ORIGINS ?? "").trim();
  if (!allowed) return "*";
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
  // Intercept access
  if (path === "/api/intercepts") return true;
  // Config access
  if (path === "/api/config") return true;
  return false;
}

/** Check the Authorization header against the configured API_KEY. Returns null on success or a 401 Response on failure. */
function checkAuth(request: Request, env: Env): Response | null {
  if (!env.API_KEY) return null; // No key configured => auth is opt-out.
  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== env.API_KEY) {
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
  return env.DO.fetch(wrapped);
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
};

/** Look up a proxy from the DO by its numeric id (internal). */
async function resolveProxyById(
  env: Env,
  id: number,
): Promise<ProxyConfig & { proxyDomain?: string; cfZoneId?: string; cfRecordId?: string } | null> {
  const req = new Request(`https://do/__proxy-by-id?id=${id}`);
  req.headers.set("X-Rork-DO-Class", "ItemsStore");
  req.headers.set("X-Rork-DO-Id", STORE_ID);
  const res = await env.DO.fetch(req);
  if (!res.ok) return null;
  const json = (await res.json()) as {
    data?: ProxyConfig & { proxyDomain?: string; cfZoneId?: string; cfRecordId?: string };
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
  const auth = cfAuthHeaders(env);
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
  const auth = cfAuthHeaders(env);
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
  const res = await env.DO.fetch(req);
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: ProxyConfig };
  return json.data ?? null;
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
  return env.DO.fetch(req).then(() => undefined);
}
function bumpProxyHits(env: Env, slug: string): Promise<void> {
  const req = new Request("https://do/__proxy-hit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug }),
  });
  req.headers.set("X-Rork-DO-Class", "ItemsStore");
  req.headers.set("X-Rork-DO-Id", STORE_ID);
  return env.DO.fetch(req).then(() => undefined);
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
  return env.DO.fetch(log).then(() => undefined);
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
  return env.DO.fetch(ic).then(() => undefined);
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

function decorate(response: Response, request?: Request, env?: Env, extra?: Record<string, string>): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS)) {
    headers.set(k, v);
  }
  if (request && env) {
    headers.set("Access-Control-Allow-Origin", resolveCorsOrigin(request, env));
  } else {
    headers.set("Access-Control-Allow-Origin", "*");
  }
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
async function reverseProxy(
  request: Request,
  env: Env,
): Promise<{ response: Response; proxy: string }> {
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
    const config = await resolveProxy(env, slug);
    if (!config) {
      return {
        proxy: slug,
        response: decorate(
          Response.json(
            { success: false, error: `no proxy configured for "${slug}"` },
            { status: 404 },
          ),
          request,
          env,
        ),
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
          request,
          env,
        ),
      };
    }
    targetBase = config.targetUrl;
    rest = segments.slice(1).join("/");
    proxyLabel = config.slug;
  } else {
    targetBase = env.PROXY_TARGET;
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
        request,
        env,
      ),
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
        request,
        env,
      ),
    };
  }

  // Map remaining path onto the target origin, preserving query (minus ?target).
  const basePath = target.pathname.replace(/\/$/, "");
  target.pathname = `${basePath}/${rest}`.replace(/\/{2,}/g, "/");
  incoming.searchParams.delete("target");
  target.search = incoming.searchParams.toString();

  const headers = new Headers(request.headers);
  for (const name of HOP_BY_HOP) headers.delete(name);
  headers.set("Host", target.host);
  headers.set("X-Forwarded-Host", incoming.host);
  headers.set("X-Forwarded-Proto", incoming.protocol.replace(":", ""));
  headers.set(
    "X-Forwarded-For",
    request.headers.get("CF-Connecting-IP") ??
      request.headers.get("X-Forwarded-For") ??
      "anonymous",
  );
  headers.set("X-Gateway-Version", GATEWAY_VERSION);

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
    for (const name of HOP_BY_HOP) respHeaders.delete(name);
    respHeaders.set("X-Proxied-By", "edge-gateway-dashboard");
    if (proxyLabel) respHeaders.set("X-Proxy-Target", proxyLabel);

    // Intercept capture: only if lab mode is on AND this proxy has intercept
    // enabled. We read limited request/response bodies asynchronously so the
    // client response is never delayed.
    const labOn = env.INTERCEPT_LAB_MODE === "true";
    const interceptProxy = segments.length > 0
      ? await resolveProxy(env, segments[0])
      : null;
    const shouldIntercept = labOn && interceptProxy?.interceptEnabled;

    let interceptPromise: Promise<void> | undefined;
    if (shouldIntercept) {
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

    return {
      proxy: proxyLabel,
      response: decorate(
        new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: respHeaders,
        }),
        request,
        env,
      ),
      interceptPromise,
    };
  } catch {
    return {
      proxy: proxyLabel,
      response: decorate(
        Response.json(
          { success: false, error: "bad gateway — upstream unreachable" },
          { status: 502 },
        ),
        request,
        env,
      ),
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
      headers.set("Access-Control-Allow-Origin", resolveCorsOrigin(request, env));
      return new Response(null, { status: 204, headers });
    }

    if (path === "/" || path === "/ping") {
      return decorate(
        Response.json({
          ok: true,
          gateway: "edge-gateway-dashboard",
          timestamp: new Date().toISOString(),
        }),
        request,
        env,
      );
    }

    const clientIp =
      request.headers.get("CF-Connecting-IP") ??
      request.headers.get("X-Forwarded-For") ??
      "anonymous";

    if (path === "/proxy" || path.startsWith("/proxy/")) {
      const { response: proxied, proxy, interceptPromise } = await reverseProxy(request, env);
      ctx.waitUntil(
        logTraffic(
          request,
          env,
          buildTrafficEntry(request, proxied, path, Date.now() - start, clientIp, proxy),
        ),
      );
      if (proxy) ctx.waitUntil(bumpProxyHits(env, proxy));
      if (interceptPromise) ctx.waitUntil(interceptPromise);
      return proxied;
    }

    if (path === "/api/cloudflare/zones" && method === "GET") {
      return await listZones(env);
    }
    if (path === "/api/cloudflare/allocate" && method === "POST") {
      return await allocateDomain(request, env);
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
    // --- Auth gate ----------------------------------------------------
    if (requiresAuth(path, method)) {
      const authErr = checkAuth(request, env);
      if (authErr) return authErr;
    }

    const isConfigRoute = path === "/api/config";
    if (
      path !== "/health" &&
      !path.startsWith("/api/items") &&
      !isTraffic &&
      !isIntercepts &&
      !isProxyConfig &&
      !isConfigRoute
    ) {
      return decorate(
        Response.json({ success: false, error: "not found" }, { status: 404 }),
        request,
        env,
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
    const decorated = decorate(response, request, env, extra);

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
