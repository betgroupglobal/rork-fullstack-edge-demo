// Edge Gateway entrypoint — a vanilla Cloudflare Worker that fronts the
// ItemsStore Durable Object. It handles CORS, security headers, per-IP rate
// limiting (in the DO), and real edge caching for GET reads via the Cache API.

export { ItemsStore } from "./items-store";

type Env = {
  DO: Fetcher;
  /** Default upstream origin for the reverse proxy, e.g. "https://example.com". */
  PROXY_TARGET?: string;
};

const RATE_LIMIT_REQUESTS = 100;
const RATE_LIMIT_WINDOW = 60; // seconds
const CACHE_TTL = 10; // seconds
const GATEWAY_VERSION = "1.0.0";

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
  "Access-Control-Allow-Origin": "*",
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
};

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

/** Fire-and-forget bump of a proxy target's hit counter. */
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

function decorate(response: Response, extra?: Record<string, string>): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries({ ...CORS, ...SECURITY, ...(extra ?? {}) })) {
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
    return {
      proxy: proxyLabel,
      response: decorate(
        new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: respHeaders,
        }),
      ),
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
      return new Response(null, { status: 204, headers: { ...CORS, ...SECURITY } });
    }

    if (path === "/" || path === "/ping") {
      return decorate(
        Response.json({
          ok: true,
          gateway: "edge-gateway-dashboard",
          timestamp: new Date().toISOString(),
        }),
      );
    }

    const clientIp =
      request.headers.get("CF-Connecting-IP") ??
      request.headers.get("X-Forwarded-For") ??
      "anonymous";

    if (path === "/proxy" || path.startsWith("/proxy/")) {
      const { response: proxied, proxy } = await reverseProxy(request, env);
      ctx.waitUntil(
        logTraffic(
          request,
          env,
          buildTrafficEntry(request, proxied, path, Date.now() - start, clientIp, proxy),
        ),
      );
      if (proxy) ctx.waitUntil(bumpProxyHits(env, proxy));
      return proxied;
    }

    const isTraffic = path === "/api/traffic";
    const isProxyConfig = path === "/api/proxies" || /^\/api\/proxies\/\d+$/.test(path);
    if (
      path !== "/health" &&
      !path.startsWith("/api/items") &&
      !isTraffic &&
      !isProxyConfig
    ) {
      return decorate(
        Response.json({ success: false, error: "not found" }, { status: 404 }),
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
    const decorated = decorate(response, extra);

    // Intercept everything except reads of the analyser feed and proxy config
    // management, so the traffic view doesn't fill up with its own polling.
    if (!isTraffic && !isProxyConfig) {
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
