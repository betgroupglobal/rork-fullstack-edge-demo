/**
 * API client for the Edge Gateway Dashboard. Talks to the Rork-hosted
 * Cloudflare Worker that fronts the ItemsStore Durable Object.
 */

declare const process: { env: Record<string, string | undefined> };

const BASE_URL = process.env.EXPO_PUBLIC_RORK_FUNCTIONS_URL ?? "";

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
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message =
      (json as { error?: string }).error ?? `Request failed (${response.status})`;
    throw new Error(message);
  }
  return json as T;
}

export async function fetchHealth(): Promise<HealthResult> {
  const start = Date.now();
  const response = await fetch(`${BASE_URL}/health`, { cache: "no-store" });
  const latencyMs = Date.now() - start;
  const data = await parse<Omit<HealthResult, "meta">>(response);
  return { ...data, meta: readMeta(response, latencyMs) };
}

export type ItemsResult = { items: Item[]; meta: GatewayMeta };

export async function fetchItems(): Promise<ItemsResult> {
  const start = Date.now();
  const response = await fetch(`${BASE_URL}/api/items`, { cache: "no-store" });
  const latencyMs = Date.now() - start;
  const data = await parse<{ data: Item[] }>(response);
  return { items: data.data, meta: readMeta(response, latencyMs) };
}

export async function createItem(input: {
  name: string;
  description: string;
}): Promise<Item> {
  const response = await fetch(`${BASE_URL}/api/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await parse<{ data: Item }>(response);
  return data.data;
}

export async function updateItem(
  id: number,
  input: { name: string; description: string },
): Promise<Item> {
  const response = await fetch(`${BASE_URL}/api/items/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
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
export async function fetchCloudflareZones(): Promise<ZonesResult> {
  const response = await fetch(`${BASE_URL}/api/cloudflare/zones`, {
    cache: "no-store",
  });
  const text = await response.text();
  const json = (text ? JSON.parse(text) : {}) as {
    success?: boolean;
    configured?: boolean;
    data?: CloudflareZone[];
    error?: string;
  };
  if (!json.success) {
    return {
      configured: json.configured ?? false,
      zones: [],
      error: json.error,
    };
  }
  return { configured: true, zones: json.data ?? [] };
}

/**
 * Allocates a purchased Cloudflare domain to a proxy target. Creates the DNS
 * record pointing at the gateway and stores the hostname on the target.
 */
export async function allocateProxyDomain(input: {
  proxyId: number;
  zoneId: string;
  hostname: string;
}): Promise<{ hostname: string; target: string }> {
  const response = await fetch(`${BASE_URL}/api/cloudflare/allocate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  const response = await fetch(`${BASE_URL}/api/proxies`, { cache: "no-store" });
  const data = await parse<{ data: Proxy[] }>(response);
  return data.data;
}

export async function createProxy(input: {
  name: string;
  targetUrl: string;
}): Promise<Proxy> {
  const response = await fetch(`${BASE_URL}/api/proxies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await parse<{ data: Proxy }>(response);
  return data.data;
}

export async function updateProxy(
  id: number,
  input: Partial<{ name: string; targetUrl: string; enabled: boolean; interceptEnabled: boolean }>,
): Promise<Proxy> {
  const response = await fetch(`${BASE_URL}/api/proxies/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await parse<{ data: Proxy }>(response);
  return data.data;
}

export async function deleteProxy(id: number): Promise<void> {
  const response = await fetch(`${BASE_URL}/api/proxies/${id}`, {
    method: "DELETE",
  });
  await parse<{ data: Proxy }>(response);
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
export async function fetchIntercepts(): Promise<InterceptCapture[]> {
  const response = await fetch(`${BASE_URL}/api/intercepts`, {
    cache: "no-store",
    headers: { "X-Intercept-TTL": "600" },
  });
  const data = await parse<{ data: InterceptCapture[]; count: number }>(response);
  return data.data;
}

/** Wipes all intercept captures from the gateway. */
export async function deleteIntercepts(): Promise<void> {
  const response = await fetch(`${BASE_URL}/api/intercepts`, {
    method: "DELETE",
  });
  await parse<{ success: boolean }>(response);
}

export async function deleteItem(id: number): Promise<void> {
  const response = await fetch(`${BASE_URL}/api/items/${id}`, {
    method: "DELETE",
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
  const response = await fetch(`${BASE_URL}/api/traffic`, { cache: "no-store" });
  const latencyMs = Date.now() - start;
  const data = await parse<{ data: TrafficEntry[]; stats: TrafficStats }>(response);
  return {
    entries: data.data,
    stats: data.stats,
    meta: readMeta(response, latencyMs),
  };
}

/** Sensitive-field patterns for masking in the UI. */
export const SENSITIVE_FIELDS = [
  "password", "passwd", "secret", "token", "api_key", "apikey",
  "authorization", "session", "cookie", "jwt", "bearer",
  "access_token", "refresh_token", "id_token", "private_key",
];

/** Mask a value by showing first 2 and last 2 characters. */
export function maskValue(value: string): string {
  if (!value || value.length <= 6) return "***";
  return `${value.slice(0, 2)}${'*'.repeat(Math.min(value.length - 4, 12))}${value.slice(-2)}`;
}
