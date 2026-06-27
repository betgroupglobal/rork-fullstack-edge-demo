// ── Low-level HTTP client helpers for the Edge Gateway Dashboard ──

import type { GatewayMeta } from "./types";

declare const process: { env: Record<string, string | undefined> };

let BASE_URL = process.env.EXPO_PUBLIC_RORK_FUNCTIONS_URL || "";

export function getBaseUrl(): string {
  return BASE_URL.replace(/\/$/, "");
}

export function setBaseUrl(url: string): void {
  BASE_URL = url.replace(/\/$/, "");
}

/** Wraps fetch with network-error handling, throwing a clear message instead of a bare TypeError. */
export async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new Error(
      "Network error — cannot reach the gateway. Verify the gateway URL is correct and the service is online.",
    );
  }
}

export function readMeta(response: Response, latencyMs: number): GatewayMeta {
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

/** Parse a fetch Response as JSON with clear error messages for non-JSON or failure responses. */
export async function parse<T>(response: Response): Promise<T> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new Error("Network error — the gateway is unreachable. Check your connection and gateway URL.");
  }
  let json: unknown = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      const snippet = text.slice(0, 200).replace(/\n/g, " ").trim();
      throw new Error(
        `Gateway returned non-JSON response (${response.status}). ` +
        `Verify the gateway URL is correct and the service is healthy. ` +
        `Response starts with: "${snippet}${text.length > 200 ? "…" : ""}"`,
      );
    }
  }
  if (!response.ok) {
    const message =
      (json as { error?: string }).error ?? `Request failed (${response.status})`;
    throw new Error(message);
  }
  return json as T;
}
