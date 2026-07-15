import { API_BASE_URL } from "../../env";

import type {
  CreateMemoryInput,
  DeferMemoryInput,
  MemoryDetail,
  MemoryFilters,
  MemoryRow,
  SupersedeMemoryInput,
} from "./types";

/** Configuration for {@link createMemoriesAdapter}. */
export interface CreateMemoriesAdapterOptions {
  /** Origin of the platform API (no trailing slash); defaults to {@link API_BASE_URL}. */
  apiBase?: string;
  /**
   * Resolve the current Clerk session token, or `null` when signed out. Called
   * per request so a rotated token is always used — mirrors the agent threads
   * adapter and the proposals network repository.
   */
  getToken: () => Promise<string | null>;
  /**
   * Resolve the caller's ACTIVE org id, or `null`. Sent as `?org_id` on the list
   * (and in the create body) so a multi-org user only ever sees/writes the
   * current org's memories (a tenant boundary, not polish). Omitted for
   * single-org callers (the API falls back to their sole org).
   */
  getOrgId?: () => string | null;
  /** Per-request timeout in ms (default 15000). */
  timeoutMs?: number;
}

/** The memory adapter surface the Decision Log + capture form consume. */
export interface MemoriesAdapter {
  /** The org's memories matching `filters`, most-recent first (backend order). */
  list: (filters?: MemoryFilters) => Promise<MemoryRow[]>;
  /** One memory plus its full supersession chain (oldest first). */
  get: (id: string) => Promise<MemoryDetail>;
  /** Capture a new memory — active immediately (no review step). */
  create: (input: CreateMemoryInput) => Promise<MemoryRow>;
  /** Replace a memory with a new version; `change_reason` is mandatory. */
  supersede: (id: string, input: SupersedeMemoryInput) => Promise<MemoryRow>;
  /** Retract a memory (no longer holds). */
  retract: (id: string) => Promise<MemoryRow>;
  /** Defer a memory (park it, optionally with what it's waiting on / a review date). */
  defer: (id: string, input: DeferMemoryInput) => Promise<MemoryRow>;
}

const DEFAULT_TIMEOUT_MS = 15_000;

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

/** Append the defined `MemoryFilters` (plus `org_id`) as a query string. */
function buildListQuery(
  filters: MemoryFilters | undefined,
  orgId: string | null,
): string {
  const params = new URLSearchParams();
  if (filters?.kind) params.set("kind", filters.kind);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.topic) params.set("topic", filters.topic);
  if (filters?.scope_type) params.set("scope_type", filters.scope_type);
  if (filters?.scope_id) params.set("scope_id", filters.scope_id);
  if (filters?.q) params.set("q", filters.q);
  if (orgId) params.set("org_id", orgId);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/**
 * The network memory adapter (Clerk-bearer, org-scoped) behind the Decision Log.
 * Mirrors the agent threads adapter's `request<T>` primitive: JSON + bearer
 * headers, abort timeout, `error`-field extraction on non-OK — plus a JSON body
 * for the POST mutations (create/supersede/retract/defer), like the proposals
 * network repository.
 */
export function createMemoriesAdapter(
  options: CreateMemoriesAdapterOptions,
): MemoriesAdapter {
  const baseUrl = options.apiBase ?? API_BASE_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const token = await options.getToken();
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(await errorMessage(response));
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  return {
    list: (filters?: MemoryFilters) => {
      const orgId = options.getOrgId?.() ?? null;
      return request<MemoryRow[]>(
        "GET",
        `/api/memories${buildListQuery(filters, orgId)}`,
      );
    },
    get: (id: string) =>
      request<MemoryDetail>("GET", `/api/memories/${encodeURIComponent(id)}`),
    create: (input: CreateMemoryInput) => {
      const orgId = options.getOrgId?.() ?? null;
      // The active org is injected here, never by the form — a tenant boundary.
      const body = orgId ? { ...input, org_id: orgId } : input;
      return request<MemoryRow>("POST", "/api/memories", body);
    },
    supersede: (id: string, input: SupersedeMemoryInput) =>
      request<MemoryRow>(
        "POST",
        `/api/memories/${encodeURIComponent(id)}/supersede`,
        input,
      ),
    retract: (id: string) =>
      request<MemoryRow>(
        "POST",
        `/api/memories/${encodeURIComponent(id)}/retract`,
      ),
    defer: (id: string, input: DeferMemoryInput) =>
      request<MemoryRow>(
        "POST",
        `/api/memories/${encodeURIComponent(id)}/defer`,
        input,
      ),
  };
}
