var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-FjB22G/checked-fetch.js
var urls = /* @__PURE__ */ new Set();
function checkURL(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls.has(url.toString())) {
      urls.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
__name(checkURL, "checkURL");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    const [request, init] = argArray;
    checkURL(request, init);
    return Reflect.apply(target, thisArg, argArray);
  }
});

// items-store.ts
import { DurableObject } from "cloudflare:workers";
var TRAFFIC_LIMIT = 200;
var INTERCEPT_LIMIT = 500;
var INTERCEPT_DEFAULT_TTL = 600;
var STARTED_AT_KEY = "startedAt";
var ItemsStore = class extends DurableObject {
  static {
    __name(this, "ItemsStore");
  }
  startedAt;
  listCache = null;
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS rate_hits (
        ip TEXT NOT NULL,
        ts INTEGER NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS traffic (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        status INTEGER NOT NULL,
        latency_ms INTEGER NOT NULL,
        cache TEXT NOT NULL DEFAULT '',
        ip TEXT NOT NULL DEFAULT '',
        country TEXT NOT NULL DEFAULT '',
        colo TEXT NOT NULL DEFAULT '',
        proxy TEXT NOT NULL DEFAULT ''
      )
    `);
    try {
      this.ctx.storage.sql.exec(
        "ALTER TABLE traffic ADD COLUMN proxy TEXT NOT NULL DEFAULT ''"
      );
    } catch {
    }
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS proxies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        target_url TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        hits INTEGER NOT NULL DEFAULT 0,
        proxy_domain TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    try {
      this.ctx.storage.sql.exec(
        "ALTER TABLE proxies ADD COLUMN proxy_domain TEXT NOT NULL DEFAULT ''"
      );
    } catch {
    }
    try {
      this.ctx.storage.sql.exec(
        "ALTER TABLE proxies ADD COLUMN intercept_enabled INTEGER NOT NULL DEFAULT 0"
      );
    } catch {
    }
    try {
      this.ctx.storage.sql.exec(
        "ALTER TABLE proxies ADD COLUMN cf_zone_id TEXT NOT NULL DEFAULT ''"
      );
    } catch {
    }
    try {
      this.ctx.storage.sql.exec(
        "ALTER TABLE proxies ADD COLUMN cf_record_id TEXT NOT NULL DEFAULT ''"
      );
    } catch {
    }
    try {
      this.ctx.storage.sql.exec(
        "ALTER TABLE proxies ADD COLUMN cf_domain_binding_id TEXT NOT NULL DEFAULT ''"
      );
    } catch {
    }
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS intercept_captures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        slug TEXT NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        req_headers TEXT NOT NULL DEFAULT '',
        req_body TEXT NOT NULL DEFAULT '',
        resp_status INTEGER NOT NULL DEFAULT 0,
        resp_headers TEXT NOT NULL DEFAULT '',
        resp_body TEXT NOT NULL DEFAULT '',
        host TEXT NOT NULL DEFAULT ''
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT ''
      )
    `);
    this.startedAt = Date.now();
  }
  /** Read a config value by key. */
  getConfig(key) {
    const row = this.ctx.storage.sql.exec("SELECT value FROM config WHERE key = ?", key).toArray();
    return row.length > 0 ? row[0].value : null;
  }
  /** Write a config value by key (upsert). */
  setConfig(key, value) {
    this.ctx.storage.sql.exec(
      "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key,
      value
    );
  }
  /** Delete a config value by key. */
  deleteConfig(key) {
    this.ctx.storage.sql.exec("DELETE FROM config WHERE key = ?", key);
  }
  /** Get all config keys matching a prefix. */
  getConfigByPrefix(prefix) {
    const rows = this.ctx.storage.sql.exec(
      "SELECT key, value FROM config WHERE key LIKE ?",
      `${prefix}%`
    ).toArray();
    const result = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }
  /**
   * Sliding-window per-IP rate limit. Returns the headers describing the
   * client's current budget plus whether the request is allowed.
   */
  checkRateLimit(ip, limit, windowSeconds) {
    const now = Date.now();
    const windowStart = now - windowSeconds * 1e3;
    this.ctx.storage.sql.exec("DELETE FROM rate_hits WHERE ts < ?", windowStart);
    const used = this.ctx.storage.sql.exec("SELECT COUNT(*) AS n FROM rate_hits WHERE ip = ?", ip).one().n;
    const reset = Math.ceil((now + windowSeconds * 1e3) / 1e3);
    if (used >= limit) {
      return { allowed: false, remaining: 0, reset };
    }
    this.ctx.storage.sql.exec("INSERT INTO rate_hits (ip, ts) VALUES (?, ?)", ip, now);
    return { allowed: true, remaining: Math.max(0, limit - used - 1), reset };
  }
  async ensureStartedAt() {
    const stored = await this.ctx.storage.get(STARTED_AT_KEY);
    if (stored) {
      this.startedAt = stored;
      return stored;
    }
    await this.ctx.storage.put(STARTED_AT_KEY, this.startedAt);
    return this.startedAt;
  }
  /** Record an intercept capture — request + response payloads for a proxied target. */
  recordIntercept(entry) {
    this.ctx.storage.sql.exec(
      "INSERT INTO intercept_captures (ts, slug, method, path, req_headers, req_body, resp_status, resp_headers, resp_body, host) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      entry.ts,
      entry.slug,
      entry.method,
      entry.path,
      entry.reqHeaders,
      entry.reqBody,
      entry.respStatus,
      entry.respHeaders,
      entry.respBody,
      entry.host
    );
    this.ctx.storage.sql.exec(
      "DELETE FROM intercept_captures WHERE id NOT IN (SELECT id FROM intercept_captures ORDER BY id DESC LIMIT ?)",
      INTERCEPT_LIMIT
    );
  }
  /** Purge captures older than `ttlSeconds` across all slugs. */
  purgeExpiredIntercepts(ttlSeconds) {
    const cutoff = Date.now() - ttlSeconds * 1e3;
    this.ctx.storage.sql.exec("DELETE FROM intercept_captures WHERE ts < ?", cutoff);
  }
  listIntercepts() {
    return this.ctx.storage.sql.exec("SELECT * FROM intercept_captures ORDER BY id DESC LIMIT ?", INTERCEPT_LIMIT).toArray().map((row) => ({
      id: row.id,
      ts: row.ts,
      slug: row.slug,
      method: row.method,
      path: row.path,
      reqHeaders: row.req_headers,
      reqBody: row.req_body,
      respStatus: row.resp_status,
      respHeaders: row.resp_headers,
      respBody: row.resp_body,
      host: row.host
    }));
  }
  clearIntercepts() {
    this.ctx.storage.sql.exec("DELETE FROM intercept_captures");
  }
  /**
   * Append a traffic entry captured by the gateway interceptor, then trim the
   * ring buffer to the most recent TRAFFIC_LIMIT rows.
   */
  recordTraffic(entry) {
    this.ctx.storage.sql.exec(
      "INSERT INTO traffic (ts, method, path, status, latency_ms, cache, ip, country, colo, proxy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      entry.ts,
      entry.method,
      entry.path,
      entry.status,
      entry.latencyMs,
      entry.cache,
      entry.ip,
      entry.country,
      entry.colo,
      entry.proxy ?? ""
    );
    this.ctx.storage.sql.exec(
      "DELETE FROM traffic WHERE id NOT IN (SELECT id FROM traffic ORDER BY id DESC LIMIT ?)",
      TRAFFIC_LIMIT
    );
  }
  listTraffic() {
    return this.ctx.storage.sql.exec("SELECT * FROM traffic ORDER BY id DESC LIMIT ?", TRAFFIC_LIMIT).toArray().map((row) => ({
      id: row.id,
      ts: row.ts,
      method: row.method,
      path: row.path,
      status: row.status,
      latencyMs: row.latency_ms,
      cache: row.cache,
      ip: row.ip,
      country: row.country,
      colo: row.colo,
      proxy: row.proxy ?? ""
    }));
  }
  // --- Proxy targets ---------------------------------------------------
  toProxy(row) {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      targetUrl: row.target_url,
      enabled: row.enabled === 1,
      hits: row.hits,
      proxyDomain: row.proxy_domain ?? "",
      interceptEnabled: row.intercept_enabled === 1,
      cfZoneId: row.cf_zone_id ?? "",
      cfRecordId: row.cf_record_id ?? "",
      cfDomainBindingId: row.cf_domain_binding_id ?? "",
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
  /** Set (or clear) the allocated proxy domain for a target by id, including CF record tracking. */
  setProxyDomain(id, proxyDomain, cfZoneId, cfRecordId, cfDomainBindingId) {
    const existing = this.findProxy(id);
    if (!existing) return null;
    this.ctx.storage.sql.exec(
      "UPDATE proxies SET proxy_domain = ?, cf_zone_id = ?, cf_record_id = ?, cf_domain_binding_id = ?, updated_at = ? WHERE id = ?",
      proxyDomain,
      cfZoneId ?? "",
      cfRecordId ?? "",
      cfDomainBindingId ?? "",
      Date.now(),
      id
    );
    return this.findProxy(id);
  }
  listProxies() {
    return this.ctx.storage.sql.exec("SELECT * FROM proxies ORDER BY created_at DESC").toArray().map((row) => this.toProxy(row));
  }
  findProxy(id) {
    const rows = this.ctx.storage.sql.exec("SELECT * FROM proxies WHERE id = ?", id).toArray();
    return rows.length > 0 ? this.toProxy(rows[0]) : null;
  }
  findProxyBySlug(slug) {
    const rows = this.ctx.storage.sql.exec("SELECT * FROM proxies WHERE slug = ?", slug).toArray();
    return rows.length > 0 ? this.toProxy(rows[0]) : null;
  }
  findProxyByDomain(domain) {
    const rows = this.ctx.storage.sql.exec("SELECT * FROM proxies WHERE proxy_domain = ?", domain).toArray();
    return rows.length > 0 ? this.toProxy(rows[0]) : null;
  }
  /** Build a URL-safe, unique slug from a display name (or target host). */
  uniqueSlug(base) {
    const root = base.toLowerCase().replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "target";
    let slug = root;
    let n = 1;
    while (this.findProxyBySlug(slug)) {
      n += 1;
      slug = `${root}-${n}`;
    }
    return slug;
  }
  incrementProxyHits(slug) {
    this.ctx.storage.sql.exec(
      "UPDATE proxies SET hits = hits + 1 WHERE slug = ?",
      slug
    );
  }
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (path === "/__traffic" && method === "POST") {
      const entry = await this.safeJson(request);
      if (entry) this.recordTraffic(entry);
      return new Response(null, { status: 204 });
    }
    if (path === "/__intercept" && method === "POST") {
      const entry = await this.safeJson(request);
      if (entry) this.recordIntercept(entry);
      return new Response(null, { status: 204 });
    }
    if (path === "/__proxy" && method === "GET") {
      const slug = url.searchParams.get("slug") ?? "";
      const domain = url.searchParams.get("domain") ?? "";
      let proxy = slug ? this.findProxyBySlug(slug) : null;
      if (!proxy && domain) {
        proxy = this.findProxyByDomain(domain);
      }
      if (!proxy) {
        return Response.json({ success: false }, { status: 404 });
      }
      return Response.json({ success: true, data: proxy });
    }
    if (path === "/__proxy-by-id" && method === "GET") {
      const id = Number(url.searchParams.get("id") ?? 0);
      const proxy = this.findProxy(id);
      if (!proxy) {
        return Response.json({ success: false }, { status: 404 });
      }
      return Response.json({ success: true, data: proxy });
    }
    if (path === "/__proxy-hit" && method === "POST") {
      const body = await this.safeJson(request);
      if (body?.slug) this.incrementProxyHits(body.slug);
      return new Response(null, { status: 204 });
    }
    if (path === "/__proxy-domain" && method === "POST") {
      const body = await this.safeJson(request);
      if (!body?.id) {
        return Response.json({ success: false }, { status: 400 });
      }
      const updated = this.setProxyDomain(
        body.id,
        (body.proxyDomain ?? "").trim(),
        body.cfZoneId,
        body.cfRecordId,
        body.cfDomainBindingId
      );
      if (!updated) {
        return Response.json({ success: false }, { status: 404 });
      }
      return Response.json({ success: true, data: updated });
    }
    if (path === "/__config" && method === "GET") {
      const prefix = url.searchParams.get("prefix") ?? "";
      const config = prefix ? this.getConfigByPrefix(prefix) : this.getConfigByPrefix("");
      return Response.json({ success: true, data: config });
    }
    if (path === "/__config" && method === "PUT") {
      const body = await this.safeJson(request);
      if (!body || typeof body !== "object") {
        return Response.json({ success: false, error: "invalid body" }, { status: 400 });
      }
      for (const [key, value] of Object.entries(body)) {
        if (value === null || value === "") {
          this.deleteConfig(key);
        } else {
          this.setConfig(key, value);
        }
      }
      return Response.json({ success: true });
    }
    const ip = request.headers.get("X-Client-IP") ?? "anonymous";
    const limit = Number(request.headers.get("X-Rate-Limit") ?? "100");
    const windowSeconds = Number(request.headers.get("X-Rate-Window") ?? "60");
    const rl = this.checkRateLimit(ip, limit, windowSeconds);
    const rlHeaders = {
      "X-RateLimit-Limit": String(limit),
      "X-RateLimit-Remaining": String(rl.remaining),
      "X-RateLimit-Reset": String(rl.reset)
    };
    if (!rl.allowed) {
      return Response.json(
        { success: false, error: "rate limit exceeded" },
        {
          status: 429,
          headers: { ...rlHeaders, "Retry-After": String(windowSeconds) }
        }
      );
    }
    const withRl = /* @__PURE__ */ __name((response) => {
      for (const [k, v] of Object.entries(rlHeaders)) response.headers.set(k, v);
      return response;
    }, "withRl");
    if (path === "/health") {
      const startedAt = await this.ensureStartedAt();
      const count = this.ctx.storage.sql.exec("SELECT COUNT(*) AS n FROM items").one().n;
      return withRl(
        Response.json({
          status: "ok",
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          uptime: Math.round((Date.now() - startedAt) / 1e3),
          itemCount: count,
          region: "edge"
        })
      );
    }
    if (path === "/api/intercepts" && method === "GET") {
      const ttlSeconds = Number(request.headers.get("X-Intercept-TTL") ?? INTERCEPT_DEFAULT_TTL);
      this.purgeExpiredIntercepts(ttlSeconds);
      const captures = this.listIntercepts();
      return withRl(
        Response.json({ success: true, data: captures, count: captures.length })
      );
    }
    if (path === "/api/intercepts" && method === "DELETE") {
      this.clearIntercepts();
      return withRl(Response.json({ success: true, data: null }));
    }
    if (path === "/api/traffic" && method === "GET") {
      const entries = this.listTraffic();
      const total = entries.length;
      const avgLatency = total > 0 ? Math.round(entries.reduce((sum, e) => sum + e.latencyMs, 0) / total) : 0;
      const errorCount = entries.filter((e) => e.status >= 400).length;
      const cacheHits = entries.filter((e) => e.cache === "HIT").length;
      return withRl(
        Response.json({
          success: true,
          data: entries,
          stats: { total, avgLatency, errorCount, cacheHits }
        })
      );
    }
    if (path === "/api/proxies" && method === "GET") {
      return withRl(
        Response.json({ success: true, data: this.listProxies() })
      );
    }
    if (path === "/api/proxies" && method === "POST") {
      const body = await this.safeJson(request);
      const targetUrl = (body?.targetUrl ?? "").toString().trim();
      const name = (body?.name ?? "").toString().trim();
      let parsed;
      try {
        parsed = new URL(targetUrl);
      } catch {
        return Response.json(
          { success: false, error: "a valid target URL (https://\u2026) is required" },
          { status: 400 }
        );
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return Response.json(
          { success: false, error: "target must be an http(s) URL" },
          { status: 400 }
        );
      }
      const label = name || parsed.hostname;
      const slug = this.uniqueSlug(name || parsed.hostname);
      const now = Date.now();
      this.ctx.storage.sql.exec(
        "INSERT INTO proxies (slug, name, target_url, enabled, hits, intercept_enabled, created_at, updated_at) VALUES (?, ?, ?, 1, 0, 0, ?, ?)",
        slug,
        label,
        parsed.toString().replace(/\/$/, ""),
        now,
        now
      );
      const created = this.ctx.storage.sql.exec("SELECT * FROM proxies WHERE id = last_insert_rowid()").one();
      return withRl(
        Response.json(
          { success: true, data: this.toProxy(created) },
          { status: 201 }
        )
      );
    }
    const proxyIdMatch = path.match(/^\/api\/proxies\/(\d+)$/);
    if (proxyIdMatch) {
      const id = Number(proxyIdMatch[1]);
      const existing = this.findProxy(id);
      if (!existing) {
        return Response.json(
          { success: false, error: "proxy not found" },
          { status: 404 }
        );
      }
      if (method === "PUT") {
        const body = await this.safeJson(request);
        let targetUrl = existing.targetUrl;
        if (body?.targetUrl !== void 0) {
          try {
            const parsed = new URL(String(body.targetUrl).trim());
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
              throw new Error("bad protocol");
            }
            targetUrl = parsed.toString().replace(/\/$/, "");
          } catch {
            return Response.json(
              { success: false, error: "target must be a valid http(s) URL" },
              { status: 400 }
            );
          }
        }
        const name = body?.name !== void 0 ? String(body.name).trim() : existing.name;
        const enabled = body?.enabled !== void 0 ? body.enabled ? 1 : 0 : existing.enabled ? 1 : 0;
        const interceptEnabled = body?.interceptEnabled !== void 0 ? body.interceptEnabled ? 1 : 0 : existing.interceptEnabled ? 1 : 0;
        const proxyDomain = body?.proxyDomain !== void 0 ? String(body.proxyDomain).trim() : existing.proxyDomain;
        this.ctx.storage.sql.exec(
          "UPDATE proxies SET name = ?, target_url = ?, enabled = ?, intercept_enabled = ?, proxy_domain = ?, updated_at = ? WHERE id = ?",
          name || existing.name,
          targetUrl,
          enabled,
          interceptEnabled,
          proxyDomain,
          Date.now(),
          id
        );
        return withRl(Response.json({ success: true, data: this.findProxy(id) }));
      }
      if (method === "DELETE") {
        this.ctx.storage.sql.exec("DELETE FROM proxies WHERE id = ?", id);
        return withRl(Response.json({ success: true, data: existing }));
      }
    }
    if (path === "/api/items" && method === "GET") {
      const ttl = Number(request.headers.get("X-Cache-TTL") ?? "10");
      const now = Date.now();
      if (this.listCache && this.listCache.expires > now) {
        return withRl(this.jsonCached(this.listCache.body, "HIT"));
      }
      const items = this.listItems();
      const body = JSON.stringify({ success: true, data: items, count: items.length });
      this.listCache = { body, expires: now + ttl * 1e3 };
      return withRl(this.jsonCached(body, "MISS"));
    }
    if (path === "/api/items" && method === "POST") {
      const body = await this.safeJson(request);
      const name = (body?.name ?? "").trim();
      if (!name) {
        return Response.json(
          { success: false, error: "name is required" },
          { status: 400 }
        );
      }
      const description = (body?.description ?? "").toString();
      const now = Date.now();
      this.ctx.storage.sql.exec(
        "INSERT INTO items (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)",
        name,
        description,
        now,
        now
      );
      this.listCache = null;
      const created = this.ctx.storage.sql.exec("SELECT * FROM items WHERE id = last_insert_rowid()").one();
      return withRl(
        Response.json(
          { success: true, data: this.toItem(created) },
          { status: 201 }
        )
      );
    }
    const idMatch = path.match(/^\/api\/items\/(\d+)$/);
    if (idMatch) {
      const id = Number(idMatch[1]);
      if (method === "PUT") {
        const existing = this.findItem(id);
        if (!existing) {
          return Response.json(
            { success: false, error: "item not found" },
            { status: 404 }
          );
        }
        const body = await this.safeJson(request);
        const name = body?.name !== void 0 ? String(body.name).trim() : existing.name;
        if (!name) {
          return Response.json(
            { success: false, error: "name is required" },
            { status: 400 }
          );
        }
        const description = body?.description !== void 0 ? String(body.description) : existing.description;
        const now = Date.now();
        this.ctx.storage.sql.exec(
          "UPDATE items SET name = ?, description = ?, updated_at = ? WHERE id = ?",
          name,
          description,
          now,
          id
        );
        this.listCache = null;
        return withRl(Response.json({ success: true, data: this.findItem(id) }));
      }
      if (method === "DELETE") {
        const existing = this.findItem(id);
        if (!existing) {
          return Response.json(
            { success: false, error: "item not found" },
            { status: 404 }
          );
        }
        this.ctx.storage.sql.exec("DELETE FROM items WHERE id = ?", id);
        this.listCache = null;
        return withRl(Response.json({ success: true, data: existing }));
      }
    }
    return Response.json({ success: false, error: "not found" }, { status: 404 });
  }
  jsonCached(body, cache) {
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Cache": cache }
    });
  }
  listItems() {
    return this.ctx.storage.sql.exec("SELECT * FROM items ORDER BY created_at DESC").toArray().map((row) => this.toItem(row));
  }
  findItem(id) {
    const rows = this.ctx.storage.sql.exec("SELECT * FROM items WHERE id = ?", id).toArray();
    return rows.length > 0 ? this.toItem(rows[0]) : null;
  }
  toItem(row) {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
  async safeJson(request) {
    try {
      return await request.json();
    } catch {
      return null;
    }
  }
};

// index.ts
var CF_API = "https://api.cloudflare.com/client/v4";
function cfAuthHeaders(env) {
  if (env.CF_API_TOKEN) {
    return { Authorization: `Bearer ${env.CF_API_TOKEN}` };
  }
  if (env.CF_API_KEY && env.CF_API_EMAIL) {
    return { "X-Auth-Email": env.CF_API_EMAIL, "X-Auth-Key": env.CF_API_KEY };
  }
  return null;
}
__name(cfAuthHeaders, "cfAuthHeaders");
async function loadCfAuth(env) {
  const fromEnv = cfAuthHeaders(env);
  if (fromEnv) return fromEnv;
  const config = await readConfigFromDO(env, "cf.");
  const token = config["cf.api_token"] ?? "";
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  const key = config["cf.api_key"] ?? "";
  const email = config["cf.api_email"] ?? "";
  if (key && email) {
    return { "X-Auth-Email": email, "X-Auth-Key": key };
  }
  return null;
}
__name(loadCfAuth, "loadCfAuth");
async function readConfigFromDO(env, prefix) {
  const req = new Request(
    `https://do/__config?prefix=${encodeURIComponent(prefix)}`
  );
  req.headers.set("X-Rork-DO-Class", "ItemsStore");
  req.headers.set("X-Rork-DO-Id", STORE_ID);
  const res = await fetchDO(env, req);
  if (!res.ok) return {};
  const json = await res.json();
  return json.data ?? {};
}
__name(readConfigFromDO, "readConfigFromDO");
async function writeConfigToDO(env, entries) {
  const req = new Request("https://do/__config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entries)
  });
  req.headers.set("X-Rork-DO-Class", "ItemsStore");
  req.headers.set("X-Rork-DO-Id", STORE_ID);
  await fetchDO(env, req);
}
__name(writeConfigToDO, "writeConfigToDO");
function fetchDO(env, req) {
  const doId = env.DO.idFromName(STORE_ID);
  return env.DO.get(doId).fetch(req);
}
__name(fetchDO, "fetchDO");
async function listZones(env) {
  const auth = await loadCfAuth(env);
  if (!auth) {
    return decorate(
      Response.json(
        { success: false, configured: false, error: "Cloudflare credentials not configured" },
        { status: 200 }
      )
    );
  }
  try {
    const res = await fetch(`${CF_API}/zones?per_page=50&status=active`, {
      headers: auth
    });
    const json = await res.json();
    if (!json.success) {
      return decorate(
        Response.json(
          {
            success: false,
            configured: true,
            error: json.errors?.[0]?.message ?? "Cloudflare API rejected the request"
          },
          { status: 502 }
        )
      );
    }
    const zones = (json.result ?? []).map((z) => ({
      id: z.id,
      name: z.name,
      status: z.status
    }));
    return decorate(Response.json({ success: true, configured: true, data: zones }));
  } catch {
    return decorate(
      Response.json(
        { success: false, configured: true, error: "could not reach the Cloudflare API" },
        { status: 502 }
      )
    );
  }
}
__name(listZones, "listZones");
async function listWorkers(env) {
  const auth = await loadCfAuth(env);
  if (!auth) {
    return decorate(
      Response.json(
        { success: false, configured: false, error: "Cloudflare credentials not configured" },
        { status: 200 }
      )
    );
  }
  try {
    const accountsRes = await fetch(`${CF_API}/accounts?per_page=5`, {
      headers: auth
    });
    const accountsJson = await accountsRes.json();
    if (!accountsJson.success || !accountsJson.result?.length) {
      return decorate(
        Response.json({
          success: false,
          configured: true,
          error: accountsJson.errors?.[0]?.message ?? "No Cloudflare accounts found"
        }, { status: 502 })
      );
    }
    const accountId = accountsJson.result[0].id;
    const subdomainRes = await fetch(
      `${CF_API}/accounts/${accountId}/workers/subdomain`,
      { headers: auth }
    );
    const subdomainJson = await subdomainRes.json();
    const subdomain = subdomainJson.result?.subdomain ?? "";
    const scriptsRes = await fetch(
      `${CF_API}/accounts/${accountId}/workers/scripts?per_page=50`,
      { headers: auth }
    );
    const scriptsJson = await scriptsRes.json();
    if (!scriptsJson.success) {
      return decorate(
        Response.json({
          success: false,
          configured: true,
          error: scriptsJson.errors?.[0]?.message ?? "Could not list workers"
        }, { status: 502 })
      );
    }
    const workers = (scriptsJson.result ?? []).map((w) => ({
      id: w.id,
      hostname: subdomain ? `${w.id}.${subdomain}.workers.dev` : w.id
    }));
    return decorate(
      Response.json({ success: true, configured: true, data: workers, subdomain })
    );
  } catch {
    return decorate(
      Response.json(
        { success: false, configured: true, error: "could not reach the Cloudflare API" },
        { status: 502 }
      )
    );
  }
}
__name(listWorkers, "listWorkers");
function setProxyDomain(env, id, proxyDomain, cfZoneId, cfRecordId, cfDomainBindingId) {
  const req = new Request("https://do/__proxy-domain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, proxyDomain, cfZoneId, cfRecordId, cfDomainBindingId })
  });
  req.headers.set("X-Rork-DO-Class", "ItemsStore");
  req.headers.set("X-Rork-DO-Id", STORE_ID);
  return fetchDO(env, req);
}
__name(setProxyDomain, "setProxyDomain");
async function getZoneDetails(env, auth, zoneId) {
  try {
    const res = await fetch(`${CF_API}/zones/${zoneId}`, {
      headers: auth
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.success && json.result?.account?.id) {
      return {
        zoneName: json.result.name,
        accountId: json.result.account.id
      };
    }
  } catch {
  }
  return null;
}
__name(getZoneDetails, "getZoneDetails");
async function findWorkerService(env, auth, accountId, gatewayHost) {
  try {
    const res = await fetch(`${CF_API}/accounts/${accountId}/workers/scripts?per_page=50`, {
      headers: auth
    });
    if (res.ok) {
      const json = await res.json();
      if (json.success && json.result) {
        const match = json.result.find(
          (w) => gatewayHost.toLowerCase() === w.id.toLowerCase() || gatewayHost.toLowerCase().startsWith(`${w.id.toLowerCase()}.`)
        );
        if (match) return match.id;
      }
    }
  } catch {
  }
  return gatewayHost.split(".")[0] || null;
}
__name(findWorkerService, "findWorkerService");
async function allocateDomain(request, env) {
  const auth = await loadCfAuth(env);
  if (!auth) {
    return decorate(
      Response.json(
        { success: false, configured: false, error: "Cloudflare credentials not configured" },
        { status: 400 }
      )
    );
  }
  const body = await request.json().catch(() => null);
  const proxyId = Number(body?.proxyId);
  const zoneId = (body?.zoneId ?? "").toString().trim();
  const hostname = (body?.hostname ?? "").toString().trim().toLowerCase();
  if (!proxyId || !zoneId || !hostname || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(hostname)) {
    return decorate(
      Response.json(
        { success: false, error: "proxyId, zoneId and a valid hostname are required" },
        { status: 400 }
      )
    );
  }
  const zoneDetails = await getZoneDetails(env, auth, zoneId);
  if (!zoneDetails) {
    return decorate(
      Response.json(
        { success: false, error: "could not retrieve zone details from Cloudflare" },
        { status: 502 }
      )
    );
  }
  const { zoneName, accountId } = zoneDetails;
  const configuredHost = (await readConfigFromDO(env, "cf."))["cf.gateway_host"] ?? "";
  const gatewayHost = configuredHost || new URL(request.url).host;
  const serviceName = await findWorkerService(env, auth, accountId, gatewayHost);
  if (!serviceName) {
    return decorate(
      Response.json(
        { success: false, error: "could not resolve Cloudflare Worker script service name" },
        { status: 500 }
      )
    );
  }
  try {
    const existingDnsRes = await fetch(
      `${CF_API}/zones/${zoneId}/dns_records?name=${hostname}`,
      { headers: auth }
    );
    if (existingDnsRes.ok) {
      const existingDns = await existingDnsRes.json();
      if (existingDns.success && existingDns.result) {
        for (const record of existingDns.result) {
          await fetch(`${CF_API}/zones/${zoneId}/dns_records/${record.id}`, {
            method: "DELETE",
            headers: auth
          }).catch(() => null);
        }
      }
    }
    const domainRes = await fetch(`${CF_API}/accounts/${accountId}/workers/domains`, {
      method: "PUT",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        zone_id: zoneId,
        zone_name: zoneName,
        hostname,
        service: serviceName,
        environment: "production"
      })
    });
    const domainJson = await domainRes.json();
    if (!domainJson.success) {
      const message = domainJson.errors?.[0]?.message ?? "could not bind custom domain to worker";
      return decorate(
        Response.json({ success: false, error: message }, { status: 502 })
      );
    }
    const cfDomainBindingId = domainJson.result?.id ?? "";
    let dnsRecordId = "";
    try {
      const dnsQueryRes = await fetch(
        `${CF_API}/zones/${zoneId}/dns_records?name=${hostname}&type=CNAME`,
        { headers: auth }
      );
      if (dnsQueryRes.ok) {
        const dnsQueryJson = await dnsQueryRes.json();
        if (dnsQueryJson.success && dnsQueryJson.result?.length) {
          dnsRecordId = dnsQueryJson.result[0].id;
        }
      }
    } catch {
    }
    const stored = await setProxyDomain(
      env,
      proxyId,
      hostname,
      zoneId,
      dnsRecordId,
      cfDomainBindingId
    );
    const storedJson = await stored.json().catch(() => null);
    return decorate(
      Response.json({
        success: true,
        data: {
          hostname,
          target: gatewayHost,
          record: { id: dnsRecordId, name: hostname },
          proxy: storedJson?.data ?? null
        }
      })
    );
  } catch {
    return decorate(
      Response.json(
        { success: false, error: "could not reach the Cloudflare API" },
        { status: 502 }
      )
    );
  }
}
__name(allocateDomain, "allocateDomain");
var RATE_LIMIT_REQUESTS = 100;
var RATE_LIMIT_WINDOW = 60;
var CACHE_TTL = 10;
var GATEWAY_VERSION = "1.0.0";
var INTERCEPT_BODY_MAX_BYTES = 16384;
var HOP_BY_HOP = /* @__PURE__ */ new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Expose-Headers": "X-Cache, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-Edge-Latency, Retry-After"
};
var SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()"
};
var STORE_ID = "global";
function dispatch(request, env) {
  const wrapped = new Request(request.url, request);
  wrapped.headers.set("X-Rork-DO-Class", "ItemsStore");
  wrapped.headers.set("X-Rork-DO-Id", STORE_ID);
  return fetchDO(env, wrapped);
}
__name(dispatch, "dispatch");
async function resolveProxyById(env, id) {
  const req = new Request(`https://do/__proxy-by-id?id=${id}`);
  req.headers.set("X-Rork-DO-Class", "ItemsStore");
  req.headers.set("X-Rork-DO-Id", STORE_ID);
  const res = await fetchDO(env, req);
  if (!res.ok) return null;
  const json = await res.json();
  return json.data ?? null;
}
__name(resolveProxyById, "resolveProxyById");
async function cleanupCloudflareResources(env, zoneId, recordId, domainBindingId) {
  const auth = await loadCfAuth(env);
  if (!auth) return;
  if (zoneId && recordId) {
    try {
      await fetch(`${CF_API}/zones/${zoneId}/dns_records/${recordId}`, {
        method: "DELETE",
        headers: auth
      });
    } catch {
    }
  }
  if (zoneId && domainBindingId) {
    try {
      const zoneDetails = await getZoneDetails(env, auth, zoneId);
      if (zoneDetails?.accountId) {
        await fetch(`${CF_API}/accounts/${zoneDetails.accountId}/workers/domains/${domainBindingId}`, {
          method: "DELETE",
          headers: auth
        });
      }
    } catch {
    }
  }
}
__name(cleanupCloudflareResources, "cleanupCloudflareResources");
async function autoAllocateDomain(env, proxyId, slug, fallbackHost) {
  const auth = await loadCfAuth(env);
  if (!auth) return;
  const configuredHost = (await readConfigFromDO(env, "cf."))["cf.gateway_host"] ?? "";
  const gatewayHost = configuredHost || fallbackHost;
  const zonesRes = await fetch(`${CF_API}/zones?per_page=5&status=active`, {
    headers: auth
  }).catch(() => null);
  if (!zonesRes?.ok) return;
  const zonesJson = await zonesRes.json();
  const zone = zonesJson.result?.[0];
  if (!zone) return;
  const hostname = `${slug}.${zone.name}`;
  try {
    const existingDnsRes = await fetch(
      `${CF_API}/zones/${zone.id}/dns_records?name=${hostname}`,
      { headers: auth }
    );
    if (existingDnsRes.ok) {
      const existingDns = await existingDnsRes.json();
      if (existingDns.success && existingDns.result) {
        for (const record of existingDns.result) {
          await fetch(`${CF_API}/zones/${zone.id}/dns_records/${record.id}`, {
            method: "DELETE",
            headers: auth
          }).catch(() => null);
        }
      }
    }
  } catch {
  }
  let cfDomainBindingId = "";
  try {
    const zoneDetails = await getZoneDetails(env, auth, zone.id);
    if (zoneDetails) {
      const workerService = await findWorkerService(env, auth, zoneDetails.accountId, gatewayHost);
      if (workerService) {
        const domainRes = await fetch(`${CF_API}/accounts/${zoneDetails.accountId}/workers/domains`, {
          method: "PUT",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({
            zone_id: zone.id,
            zone_name: zoneDetails.zoneName,
            hostname,
            service: workerService,
            environment: "production"
          })
        });
        if (domainRes.ok) {
          const domainJson = await domainRes.json();
          if (domainJson.success && domainJson.result?.id) {
            cfDomainBindingId = domainJson.result.id;
          }
        }
      }
    }
  } catch {
  }
  let dnsRecordId = "";
  try {
    const dnsQueryRes = await fetch(
      `${CF_API}/zones/${zone.id}/dns_records?name=${hostname}&type=CNAME`,
      { headers: auth }
    );
    if (dnsQueryRes.ok) {
      const dnsQueryJson = await dnsQueryRes.json();
      if (dnsQueryJson.success && dnsQueryJson.result?.length) {
        dnsRecordId = dnsQueryJson.result[0].id;
      }
    }
  } catch {
  }
  await setProxyDomain(env, proxyId, hostname, zone.id, dnsRecordId, cfDomainBindingId);
}
__name(autoAllocateDomain, "autoAllocateDomain");
async function resolveProxy(env, slug) {
  const req = new Request(`https://do/__proxy?slug=${encodeURIComponent(slug)}`);
  req.headers.set("X-Rork-DO-Class", "ItemsStore");
  req.headers.set("X-Rork-DO-Id", STORE_ID);
  const res = await fetchDO(env, req);
  if (!res.ok) return null;
  const json = await res.json();
  return json.data ?? null;
}
__name(resolveProxy, "resolveProxy");
async function resolveProxyByDomain(env, domain) {
  const req = new Request(`https://do/__proxy?domain=${encodeURIComponent(domain)}`);
  req.headers.set("X-Rork-DO-Class", "ItemsStore");
  req.headers.set("X-Rork-DO-Id", STORE_ID);
  const res = await fetchDO(env, req);
  if (!res.ok) return null;
  const json = await res.json();
  return json.data ?? null;
}
__name(resolveProxyByDomain, "resolveProxyByDomain");
function bumpProxyHits(env, slug) {
  const req = new Request("https://do/__proxy-hit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug })
  });
  req.headers.set("X-Rork-DO-Class", "ItemsStore");
  req.headers.set("X-Rork-DO-Id", STORE_ID);
  return fetchDO(env, req).then(() => void 0);
}
__name(bumpProxyHits, "bumpProxyHits");
function logTraffic(request, env, entry) {
  const log = new Request("https://do/__traffic", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry)
  });
  log.headers.set("X-Rork-DO-Class", "ItemsStore");
  log.headers.set("X-Rork-DO-Id", STORE_ID);
  return fetchDO(env, log).then(() => void 0);
}
__name(logTraffic, "logTraffic");
function logIntercept(env, entry) {
  const ic = new Request("https://do/__intercept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry)
  });
  ic.headers.set("X-Rork-DO-Class", "ItemsStore");
  ic.headers.set("X-Rork-DO-Id", STORE_ID);
  return fetchDO(env, ic).then(() => void 0);
}
__name(logIntercept, "logIntercept");
function buildTrafficEntry(request, response, path, latencyMs, ip, proxy = "") {
  const cf = request.cf;
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
    proxy
  };
}
__name(buildTrafficEntry, "buildTrafficEntry");
function decorate(response, extra) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries({ ...CORS, ...SECURITY, ...extra ?? {} })) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
__name(decorate, "decorate");
async function reverseProxy(request, env) {
  const incoming = new URL(request.url);
  const host = incoming.hostname.toLowerCase();
  let segments = incoming.pathname.replace(/^\/proxy\/?/, "").split("/").filter(Boolean);
  const override = incoming.searchParams.get("target");
  let targetBase;
  let rest = segments.join("/");
  let proxyLabel = "";
  let resolvedProxy = null;
  let subdomainPrefix = "";
  resolvedProxy = await resolveProxyByDomain(env, host);
  if (!resolvedProxy) {
    const hostParts = host.split(".");
    for (let i = 1; i < hostParts.length - 1; i++) {
      const parentDomain = hostParts.slice(i).join(".");
      const candidate = await resolveProxyByDomain(env, parentDomain);
      if (candidate) {
        resolvedProxy = candidate;
        subdomainPrefix = hostParts.slice(0, i).join(".");
        break;
      }
    }
  }
  if (override) {
    targetBase = override;
    rest = segments.join("/");
  } else if (resolvedProxy) {
    if (!resolvedProxy.enabled) {
      return {
        proxy: resolvedProxy.slug,
        response: decorate(
          Response.json(
            { success: false, error: `proxy "${resolvedProxy.slug}" is disabled` },
            { status: 503 }
          )
        )
      };
    }
    targetBase = resolvedProxy.targetUrl;
    proxyLabel = resolvedProxy.slug;
    if (subdomainPrefix) {
      try {
        const parsedTarget = new URL(targetBase);
        parsedTarget.hostname = `${subdomainPrefix}.${parsedTarget.hostname}`;
        targetBase = parsedTarget.toString();
      } catch {
      }
    }
    rest = incoming.pathname;
  } else if (segments.length > 0 && segments[0] !== "api") {
    const slug = segments[0];
    const config = await resolveProxy(env, slug);
    if (!config) {
      return {
        proxy: slug,
        response: decorate(
          Response.json(
            { success: false, error: `no proxy configured for "${slug}"` },
            { status: 404 }
          )
        )
      };
    }
    if (!config.enabled) {
      return {
        proxy: slug,
        response: decorate(
          Response.json(
            { success: false, error: `proxy "${slug}" is disabled` },
            { status: 503 }
          )
        )
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
            error: "no proxy target \u2014 add one in the app, or pass ?target=https://host"
          },
          { status: 502 }
        )
      )
    };
  }
  let target;
  try {
    target = new URL(targetBase);
  } catch {
    return {
      proxy: proxyLabel,
      response: decorate(
        Response.json(
          { success: false, error: "invalid proxy target url" },
          { status: 400 }
        )
      )
    };
  }
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
    request.headers.get("CF-Connecting-IP") ?? request.headers.get("X-Forwarded-For") ?? "anonymous"
  );
  headers.set("X-Gateway-Version", GATEWAY_VERSION);
  const upstream = new Request(target.toString(), {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? void 0 : request.body,
    redirect: "manual"
  });
  try {
    const response = await fetch(upstream);
    const respHeaders = new Headers(response.headers);
    for (const name of HOP_BY_HOP) respHeaders.delete(name);
    respHeaders.set("X-Proxied-By", "edge-gateway-dashboard");
    if (proxyLabel) respHeaders.set("X-Proxy-Target", proxyLabel);
    const labOn = env.INTERCEPT_LAB_MODE === "true";
    const interceptProxy = resolvedProxy || (segments.length > 0 ? await resolveProxy(env, segments[0]) : null);
    const shouldIntercept = labOn && interceptProxy?.interceptEnabled;
    let interceptPromise;
    if (shouldIntercept) {
      const incomingHeaders = new Headers(request.headers);
      for (const name of HOP_BY_HOP) incomingHeaders.delete(name);
      const reqBody = request.clone().text().then(
        (t) => t.slice(0, INTERCEPT_BODY_MAX_BYTES)
      ).catch(() => "");
      const respBody = response.clone().text().then(
        (t) => t.slice(0, INTERCEPT_BODY_MAX_BYTES)
      ).catch(() => "");
      interceptPromise = Promise.all([reqBody, respBody]).then(
        ([reqB, respB]) => logIntercept(env, {
          ts: Date.now(),
          slug: proxyLabel,
          method: request.method,
          path: target.pathname + (target.search || ""),
          reqHeaders: JSON.stringify(Object.fromEntries(incomingHeaders.entries())),
          reqBody: reqB,
          respStatus: response.status,
          respHeaders: JSON.stringify(Object.fromEntries(respHeaders.entries())),
          respBody: respB,
          host: target.host
        })
      );
    }
    return {
      proxy: proxyLabel,
      response: decorate(
        new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: respHeaders
        })
      ),
      interceptPromise
    };
  } catch {
    return {
      proxy: proxyLabel,
      response: decorate(
        Response.json(
          { success: false, error: "bad gateway \u2014 upstream unreachable" },
          { status: 502 }
        )
      )
    };
  }
}
__name(reverseProxy, "reverseProxy");
var index_default = {
  async fetch(request, env, ctx) {
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
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        })
      );
    }
    const clientIp = request.headers.get("CF-Connecting-IP") ?? request.headers.get("X-Forwarded-For") ?? "anonymous";
    const hostName = url.hostname.toLowerCase();
    const isLocalhost = hostName === "localhost" || hostName === "127.0.0.1";
    let isCustomDomainRequest = false;
    if (!isLocalhost) {
      const resolvedCustomProxy2 = await resolveProxyByDomain(env, hostName);
      if (resolvedCustomProxy2) {
        isCustomDomainRequest = true;
      } else {
        const hostParts = hostName.split(".");
        for (let i = 1; i < hostParts.length - 1; i++) {
          const parentDomain = hostParts.slice(i).join(".");
          const candidate = await resolveProxyByDomain(env, parentDomain);
          if (candidate) {
            isCustomDomainRequest = true;
            break;
          }
        }
      }
    }
    if (path === "/proxy" || path.startsWith("/proxy/") || isCustomDomainRequest) {
      const { response: proxied, proxy, interceptPromise } = await reverseProxy(request, env);
      ctx.waitUntil(
        logTraffic(
          request,
          env,
          buildTrafficEntry(request, proxied, path, Date.now() - start, clientIp, proxy)
        )
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
    if (path === "/api/cloudflare/workers" && method === "GET") {
      return await listWorkers(env);
    }
    if (path === "/api/config" && method === "GET") {
      const config = await readConfigFromDO(env, "cf.");
      const NON_SECRET_KEYS = /* @__PURE__ */ new Set(["cf.gateway_host"]);
      const masked = {};
      for (const [k, v] of Object.entries(config)) {
        if (NON_SECRET_KEYS.has(k)) {
          masked[k] = v;
        } else {
          masked[k] = v.length > 6 ? `${v.slice(0, 2)}${"*".repeat(Math.min(v.length - 4, 12))}${v.slice(-2)}` : v ? "***" : "";
        }
      }
      const envConfigured = !!cfAuthHeaders(env);
      return decorate(
        Response.json({
          success: true,
          data: masked,
          envConfigured,
          hasStoredConfig: Object.keys(config).some(
            (k) => config[k] && config[k].length > 0
          )
        })
      );
    }
    if (path === "/api/config" && method === "PUT") {
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== "object") {
        return decorate(
          Response.json(
            { success: false, error: "invalid body" },
            { status: 400 }
          )
        );
      }
      const allowed = ["cf.api_token", "cf.api_key", "cf.api_email", "cf.gateway_host"];
      const filtered = {};
      for (const key of allowed) {
        if (key in body) {
          filtered[key] = body[key];
        }
      }
      await writeConfigToDO(env, filtered);
      return decorate(Response.json({ success: true }));
    }
    if (path === "/api/config/verify" && method === "POST") {
      const auth = await loadCfAuth(env);
      if (!auth) {
        return decorate(
          Response.json({
            success: true,
            data: { valid: false, error: "No credentials configured" }
          })
        );
      }
      try {
        const res = await fetch(`${CF_API}/user/tokens/verify`, {
          headers: auth
        });
        const json = await res.json();
        if (json.success && json.result?.status === "active") {
          return decorate(
            Response.json({
              success: true,
              data: { valid: true, status: "active" }
            })
          );
        }
        if (!json.success) {
          const zonesRes = await fetch(`${CF_API}/zones?per_page=1`, {
            headers: auth
          });
          const zonesJson = await zonesRes.json();
          if (zonesJson.success) {
            return decorate(
              Response.json({
                success: true,
                data: { valid: true, status: "active" }
              })
            );
          }
        }
        return decorate(
          Response.json({
            success: true,
            data: {
              valid: false,
              error: json.errors?.[0]?.message ?? "Token verification failed"
            }
          })
        );
      } catch {
        return decorate(
          Response.json({
            success: true,
            data: { valid: false, error: "Could not reach Cloudflare API" }
          })
        );
      }
    }
    const proxyDeleteMatch = path.match(/^\/api\/proxies\/(\d+)$/);
    if (proxyDeleteMatch && method === "DELETE") {
      const id = Number(proxyDeleteMatch[1]);
      const proxy = await resolveProxyById(env, id);
      if (proxy?.cfZoneId && (proxy.cfRecordId || proxy.cfDomainBindingId)) {
        ctx.waitUntil(cleanupCloudflareResources(env, proxy.cfZoneId, proxy.cfRecordId, proxy.cfDomainBindingId));
      }
    }
    const isProxyCreate = path === "/api/proxies" && method === "POST";
    const host = url.hostname.toLowerCase();
    let isCustomDomain = false;
    const resolvedCustomProxy = await resolveProxyByDomain(env, host);
    if (resolvedCustomProxy) {
      isCustomDomain = true;
    } else {
      const hostParts = host.split(".");
      for (let i = 1; i < hostParts.length - 1; i++) {
        const parentDomain = hostParts.slice(i).join(".");
        const candidate = await resolveProxyByDomain(env, parentDomain);
        if (candidate) {
          isCustomDomain = true;
          break;
        }
      }
    }
    const isTraffic = path === "/api/traffic";
    const isIntercepts = path === "/api/intercepts";
    const isProxyConfig = path === "/api/proxies" || /^\/api\/proxies\/\d+$/.test(path);
    const isConfigRoute = path.startsWith("/api/config");
    if (path !== "/health" && !path.startsWith("/api/items") && !isTraffic && !isIntercepts && !isProxyConfig && !isConfigRoute && !isCustomDomain) {
      return decorate(
        Response.json({ success: false, error: "not found" }, { status: 404 })
      );
    }
    const originReq = new Request(request.url, request);
    originReq.headers.set("X-Client-IP", clientIp);
    originReq.headers.set("X-Rate-Limit", String(RATE_LIMIT_REQUESTS));
    originReq.headers.set("X-Rate-Window", String(RATE_LIMIT_WINDOW));
    originReq.headers.set("X-Cache-TTL", String(CACHE_TTL));
    const response = await dispatch(originReq, env);
    const latency = `${Date.now() - start}ms`;
    const extra = { "X-Edge-Latency": latency };
    if (!response.headers.has("X-Cache")) {
      extra["X-Cache"] = "BYPASS";
    }
    const decorated = decorate(response, extra);
    if (isProxyCreate && decorated.ok) {
      const cloned = decorated.clone();
      ctx.waitUntil(
        cloned.json().then((json) => {
          const proxy = json?.data;
          if (proxy?.id && proxy?.slug) {
            return autoAllocateDomain(env, proxy.id, proxy.slug, url.host);
          }
        }).catch(() => void 0)
      );
    }
    if (!isTraffic && !isProxyConfig) {
      ctx.waitUntil(
        logTraffic(
          request,
          env,
          buildTrafficEntry(request, decorated, path, Date.now() - start, clientIp)
        )
      );
    }
    return decorated;
  }
};

// ../node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-FjB22G/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = index_default;

// ../node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch2, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch: dispatch2,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch2, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch2, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch2, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-FjB22G/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  ItemsStore,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
