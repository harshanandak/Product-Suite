import type { ProposalRepository } from "./repository";
import type { AcceptResult, Proposal } from "./types";

/** Parse a Response body as JSON once, tolerating a non-JSON/empty body (→ null). */
async function readJsonBody(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const body = (await response.json()) as unknown;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Read the envelope's plain-language message (`message` or `error`), if any. */
function readBodyMessage(body: Record<string, unknown> | null): string | null {
  if (typeof body?.message === "string") return body.message;
  if (typeof body?.error === "string") return body.error;
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
      // Lane A's contract ALWAYS carries the typed envelope in the JSON body,
      // discriminated on `status` — read that, not the HTTP code. Read the body
      // ONCE (the stream is single-use).
      // TODO(contracts-swap): the returned union IS Lane A's `AcceptResult`; once
      // Lane A lands it in `@product-suite/contracts`, import that type here. Parsing
      // stays in this adapter as the trust boundary regardless.
      const body = await readJsonBody(response);
      const status = typeof body?.status === "string" ? body.status : null;
      const proposalId = typeof body?.proposal_id === "string" ? body.proposal_id : id;
      const itemId = typeof body?.item_id === "string" ? body.item_id : "";
      // The applied item's id, tolerating BOTH response shapes: the LOCKED envelope
      // carries `item_id`; the CURRENT live API (routes/proposals.ts) still returns
      // the applied ROW on 2xx, whose id is `id`. Prefer the envelope field.
      const rowId = typeof body?.id === "string" ? body.id : "";

      switch (status) {
        case "applied":
          return { status: "applied", proposal_id: proposalId, item_id: itemId };
        case "invalid":
          return {
            status: "invalid",
            proposal_id: proposalId,
            message: readBodyMessage(body) ?? "The server couldn't apply this proposal as-is.",
            // invalid is fixable by default — only a false flag hides Retry.
            retryable: body?.retryable !== false,
          };
        case "stale":
          return {
            status: "stale",
            proposal_id: proposalId,
            item_id: itemId,
            message:
              readBodyMessage(body) ??
              "This item changed since the agent proposed it.",
          };
        case "failed":
          return {
            status: "failed",
            proposal_id: proposalId,
            message: readBodyMessage(body) ?? "Couldn't apply this proposal.",
            // failed is terminal unless the backend explicitly says retryable.
            retryable: body?.retryable === true,
          };
        case "not_found":
          return { status: "not_found", proposal_id: proposalId };
        case "not_pending":
          return { status: "not_pending", proposal_id: proposalId };
        default:
          break;
      }

      // No typed envelope in the body. Reconcile the CURRENT live API shape by the
      // HTTP code, else throw a genuine transport error (401/network/unexpected 5xx).
      // TODO(contracts-swap): this whole block is the C-before-A shim. Because Lane C
      // merges BEFORE Lane A's envelope ships, the live API still returns the applied
      // ROW on 2xx (item_id from the row `id`) and `{error}` bodies on 4xx. Once Lane
      // A's typed envelope is the only response, the `status` switch above handles
      // everything and this HTTP-code reconciliation can be deleted.
      if (response.ok) {
        // A 2xx with no `status` is the live API's applied row → applied.
        return { status: "applied", proposal_id: proposalId, item_id: itemId || rowId };
      }
      if (response.status === 409) {
        // The live API returns 409 for BOTH not_pending and stale; disambiguate by
        // the message so a superseded proposal isn't mislabelled as a conflict.
        if (/pending/i.test(readBodyMessage(body) ?? "")) {
          return { status: "not_pending", proposal_id: proposalId };
        }
        return {
          status: "stale",
          proposal_id: proposalId,
          item_id: itemId,
          message:
            readBodyMessage(body) ?? "This item changed since the agent proposed it.",
        };
      }
      if (response.status === 404) {
        return { status: "not_found", proposal_id: proposalId };
      }
      if (response.status === 422) {
        return {
          status: "invalid",
          proposal_id: proposalId,
          message: readBodyMessage(body) ?? "The server couldn't apply this proposal as-is.",
          retryable: true,
        };
      }
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
