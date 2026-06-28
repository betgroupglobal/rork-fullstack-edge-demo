import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { getBaseUrl } from "@/lib/api/client";
import { queryKeys } from "./useGateway";

/** Maps WS event types to React Query cache keys to invalidate. */
const EVENT_QUERY_MAP: Record<string, QueryKey[]> = {
  "health:changed": [queryKeys.health],
  "items:changed": [queryKeys.items, queryKeys.health],
  "proxies:changed": [queryKeys.proxies, queryKeys.health],
  "intercepts:changed": [queryKeys.intercepts, queryKeys.health],
  "traffic:changed": [queryKeys.traffic, queryKeys.health],
  "tunnels:changed": [queryKeys.tunnels],
  "proxyStatus:changed": [queryKeys.proxyStatus],
  "servers:changed": [queryKeys.servers],
  "config:changed": [queryKeys.config],
};

function buildWsUrl(): string {
  const base = getBaseUrl().replace(/\/$/, "");
  try {
    const url = new URL(base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/ws";
    return url.toString();
  } catch {
    return "";
  }
}

/**
 * Manages a persistent WebSocket connection to the backend for real-time cache
 * invalidation. On receiving an event, invalidates only the affected React Query
 * cache entries — no full-page re-render, no polling.
 */
export function useWebSocket(): void {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(1000);

  useEffect(() => {
    let mounted = true;
    const wsUrl = buildWsUrl();
    if (!wsUrl) return;

    function connect(): void {
      if (!mounted) return;

      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        if (!mounted) return;
        reconnectDelayRef.current = 1000; // reset backoff
      };

      ws.onmessage = (event: WebSocketMessageEvent) => {
        if (!mounted) return;
        try {
          const data = JSON.parse(event.data as string) as { type: string; payload?: unknown; ts: number };
          const keys = EVENT_QUERY_MAP[data.type];
          if (keys) {
            for (const key of keys) {
              queryClient.invalidateQueries({ queryKey: key });
            }
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (!mounted) return;
        const delay = reconnectDelayRef.current;
        reconnectDelayRef.current = Math.min(delay * 1.5, 30_000);
        reconnectTimeoutRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };

      wsRef.current = ws;
    }

    connect();

    return () => {
      mounted = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [queryClient]);
}
