/**
 * Meeting-action-item data seam — public surface (the meeting→board loop, Slice C).
 *
 * The meeting triage screen imports everything from here, never from the
 * individual modules. Mirrors `data/proposals`' barrel: the underlying repository
 * adapter (mock vs network) swaps without touching callers.
 */
export type {
  MeetingActionCandidate,
  MeetingPromotionState,
  MeetingPromotionStateName,
} from "./types";
export { MEETING_PROMOTION_STATES, normalizePromotionState } from "./types";

export type { MeetingActionsRepository } from "./repository";
export { createMockMeetingActionsRepository } from "./repository";

export { createMeetingActionFixtures } from "./fixtures";

export type { NetworkMeetingActionsRepositoryOptions } from "./network-repository";
export { createNetworkMeetingActionsRepository } from "./network-repository";

export {
  getDefaultMeetingActionsRepository,
  useMeetingActions,
} from "./use-meeting-actions";
export type {
  UseMeetingActionsOptions,
  UseMeetingActionsResult,
} from "./use-meeting-actions";

export {
  MeetingActionsRepositoryProvider,
  useMeetingActionsRepositoryContext,
} from "./MeetingActionsRepositoryProvider";
