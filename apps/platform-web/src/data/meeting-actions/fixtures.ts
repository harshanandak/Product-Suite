import type { MeetingActionCandidate } from "./types";

/**
 * In-memory mock dataset for the meeting-triage seam — one candidate per
 * promotion state, so the fixtures surface (`bun run dev:fixtures`) and the
 * screen's default-repository path exercise all four badges and both link
 * targets without a backend.
 *
 * The link fields track the state rather than being filled in uniformly: only
 * `accepted` carries a `work_item_id`, and `unpromoted` carries neither id —
 * exactly what the real join produces, so a screen bug that links the wrong
 * state cannot hide behind over-populated fixtures.
 *
 * Exported through the {@link createMeetingActionFixtures} clone factory
 * (mirroring `data/proposals/fixtures`) so a mock repository can mutate freely
 * without poisoning the source across instances.
 */
const RAW_CANDIDATES: ReadonlyArray<MeetingActionCandidate> = [
  {
    id: "mai_quote_acme",
    meeting_id: "mtg_acme_review",
    text: "Send Acme the revised quote with the new freight terms",
    confidence: 0.86,
    promotion_reason: "Explicit commitment with a named owner and a deadline",
    created_at: "2026-07-24T09:15:00.000Z",
    promotion_state: "unpromoted",
    proposal_id: null,
    work_item_id: null,
  },
  {
    id: "mai_pricing_sheet",
    meeting_id: "mtg_acme_review",
    text: "Rebuild the pricing sheet for the Q3 catalogue refresh",
    confidence: 0.74,
    promotion_reason: "Agreed action, owner assigned in the meeting",
    created_at: "2026-07-24T09:22:00.000Z",
    promotion_state: "proposal_pending",
    proposal_id: "prop_meeting_pricing_sheet",
    work_item_id: null,
  },
  {
    id: "mai_supplier_audit",
    meeting_id: "mtg_supplier_sync",
    text: "Audit the two shortlisted suppliers before the next sync",
    confidence: 0.91,
    promotion_reason: "Blocking dependency for the supplier decision",
    created_at: "2026-07-23T14:40:00.000Z",
    promotion_state: "accepted",
    proposal_id: "prop_meeting_supplier_audit",
    work_item_id: "wi_meeting_supplier_audit",
  },
  {
    id: "mai_offsite_venue",
    meeting_id: "mtg_supplier_sync",
    text: "Look into venues for the team offsite",
    confidence: 0.42,
    promotion_reason: "Mentioned in passing; no owner named",
    created_at: "2026-07-23T14:52:00.000Z",
    promotion_state: "dismissed",
    proposal_id: "prop_meeting_offsite_venue",
    work_item_id: null,
  },
];

/** A fresh, independently-mutable copy of the meeting-candidate fixtures. */
export function createMeetingActionFixtures(): MeetingActionCandidate[] {
  return RAW_CANDIDATES.map((candidate) => ({ ...candidate }));
}
