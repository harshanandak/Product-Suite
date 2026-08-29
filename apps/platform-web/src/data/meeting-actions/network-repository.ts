import { assertSecureApiBaseUrl } from "../../env";

import type { MeetingActionsRepository } from "./repository";
import {
  normalizePromotionState,
  type MeetingActionCandidate,
  type MeetingSyncSummary,
} from "./types";

/** Configuration for {@link createNetworkMeetingActionsRepository}. */
export interface NetworkMeetingActionsRepositoryOptions {
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

/** A string field off the wire, or `""` when the value is not a string. */
function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A nullable string field: the string, or `null` for anything else. */
function readNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** A nullable number field: finite numbers only, so `NaN`/`"0.8"` become `null`. */
function readNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A count field: finite numbers only, so a missing count reads 0, never `NaN`. */
function readCount(value: unknown): number {
  return readNullableNumber(value) ?? 0;
}

/**
 * Reshape one candidate at the trust boundary. Every field is coerced, and the
 * promotion state is normalized, so a backend that adds a state or drops a field
 * can never put junk on screen.
 */
function readCandidate(raw: Record<string, unknown>): MeetingActionCandidate {
  return {
    id: readString(raw.id),
    meeting_id: readString(raw.meeting_id),
    text: readString(raw.text),
    confidence: readNullableNumber(raw.confidence),
    promotion_reason: readNullableString(raw.promotion_reason),
    created_at: readString(raw.created_at),
    promotion_state: normalizePromotionState(raw.promotion_state),
    proposal_id: readNullableString(raw.proposal_id),
    work_item_id: readNullableString(raw.work_item_id),
  };
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

/**
 * The network {@link MeetingActionsRepository} — the adapter behind the meeting
 * triage screen against `GET /api/agent/meeting-candidates` (Clerk-verified,
 * tenant-scoped). It mirrors the proposals network repository's request primitive
 * (bearer header, abort timeout, `error`-field extraction) and adds the same kind
 * of wire normalization at the boundary.
 *
 * Two deliberate differences from the proposals adapter:
 *  - It sends NO tenant/org parameter. The server derives scope from the token.
 *  - Signed out, it THROWS instead of issuing a bearer-less request. There is no
 *    useful unauthenticated answer here, so failing locally beats a round trip
 *    that can only 401.
 */
export function createNetworkMeetingActionsRepository(
  options: NetworkMeetingActionsRepositoryOptions,
): MeetingActionsRepository {
  const { baseUrl, getToken } = options;
  assertSecureApiBaseUrl(baseUrl);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  /** Authorized fetch: resolves the token first, refusing to call while signed out. */
  async function authorizedFetch(method: string, path: string): Promise<Response> {
    const token = await getToken();
    if (!token) {
      throw new Error("Not signed in — sign in to read meeting action items.");
    }
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  return {
    async list(): Promise<MeetingActionCandidate[]> {
      const response = await authorizedFetch("GET", "/api/agent/meeting-candidates");
      if (!response.ok) {
        throw new Error(await errorMessage(response));
      }
      const body = (await response.json()) as { candidates?: unknown };
      // A malformed envelope means "no candidates", not a crash: the triage screen
      // showing an empty list is a far better failure than a blank error page.
      if (!Array.isArray(body?.candidates)) return [];
      return body.candidates
        .filter(
          (candidate): candidate is Record<string, unknown> =>
            typeof candidate === "object" && candidate !== null,
        )
        .map(readCandidate);
    },

    async sync(): Promise<MeetingSyncSummary> {
      // No body: the ingest derives its org from the verified token, exactly as
      // the read does. The route tolerates an absent JSON body by design.
      const response = await authorizedFetch("POST", "/api/agent/meeting-ingest");
      if (!response.ok) {
        throw new Error(await errorMessage(response));
      }
      const body = (await response.json()) as Record<string, unknown>;
      return {
        proposalsCreated: readCount(body?.proposalsCreated),
        skippedDuplicate: readCount(body?.skippedDuplicate),
        skippedUnmappedTenant: readCount(body?.skippedUnmappedTenant),
      };
    },
  };
}
