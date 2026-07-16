import { API_BASE_URL } from "../../env";

import type { MemoryImpact } from "./types";

/** Configuration for {@link createMemoryImpactAdapter}. */
export interface CreateMemoryImpactAdapterOptions {
  /** Origin of the platform API (no trailing slash); defaults to {@link API_BASE_URL}. */
  apiBase?: string;
  /**
   * Resolve the current Clerk session token, or `null` when signed out. Called
   * per request so a rotated token is always used — mirrors the memories adapter.
   */
  getToken: () => Promise<string | null>;
  /**
   * Resolve the caller's ACTIVE org id, or `null`. Sent as `?org_id` so a
   * multi-org user only ever sees the current org's impact (a tenant boundary,
   * not polish). Omitted for single-org callers (the API falls back to their
   * sole org).
   */
  getOrgId?: () => string | null;
  /** Per-request timeout in ms (default 15000). */
  timeoutMs?: number;
}

/** The memory-impact adapter surface the "Saved N edits" card consumes. */
export interface MemoryImpactAdapter {
  /** The measured impact of memory over the last `windowDays` days (default 30). */
  get: (windowDays?: number) => Promise<MemoryImpact>;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** The default rolling window (days) — matches the API's own default. */
export const DEFAULT_WINDOW_DAYS = 30;

/** Extract the API's `{ error }` message from a non-OK response, else a status fallback. */
async function errorMessage(response: Response): Promise<string> {
  let message = `Request failed (${response.status})`;
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body?.error === "string") message = body.error;
  } catch {
    // Non-JSON / empty body — keep the status-based message.
  }
  return message;
}

/**
 * The network memory-impact adapter (Clerk-bearer, org-scoped) behind the
 * "Saved N edits" card. Mirrors the memories adapter's `request<T>` primitive:
 * JSON + bearer headers, abort timeout, `error`-field extraction on non-OK.
 */
export function createMemoryImpactAdapter(
  options: CreateMemoryImpactAdapterOptions,
): MemoryImpactAdapter {
  const baseUrl = options.apiBase ?? API_BASE_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function request<T>(method: string, path: string): Promise<T> {
    const token = await options.getToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(await errorMessage(response));
    return (await response.json()) as T;
  }

  return {
    get: (windowDays = DEFAULT_WINDOW_DAYS) => {
      const orgId = options.getOrgId?.() ?? null;
      const params = new URLSearchParams({ window: String(windowDays) });
      if (orgId) params.set("org_id", orgId);
      return request<MemoryImpact>(
        "GET",
        `/api/agent/memory-impact?${params.toString()}`,
      );
    },
  };
}
