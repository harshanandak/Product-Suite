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
  body: () => { org_id?: string; context: AgentChatContext | undefined };
} {
  const apiBase = options.apiBase ?? API_BASE_URL;
  return {
    api: `${apiBase}/api/agent/chat`,
    headers: () => agentChatAuthHeaders(options.getToken),
    body: () => {
      const orgId = options.getOrgId?.() ?? undefined;
      // Omit the key entirely when absent so single-org callers keep the API's
      // sole-org fallback; send it (anchoring the run) whenever we know it.
      return orgId
        ? { org_id: orgId, context: options.getContext() }
        : { context: options.getContext() };
    },
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
