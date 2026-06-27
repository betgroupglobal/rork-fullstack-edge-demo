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
  fetchCloudflareZones,
  allocateProxyDomain,
  fetchWorkerRoutes,
  deleteWorkerRoute,
  fetchIntercepts,
  deleteIntercepts,
  fetchTraffic,
  fetchWorkerConfig,
  updateWorkerConfig,
  deleteWorkerConfig,
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
  CloudflareZone,
  ZonesResult,
  ReconInput,
  ReconResult,
  LoginPhishletInput,
  WorkerRoute,
  WorkerRoutesResult,
  InterceptCapture,
  TrafficStats,
  TrafficResult,
  WorkerConfig,
  ReplayEntry,
  ReplayReport,
  CritiqueEntry,
  IterateResult,
} from "./types";
