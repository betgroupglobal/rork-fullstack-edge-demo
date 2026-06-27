import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  allocateProxyDomain,
  createItem,
  createProxy,
  createTunnel,
  deleteIntercepts,
  deleteItem,
  deleteProxy,
  deleteRuntimeConfig,
  deleteTunnel,
  fetchHarExport,
  fetchHealth,
  fetchIntercepts,
  fetchItems,
  fetchProxies,
  fetchProxyStatus,
  fetchRuntimeConfig,
  fetchTraffic,
  fetchTunnels,
  generateLoginPhishlet,
  generatePhishlet,
  iteratePhishlet,
  replayHar,
  startTunnel,
  stopTunnel,
  updateItem,
  updateProxy,
  updateRuntimeConfig,
  type HealthResult,
  type InterceptCapture,
  type LoginPhishletInput,
  type ReconInput,
  type ReconResult,
  type IterateResult,
  type Item,
  type ItemsResult,
  type Proxy,
  type ProxyStatus,
  type ProxyTunnel,
  type TunnelListResult,
  type TunnelCreateInput,
  type ReplayReport,
  type TrafficResult,
  type RuntimeConfig,
} from "@/lib/api";

// ── Shared query keys & intervals ──
export const queryKeys = {
  health: ["health"] as const,
  items: ["items"] as const,
  traffic: ["traffic"] as const,
  proxies: ["proxies"] as const,
  tunnels: ["tunnels"] as const,
  proxyStatus: ["proxy-status"] as const,
  intercepts: ["intercepts"] as const,
  config: ["runtime-config"] as const,
};

/** Centralised refetch intervals (ms) so changes propagate across all screens. */
export const REFETCH_INTERVALS = {
  health: 5_000,
  traffic: 4_000,
  proxies: 6_000,
  intercepts: 3_000,
  tunnels: 8_000,
  proxyStatus: 10_000,
} as const;

// ── Health ──

export function useHealth(): UseQueryResult<HealthResult, Error> {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: fetchHealth,
    refetchInterval: REFETCH_INTERVALS.health,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

// ── Items ──

export function useItems(): UseQueryResult<ItemsResult, Error> {
  return useQuery({
    queryKey: queryKeys.items,
    queryFn: fetchItems,
  });
}

export function useCreateItem(authHeader?: string): UseMutationResult<
  Item, Error, { name: string; description: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => createItem(input, authHeader),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.items });
      queryClient.invalidateQueries({ queryKey: queryKeys.health });
    },
  });
}

export function useUpdateItem(authHeader?: string): UseMutationResult<
  Item, Error, { id: number; name: string; description: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name, description }) => updateItem(id, { name, description }, authHeader),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.items });
    },
  });
}

export function useDeleteItem(authHeader?: string): UseMutationResult<void, Error, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => deleteItem(id, authHeader),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.items });
      queryClient.invalidateQueries({ queryKey: queryKeys.health });
    },
  });
}

// ── Proxies ──

export function useProxies(): UseQueryResult<Proxy[], Error> {
  return useQuery({
    queryKey: queryKeys.proxies,
    queryFn: fetchProxies,
    refetchInterval: REFETCH_INTERVALS.proxies,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

export function useCreateProxy(authHeader?: string): UseMutationResult<
  Proxy, Error, { name: string; targetUrl: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => createProxy(input, authHeader),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.proxies });
    },
  });
}

export function useUpdateProxy(authHeader?: string): UseMutationResult<
  Proxy, Error, { id: number; name?: string; targetUrl?: string; enabled?: boolean; interceptEnabled?: boolean; injectJs?: string; injectJsEnabled?: boolean }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...rest }) => updateProxy(id, rest, authHeader),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.proxies });
    },
  });
}

export function useDeleteProxy(authHeader?: string): UseMutationResult<void, Error, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => deleteProxy(id, authHeader),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.proxies });
      queryClient.invalidateQueries({ queryKey: queryKeys.intercepts });
      queryClient.invalidateQueries({ queryKey: queryKeys.traffic });
    },
  });
}

// ── Proxy Tunnels (self-hosted) ──

export function useProxyStatus(): UseQueryResult<ProxyStatus, Error> {
  return useQuery({
    queryKey: queryKeys.proxyStatus,
    queryFn: fetchProxyStatus,
    refetchInterval: REFETCH_INTERVALS.proxyStatus,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

export function useTunnels(): UseQueryResult<TunnelListResult, Error> {
  return useQuery({
    queryKey: queryKeys.tunnels,
    queryFn: fetchTunnels,
    refetchInterval: REFETCH_INTERVALS.tunnels,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

export function useCreateTunnel(authHeader?: string): UseMutationResult<
  ProxyTunnel, Error, TunnelCreateInput
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => createTunnel(input, authHeader),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tunnels });
      queryClient.invalidateQueries({ queryKey: queryKeys.proxyStatus });
    },
  });
}

export function useDeleteTunnel(authHeader?: string): UseMutationResult<void, Error, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => deleteTunnel(id, authHeader),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tunnels });
      queryClient.invalidateQueries({ queryKey: queryKeys.proxyStatus });
    },
  });
}

export function useStartTunnel(authHeader?: string): UseMutationResult<
  ProxyTunnel, Error, number
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => startTunnel(id, authHeader),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tunnels });
      queryClient.invalidateQueries({ queryKey: queryKeys.proxyStatus });
    },
  });
}

export function useStopTunnel(authHeader?: string): UseMutationResult<
  ProxyTunnel, Error, number
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => stopTunnel(id, authHeader),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tunnels });
      queryClient.invalidateQueries({ queryKey: queryKeys.proxyStatus });
    },
  });
}

export function useAllocateProxyDomain(authHeader?: string): UseMutationResult<
  { hostname: string; target: string; tunnelId: number },
  Error,
  { proxyId: number; hostname: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => allocateProxyDomain(input, authHeader),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.proxies });
      queryClient.invalidateQueries({ queryKey: queryKeys.tunnels });
      queryClient.invalidateQueries({ queryKey: queryKeys.proxyStatus });
    },
  });
}

// ── Traffic ──

export function useTraffic(): UseQueryResult<TrafficResult, Error> {
  return useQuery({
    queryKey: queryKeys.traffic,
    queryFn: fetchTraffic,
    refetchInterval: REFETCH_INTERVALS.traffic,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

// ── Intercepts ──

export function useIntercepts(authHeader?: string): UseQueryResult<InterceptCapture[], Error> {
  return useQuery({
    queryKey: [...queryKeys.intercepts, authHeader],
    queryFn: () => fetchIntercepts(authHeader),
    refetchInterval: REFETCH_INTERVALS.intercepts,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

export function useDeleteIntercepts(authHeader?: string): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => deleteIntercepts(authHeader),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.intercepts });
    },
  });
}

// ── Runtime Config ──

export function useRuntimeConfig(authHeader?: string): UseQueryResult<RuntimeConfig, Error> {
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: () => fetchRuntimeConfig(authHeader),
    staleTime: 30_000,
    retry: 1,
  });
}

export function useUpdateRuntimeConfig(authHeader?: string): UseMutationResult<
  RuntimeConfig, Error, Record<string, string>
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entries) => updateRuntimeConfig(entries, authHeader),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.config });
    },
  });
}

export function useDeleteRuntimeConfig(authHeader?: string): UseMutationResult<
  RuntimeConfig, Error, void
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => deleteRuntimeConfig(authHeader),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.config });
    },
  });
}

// ── Recon / Phishlet ──

export function useGeneratePhishlet(
  authHeader?: string,
): UseMutationResult<ReconResult, Error, { proxyId: number; input: ReconInput }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ proxyId, input }) => generatePhishlet(proxyId, input, authHeader),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.proxies });
    },
  });
}

export function useGenerateLoginPhishlet(
  authHeader?: string,
): UseMutationResult<ReconResult, Error, { proxyId: number; input: LoginPhishletInput }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ proxyId, input }) => generateLoginPhishlet(proxyId, input, authHeader),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.proxies });
    },
  });
}

export function useIteratePhishlet(
  authHeader?: string,
): UseMutationResult<IterateResult, Error, { proxyId: number; phishlet: string; captured: NonNullable<ReconInput["captured"]> }> {
  return useMutation({
    mutationFn: ({ proxyId, phishlet, captured }) => iteratePhishlet(proxyId, { phishlet, captured }, authHeader),
  });
}

// ── HAR export ──

export function useHarExport(
  authHeader?: string,
): UseMutationResult<{ harJson: string; fileName: string }, Error, void> {
  return useMutation({
    mutationFn: () => fetchHarExport(authHeader),
  });
}

// ── Replay engine ──

export function useReplayHar(
  authHeader?: string,
): UseMutationResult<ReplayReport, Error, { har: string; proxySlug: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => replayHar(input, authHeader),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.intercepts });
    },
  });
}
