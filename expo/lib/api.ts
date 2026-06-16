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
  createdAt: number;
  updatedAt: number;
};

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
  input: Partial<{ name: string; targetUrl: string; enabled: boolean }>,
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

export async function deleteItem(id: number): Promise<void> {
  const response = await fetch(`${BASE_URL}/api/items/${id}`, {
    method: "DELETE",
  });
  await parse<{ data: Item }>(response);
}
