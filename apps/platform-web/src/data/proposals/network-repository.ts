import type { WorkItem } from "@/data/work-items";

import type { ProposalRepository } from "./repository";
import type { AcceptResult, Proposal } from "./types";

/** Configuration for {@link createNetworkProposalRepository}. */
export interface NetworkProposalRepositoryOptions {
  /** Origin of the platform API (no trailing slash); empty ⇒ same-origin `/api/*`. */
  baseUrl: string;
  /**
   * Resolve the current Clerk session token (via `useAuth().getToken()`), or
   * `null` when signed out. Called per request so a rotated token is always used.
   */
  getToken: () => Promise<string | null>;
  /** Per-request timeout in ms (default 15000) — a hung API can't spin forever. */
  timeoutMs?: number;
}

/** Default per-request timeout (ms). */
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * The network {@link ProposalRepository} — the adapter behind the review inbox
 * against the real PR1/PR2 agent endpoints (Clerk-verified, tenant-scoped). It
 * mirrors the work-items network repository's `request<T>` primitive (JSON +
 * bearer headers, abort timeout, `error`-field extraction), and adds an
 * `accept` that maps the backend's `409`/`404`/`422` into a discriminated
 * {@link AcceptResult} instead of an opaque throw — the inbox needs those cases.
 */
export function createNetworkProposalRepository(
  options: NetworkProposalRepositoryOptions,
): ProposalRepository {
  const { baseUrl, getToken } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  /** The raw fetch primitive — attaches headers + abort timeout, returns the Response. */
  async function rawFetch(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const token = await getToken();
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;

    return fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  /** Extract the API's `{ error }` message from a non-OK response, else a status fallback. */
  async function errorMessage(response: Response): Promise<string> {
    let message = `Request failed (${response.status})`;
    try {
      const errorBody = (await response.json()) as { error?: unknown };
      if (typeof errorBody?.error === "string") message = errorBody.error;
    } catch {
      // Non-JSON / empty body — keep the status-based message.
    }
    return message;
  }

  /** Fetch + normalize like the work-items adapter: throw on non-OK, `204 ⇒ undefined`. */
  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await rawFetch(method, path, body);
    if (!response.ok) {
      throw new Error(await errorMessage(response));
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  return {
    list: () => request<Proposal[]>("GET", "/api/agent/proposals"),

    async accept(id: string): Promise<AcceptResult> {
      // No body: the id in the path IS the whole request (PR2 contract).
      const response = await rawFetch(
        "POST",
        `/api/agent/proposals/${id}/accept`,
      );
      if (response.ok) {
        const item = (await response.json()) as WorkItem;
        return { outcome: "applied", item };
      }
      // 409 (not pending / stale) and 404 (gone) both mean "no longer pending".
      if (response.status === 409 || response.status === 404) {
        return { outcome: "stale" };
      }
      // 422 (invalid payload) — the proposal can't be applied as-is.
      if (response.status === 422) {
        return { outcome: "invalid" };
      }
      // Anything else (401/5xx/…) is a real error, not an accept OUTCOME.
      throw new Error(await errorMessage(response));
    },

    reject: (id: string, reason?: string) =>
      request<void>("POST", `/api/agent/proposals/${id}/reject`, { reason }),
  };
}
