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
  deleteIntercepts,
  deleteItem,
  deleteProxy,
  deleteWorkerConfig,
  deleteWorkerRoute,
  fetchCloudflareZones,
  fetchHealth,
  fetchIntercepts,
  fetchItems,
  fetchProxies,
  fetchTraffic,
  fetchWorkerConfig,
  fetchWorkerRoutes,
  generatePhishlet,
  updateItem,
  updateProxy,
  updateWorkerConfig,
  type HealthResult,
  type InterceptCapture,
  type ReconInput,
  type ReconResult,
  type Item,
  type ItemsResult,
  type Proxy,
  type TrafficResult,
  type WorkerConfig,
  type WorkerRoutesResult,
  type ZonesResult,
} from "@/lib/api";

export const queryKeys = {
  health: ["health"] as const,
  items: ["items"] as const,
  traffic: ["traffic"] as const,
  proxies: ["proxies"] as const,
  zones: ["cloudflare-zones"] as const,
  routes: ["worker-routes"] as const,
  intercepts: ["intercepts"] as const,
  config: ["worker-config"] as const,
};

export function useCloudflareZones(authHeader?: string): UseQueryResult<ZonesResult, Error> {
  return useQuery({
    queryKey: [...queryKeys.zones, authHeader],
    queryFn: () => fetchCloudflareZones(authHeader),
    staleTime: 60_000,
    retry: 1,
  });
}

export function useAllocateProxyDomain(authHeader?: string): UseMutationResult<
  { hostname: string; target: string },
  Error,
  { proxyId: number; zoneId: string; hostname: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => allocateProxyDomain(input, authHeader),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.proxies });
    },
  });
}

export function useProxies(): UseQueryResult<Proxy[], Error> {
  return useQuery({
    queryKey: queryKeys.proxies,
    queryFn: fetchProxies,
    refetchInterval: 6000,
    retry: 1,
  });
}

export function useCreateProxy(authHeader?: string): UseMutationResult<
  Proxy,
  Error,
  { name: string; targetUrl: string }
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
  Proxy,
  Error,
  { id: number; name?: string; targetUrl?: string; enabled?: boolean; interceptEnabled?: boolean; injectJs?: string; injectJsEnabled?: boolean }
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

export function useTraffic(): UseQueryResult<TrafficResult, Error> {
  return useQuery({
    queryKey: queryKeys.traffic,
    queryFn: fetchTraffic,
    refetchInterval: 4000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

export function useHealth(): UseQueryResult<HealthResult, Error> {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: fetchHealth,
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

export function useItems(): UseQueryResult<ItemsResult, Error> {
  return useQuery({
    queryKey: queryKeys.items,
    queryFn: fetchItems,
  });
}

export function useCreateItem(authHeader?: string): UseMutationResult<
  Item,
  Error,
  { name: string; description: string }
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
  Item,
  Error,
  { id: number; name: string; description: string }
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

export function useIntercepts(authHeader?: string): UseQueryResult<InterceptCapture[], Error> {
  return useQuery({
    queryKey: [...queryKeys.intercepts, authHeader],
    queryFn: () => fetchIntercepts(authHeader),
    refetchInterval: 3000,
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

export function useWorkerConfig(authHeader?: string): UseQueryResult<WorkerConfig, Error> {
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: () => fetchWorkerConfig(authHeader),
    staleTime: 30_000,
    retry: 1,
  });
}

export function useUpdateWorkerConfig(authHeader?: string): UseMutationResult<
  WorkerConfig,
  Error,
  Record<string, string>
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entries) => updateWorkerConfig(entries, authHeader),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.config });
    },
  });
}

export function useDeleteWorkerConfig(authHeader?: string): UseMutationResult<
  WorkerConfig,
  Error,
  void
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => deleteWorkerConfig(authHeader),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.config });
    },
  });
}

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

export function useWorkerRoutes(authHeader?: string): UseQueryResult<WorkerRoutesResult, Error> {
  return useQuery({
    queryKey: [...queryKeys.routes, authHeader],
    queryFn: () => fetchWorkerRoutes(authHeader),
    refetchInterval: 8000,
    staleTime: 30_000,
    retry: 1,
  });
}

export function useDeleteWorkerRoute(
  authHeader?: string,
): UseMutationResult<void, Error, { routeId: string; zoneId: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ routeId, zoneId }) => deleteWorkerRoute(routeId, zoneId, authHeader),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.routes });
    },
  });
}
