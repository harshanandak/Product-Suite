import { describe, expect, it } from "vitest";

import * as meetingActions from "./index";

describe("data/meeting-actions barrel", () => {
  it("re-exports the public seam surface", () => {
    expect(typeof meetingActions.createMockMeetingActionsRepository).toBe("function");
    expect(typeof meetingActions.createNetworkMeetingActionsRepository).toBe(
      "function",
    );
    expect(typeof meetingActions.createMeetingActionFixtures).toBe("function");
    expect(typeof meetingActions.useMeetingActions).toBe("function");
    expect(typeof meetingActions.getDefaultMeetingActionsRepository).toBe("function");
    expect(typeof meetingActions.MeetingActionsRepositoryProvider).toBe("function");
    expect(typeof meetingActions.useMeetingActionsRepositoryContext).toBe("function");
    expect(typeof meetingActions.normalizePromotionState).toBe("function");
    expect(meetingActions.MEETING_PROMOTION_STATES).toHaveLength(4);
  });

  it("getDefaultMeetingActionsRepository returns a stable singleton", () => {
    expect(meetingActions.getDefaultMeetingActionsRepository()).toBe(
      meetingActions.getDefaultMeetingActionsRepository(),
    );
  });
});
