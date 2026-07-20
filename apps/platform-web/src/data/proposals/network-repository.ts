import type { WorkItem } from "@/data/work-items";

import type { ProposalRepository } from "./repository";
import type { AcceptFieldError, AcceptResult, Proposal } from "./types";

/** Parse a Response body as JSON once, tolerating a non-JSON/empty body (→ null). */
async function readJsonBody(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const body = (await response.json()) as unknown;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A finite number or null (guards NaN/undefined out of the version fields). */
function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Extract `field_errors[]` from an accept envelope body — Lane A's snake_case
 * shape `[{ field, message }]`. Anything malformed is dropped, so the UI only
 * ever renders well-formed, plain-language rows (empty ⇒ generic fallback).
 */
function readFieldErrors(body: Record<string, unknown> | null): AcceptFieldError[] {
  const raw = body?.field_errors;
  if (!Array.isArray(raw)) return [];
  const errors: AcceptFieldError[] = [];
  for (const entry of raw) {
    if (entry && typeof entry === "object") {
      const { field, message } = entry as Record<string, unknown>;
      if (typeof field === "string" && typeof message === "string") {
        errors.push({ field, message });
      }
    }
  }
  return errors;
}

/** Read the envelope's plain-language error message (`error` or `message`), if any. */
function readBodyMessage(body: Record<string, unknown> | null): string | null {
  if (typeof body?.error === "string") return body.error;
  if (typeof body?.message === "string") return body.message;
  return null;
}

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

    async accept(
      id: string,
      editedPayload?: Record<string, unknown>,
    ): Promise<AcceptResult> {
      // Ordinarily the id in the path IS the whole request. When the reviewer
      // edited the proposal (P1b — e.g. a rule's strength), send the FULL merged
      // payload as `edited_payload`; the backend applies `edited_payload ?? payload`
      // as a WHOLESALE replace, so a partial would drop kind/title and 422.
      const response = await rawFetch(
        "POST",
        `/api/agent/proposals/${id}/accept`,
        editedPayload === undefined ? undefined : { edited_payload: editedPayload },
      );
      if (response.ok) {
        const item = (await response.json()) as WorkItem;
        return { outcome: "applied", item };
      }
      // Read the error body ONCE (the stream is single-use) and derive every
      // non-applied outcome from it — the UX needs the envelope's richer fields
      // (field errors, current-vs-proposed versions, a stated failure reason),
      // not just the HTTP code.
      // TODO(lane-A-rebase): once Lane A ships, discriminate on the body's
      // `status` field directly (per the pinned envelope) instead of the HTTP
      // code; the field extraction below already matches Lane A's snake_case.
      const body = await readJsonBody(response);
      const envelopeStatus = typeof body?.status === "string" ? body.status : null;

      // 409 (item changed / not pending) and 404 (gone) surface as `stale` with
      // the current-vs-proposed version context the reconcile UI shows.
      if (response.status === 409 || response.status === 404 || envelopeStatus === "stale") {
        return {
          outcome: "stale",
          currentVersion: numberOrNull(body?.current_version),
          proposedVersion: numberOrNull(body?.proposed_version),
        };
      }
      // 422 (invalid payload) — the proposal can't be applied as-is; carry the
      // per-field, plain-language reasons.
      if (response.status === 422 || envelopeStatus === "invalid") {
        return { outcome: "invalid", fieldErrors: readFieldErrors(body) };
      }
      // An explicit `failed` envelope: a stated reason + retryability, surfaced
      // (not thrown) so the human sees a legible failure with a retry choice.
      if (envelopeStatus === "failed") {
        return {
          outcome: "failed",
          reason: readBodyMessage(body) ?? `Couldn't apply this proposal (${response.status}).`,
          retryable: body?.retryable !== false,
        };
      }
      // Anything else (401/network/unexpected 5xx with no envelope) is a real
      // transport error, not an accept OUTCOME — throw so it surfaces as such.
      throw new Error(readBodyMessage(body) ?? `Request failed (${response.status})`);
    },

    reject: (id: string, reason?: string) =>
      request<void>("POST", `/api/agent/proposals/${id}/reject`, { reason }),

    async activeRules(id: string): Promise<{ id: string; title: string }[]> {
      const body = await request<{ rules: { id: string; title: string }[] }>(
        "GET",
        `/api/agent/proposals/${id}/active-rules`,
      );
      return body.rules;
    },
  };
}
