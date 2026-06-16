import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  createItem,
  createProxy,
  deleteItem,
  deleteProxy,
  fetchHealth,
  fetchItems,
  fetchProxies,
  fetchTraffic,
  updateItem,
  updateProxy,
  type HealthResult,
  type Item,
  type ItemsResult,
  type Proxy,
  type TrafficResult,
} from "@/lib/api";

export const queryKeys = {
  health: ["health"] as const,
  items: ["items"] as const,
  traffic: ["traffic"] as const,
  proxies: ["proxies"] as const,
};

export function useProxies(): UseQueryResult<Proxy[], Error> {
  return useQuery({
    queryKey: queryKeys.proxies,
    queryFn: fetchProxies,
    refetchInterval: 6000,
    retry: 1,
  });
}

export function useCreateProxy(): UseMutationResult<
  Proxy,
  Error,
  { name: string; targetUrl: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createProxy,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.proxies });
    },
  });
}

export function useUpdateProxy(): UseMutationResult<
  Proxy,
  Error,
  { id: number; name?: string; targetUrl?: string; enabled?: boolean }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...rest }) => updateProxy(id, rest),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.proxies });
    },
  });
}

export function useDeleteProxy(): UseMutationResult<void, Error, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteProxy,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.proxies });
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

export function useCreateItem(): UseMutationResult<
  Item,
  Error,
  { name: string; description: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.items });
      queryClient.invalidateQueries({ queryKey: queryKeys.health });
    },
  });
}

export function useUpdateItem(): UseMutationResult<
  Item,
  Error,
  { id: number; name: string; description: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name, description }) => updateItem(id, { name, description }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.items });
    },
  });
}

export function useDeleteItem(): UseMutationResult<void, Error, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.items });
      queryClient.invalidateQueries({ queryKey: queryKeys.health });
    },
  });
}
