// ── Core types shared across the Edge Gateway Dashboard API client ──

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

export type ItemsResult = { items: Item[]; meta: GatewayMeta };

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
  proxyDomain: string;
  interceptEnabled: boolean;
  cfZoneId: string;
  cfRecordId: string;
  injectJs: string;
  injectJsEnabled: boolean;
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

export type ReconInput = {
  targetUrl: string;
  captured: {
    urls?: string[];
    cookies?: string[];
    formFields?: { name: string; type: string; id?: string; placeholder?: string; required?: boolean; autocomplete?: string }[];
    redirects?: string[];
    domains?: string[];
    pageTitle?: string;
    formAction?: string;
    formMethod?: string;
    hiddenInputs?: { name: string; value: string; id?: string }[];
    csrfFields?: { name: string; value: string; id?: string }[];
    authLinks?: { href: string; text: string }[];
    apiEndpoints?: string[];
    scripts?: string[];
    forms?: { action: string; method: string; id?: string; name?: string }[];
  };
};

export type ReconResult = {
  proxyId: number;
  phishlet: string;
};

export type LoginPhishletInput = {
  targetUrl: string;
  loginForm: {
    domain?: string;
    loginPath?: string;
    submitSelector?: string;
    usernameField?: string;
    passwordField?: string;
    hiddenInputs?: { name: string; value: string }[];
  };
};

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

export type WorkerConfig = Record<string, string>;

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
