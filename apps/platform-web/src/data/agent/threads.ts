import type { UIMessage } from "ai";

import { API_BASE_URL } from "../../env";

import type { AgentLinkedObject } from "./transport";

/** A thread as the panel list renders it (snake_case, matching the API). */
export interface ThreadSummary {
  id: string;
  title: string;
  linked_object: AgentLinkedObject | null;
  updated_at: string;
}

/** Configuration for {@link createAgentThreadsAdapter}. */
export interface CreateAgentThreadsAdapterOptions {
  /** Origin of the platform API (no trailing slash); defaults to {@link API_BASE_URL}. */
  apiBase?: string;
  /**
   * Resolve the current Clerk session token, or `null` when signed out. Called per
   * request so a rotated token is always used — mirrors the chat transport and the
   * proposals / work-items network repositories.
   */
  getToken: () => Promise<string | null>;
  /**
   * Resolve the caller's ACTIVE org id, or `null`. Sent as `?org_id` on the list so
   * the panel only ever sees the current org's threads (a tenant boundary, not
   * polish). Omitted for single-org callers (the API falls back to their sole org).
   */
  getOrgId?: () => string | null;
  /** Per-request timeout in ms (default 15000). */
  timeoutMs?: number;
}

/** The thread adapter surface the panel consumes. */
export interface AgentThreadsAdapter {
  /** The current org's non-archived threads, newest first. */
  list: () => Promise<ThreadSummary[]>;
  /** A thread's reconstructed `UIMessage[]` history (for `useChat({ id, messages })`). */
  messages: (id: string) => Promise<UIMessage[]>;
  /** Soft-delete (archive) a thread. */
  archive: (id: string) => Promise<void>;
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

/**
 * The network thread adapter (Clerk-bearer, tenant-scoped) behind the panel's thread
 * list. Mirrors the proposals network repository's `request<T>` primitive: JSON +
 * bearer headers, abort timeout, `error`-field extraction on non-OK.
 */
export function createAgentThreadsAdapter(
  options: CreateAgentThreadsAdapterOptions,
): AgentThreadsAdapter {
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
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  return {
    list: () => {
      const orgId = options.getOrgId?.() ?? null;
      const query = orgId ? `?org_id=${encodeURIComponent(orgId)}` : "";
      return request<ThreadSummary[]>("GET", `/api/agent/threads${query}`);
    },
    async messages(id: string): Promise<UIMessage[]> {
      const body = await request<{ messages: UIMessage[] }>(
        "GET",
        `/api/agent/threads/${encodeURIComponent(id)}/messages`,
      );
      return body.messages;
    },
    archive: (id: string) =>
      request<void>("POST", `/api/agent/threads/${encodeURIComponent(id)}/archive`),
  };
}
