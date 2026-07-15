import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";

import { API_BASE_URL } from "../../env";

/**
 * The object a chat thread is scoped to. Captured at panel-open time from the
 * current screen (via `resolveScreen`) and sent as hidden request context — the
 * SERVER folds it into the system prompt (never a fake user message).
 */
export interface AgentLinkedObject {
  type: string;
  id: string;
  title: string;
}

/**
 * Object-scoping context sent in the agent chat request body. The backend
 * (`buildSystemPrompt`) reads this to tell the agent what the user is viewing;
 * unknown shapes are ignored server-side.
 */
export interface AgentChatContext {
  workspace: string;
  object?: AgentLinkedObject;
}

/** Configuration for {@link createAgentChatTransport}. */
export interface CreateAgentChatTransportOptions {
  /**
   * Resolve the current Clerk session token (via `useAuth().getToken()`), or
   * `null` when signed out. Called per request so a rotated token is always used
   * — mirrors the proposals / work-items network repositories.
   */
  getToken: () => Promise<string | null>;
  /** Origin of the platform API (no trailing slash); defaults to {@link API_BASE_URL}. */
  apiBase?: string;
  /**
   * Read the object-scoping context per request, so a re-scoped ("start a new
   * thread here") panel sends fresh context without rebuilding the transport.
   */
  getContext: () => AgentChatContext | undefined;
  /**
   * Resolve the caller's ACTIVE org id (Clerk `useAuth().orgId`), or `null` when
   * signed out / no active org. Sent as `org_id` so the run anchors to it —
   * REQUIRED for a user in more than one org, or the API 400s "Ambiguous
   * organization" and every message fails. Single-org callers can omit it (the
   * API falls back to their sole org).
   */
  getOrgId?: () => string | null;
  /**
   * Resolve the CURRENT thread id, or `null` for a brand-new thread. Sent as
   * `thread_id`; when null the SERVER mints the thread and returns its id via the
   * `x-thread-id` response header (see {@link onThreadId}) — killing the
   * first-message race (never client-create-then-save).
   */
  getThreadId?: () => string | null;
  /**
   * Called with the server-minted thread id read from the `x-thread-id` response
   * header. The new-thread flow captures it here and sends it on later turns.
   */
  onThreadId?: (threadId: string) => void;
}

/**
 * Wrap a `fetch` so it reads the `x-thread-id` response header and hands it to
 * {@link onThreadId} — how the client learns the SERVER-minted thread id without a
 * second round-trip. Pure (takes the base `fetch`) so it is unit-testable without a
 * live transport. Non-fatal: a missing header simply yields no callback.
 */
export function captureThreadIdFetch(
  onThreadId: (threadId: string) => void,
  baseFetch: typeof fetch = fetch,
): typeof fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    const id = response.headers.get("x-thread-id");
    if (id) onThreadId(id);
    return response;
  };
}

/**
 * Build the bearer auth headers for an agent chat request. Attaches
 * `Authorization: Bearer <token>` when signed in, nothing when signed out —
 * mirrors `data/proposals/network-repository.ts`.
 */
export async function agentChatAuthHeaders(
  getToken: () => Promise<string | null>,
): Promise<Record<string, string>> {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * The `DefaultChatTransport` config, split out as a pure function so its three
 * moving parts — the endpoint, the async bearer headers, and the per-request
 * body carrying the scoping `context` — are fully unit-testable without a live
 * `useChat`.
 */
export function agentChatTransportConfig(
  options: CreateAgentChatTransportOptions,
): {
  api: string;
  headers: () => Promise<Record<string, string>>;
  body: () => {
    org_id?: string;
    thread_id?: string;
    context: AgentChatContext | undefined;
  };
  fetch?: typeof fetch;
} {
  const apiBase = options.apiBase ?? API_BASE_URL;
  return {
    api: `${apiBase}/api/agent/chat`,
    headers: () => agentChatAuthHeaders(options.getToken),
    body: () => {
      const orgId = options.getOrgId?.() ?? undefined;
      const threadId = options.getThreadId?.() ?? undefined;
      // Omit each key when absent: no org_id keeps the API's sole-org fallback; no
      // thread_id tells the server to MINT the thread and return its id.
      return {
        ...(orgId ? { org_id: orgId } : {}),
        ...(threadId ? { thread_id: threadId } : {}),
        context: options.getContext(),
      };
    },
    // Capture the server-minted thread id from the response header.
    ...(options.onThreadId
      ? { fetch: captureThreadIdFetch(options.onThreadId) }
      : {}),
  };
}

/**
 * Build the `useChat` transport against `POST /api/agent/chat`: Clerk-bearer
 * headers (resolved per request) + the hidden object-scoping `context`. The AI
 * SDK merges `messages` into the same body; the backend reads `messages`,
 * `org_id?`, and `context?`.
 */
export function createAgentChatTransport(
  options: CreateAgentChatTransportOptions,
): DefaultChatTransport<UIMessage> {
  return new DefaultChatTransport<UIMessage>(agentChatTransportConfig(options));
}
