// ── Barrel re-exports for the Edge Gateway Dashboard API client ──
// All existing imports from "@/lib/api" continue to work unchanged.

export {
  getBaseUrl,
  setBaseUrl,
  safeFetch,
  readMeta,
} from "./client";

export {
  SENSITIVE_FIELDS,
  CREDENTIAL_FIELDS,
  maskValue,
} from "./constants";

export {
  fetchHealth,
  fetchItems,
  createItem,
  updateItem,
  deleteItem,
  fetchProxies,
  createProxy,
  updateProxy,
  deleteProxy,
  proxyUrl,
  fetchProxyStatus,
  fetchTunnels,
  fetchTunnel,
  createTunnel,
  deleteTunnel,
  startTunnel,
  stopTunnel,
  allocateProxyDomain,
  fetchIntercepts,
  deleteIntercepts,
  fetchTraffic,
  fetchRuntimeConfig,
  updateRuntimeConfig,
  deleteRuntimeConfig,
  generatePhishlet,
  generateLoginPhishlet,
  iteratePhishlet,
  fetchHarExport,
  replayHar,
} from "./endpoints";

export type {
  Item,
  GatewayMeta,
  HealthResult,
  ItemsResult,
  TrafficEntry,
  Proxy,
  ProxyTunnel,
  TunnelListResult,
  TunnelCreateInput,
  ProxyStatus,
  ReconInput,
  ReconResult,
  LoginPhishletInput,
  InterceptCapture,
  TrafficStats,
  TrafficResult,
  RuntimeConfig,
  ReplayEntry,
  ReplayReport,
  CritiqueEntry,
  IterateResult,
} from "./types";
