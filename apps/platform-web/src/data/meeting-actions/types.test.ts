import { describe, expect, it } from "vitest";

import {
  MEETING_PROMOTION_STATES,
  normalizePromotionState,
  type MeetingPromotionState,
} from "./types";

describe("normalizePromotionState", () => {
  it("passes through every state the backend is allowed to send", () => {
    for (const state of MEETING_PROMOTION_STATES) {
      expect(normalizePromotionState(state)).toBe(state);
    }
    // The four the triage screen renders as distinct badges.
    expect(MEETING_PROMOTION_STATES).toEqual([
      "unpromoted",
      "proposal_pending",
      "accepted",
      "dismissed",
    ]);
  });

  it("normalizes an unrecognized or missing state to `unknown` rather than junk", () => {
    // A future backend state must render as a neutral badge, never as raw text in
    // the UI and never silently as `unpromoted` (which would invite re-proposing
    // something already handled).
    const unrecognized: unknown[] = [
      "queued_for_review",
      "",
      null,
      undefined,
      42,
      {},
      ["accepted"],
      "ACCEPTED",
    ];
    for (const value of unrecognized) {
      expect(normalizePromotionState(value)).toBe("unknown");
    }
  });

  it("never widens to `accepted` on a near-miss", () => {
    const state: MeetingPromotionState = normalizePromotionState("accepted_with_edits");
    expect(state).toBe("unknown");
  });
});
