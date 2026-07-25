import { describe, expect, it } from "vitest";

import { createMeetingActionFixtures } from "./fixtures";
import { MEETING_PROMOTION_STATES } from "./types";

describe("createMeetingActionFixtures", () => {
  it("covers every promotion state the triage screen renders", () => {
    const states = createMeetingActionFixtures().map((c) => c.promotion_state);
    for (const state of MEETING_PROMOTION_STATES) {
      expect(states).toContain(state);
    }
  });

  it("carries the link targets each state needs, and none it does not", () => {
    const byState = new Map(
      createMeetingActionFixtures().map((c) => [c.promotion_state, c]),
    );

    // An accepted candidate reached the board, so it must have something to link to.
    expect(byState.get("accepted")?.work_item_id).toBeTruthy();
    // A pending one links to the Inbox, so it needs its proposal id and NO work item.
    expect(byState.get("proposal_pending")?.proposal_id).toBeTruthy();
    expect(byState.get("proposal_pending")?.work_item_id).toBeNull();
    // An unpromoted one has neither — nothing has been written for it yet.
    expect(byState.get("unpromoted")?.proposal_id).toBeNull();
    expect(byState.get("unpromoted")?.work_item_id).toBeNull();
  });

  it("hands each caller an isolated copy so one instance cannot poison another", () => {
    const first = createMeetingActionFixtures();
    first[0]!.text = "mutated";
    expect(createMeetingActionFixtures()[0]?.text).not.toBe("mutated");
  });
});
