/**
 * The promotion states the backend is allowed to send, in the order the triage
 * screen presents them — how far a promoted meeting action item has travelled
 * toward the board. Mirrors `MeetingPromotionState` in
 * `apps/platform-api/src/meeting/candidates.ts`; this tuple is the client's copy
 * of that contract, and `normalizePromotionState` is the boundary that enforces it.
 */
export const MEETING_PROMOTION_STATES = [
  "unpromoted",
  "proposal_pending",
  "accepted",
  "dismissed",
] as const;

/** One of the four states the backend sends today. */
export type MeetingPromotionStateName = (typeof MEETING_PROMOTION_STATES)[number];

/**
 * A promotion state as the UI may hold it: one of the four known states, or
 * `unknown` for anything else off the wire.
 *
 * `unknown` is deliberately NOT `unpromoted`. A state this client does not
 * recognize has still been acted on by some newer backend, and defaulting it to
 * "nothing has happened yet" would invite a human to re-propose work that was
 * already handled.
 */
export type MeetingPromotionState = MeetingPromotionStateName | "unknown";

/** Pass a state through only when it is exactly one of the known literals. */
export function normalizePromotionState(value: unknown): MeetingPromotionState {
  return typeof value === "string" &&
    (MEETING_PROMOTION_STATES as readonly string[]).includes(value)
    ? (value as MeetingPromotionStateName)
    : "unknown";
}

/**
 * One promoted meeting action item with its true promotion state — the row the
 * triage screen renders. The wire shape of `GET /api/agent/meeting-candidates`.
 */
export interface MeetingActionCandidate {
  /** The meeting-api content-derived record id (also the ledger's key). */
  id: string;
  meeting_id: string;
  /** The action item's text — what the human reads and decides on. */
  text: string;
  /** The extractor's self-confidence, when it recorded one. */
  confidence: number | null;
  /** Why the extractor promoted it, when it recorded a reason. */
  promotion_reason: string | null;
  created_at: string;
  promotion_state: MeetingPromotionState;
  /** The proposal this candidate became, once ingested — the Inbox link target. */
  proposal_id: string | null;
  /** The work item it became once accepted — the workboard link target. */
  work_item_id: string | null;
}

/**
 * What one ingest run did — the response of `POST /api/agent/meeting-ingest`.
 *
 * `skippedUnmappedTenant` is part of the contract, not a debug extra: the tenant
 * allowlist is fail-closed, so a tenant that is silently not ingesting looks
 * exactly like a tenant with no action items unless this count is visible.
 */
export interface MeetingSyncSummary {
  proposalsCreated: number;
  skippedDuplicate: number;
  skippedUnmappedTenant: number;
}
