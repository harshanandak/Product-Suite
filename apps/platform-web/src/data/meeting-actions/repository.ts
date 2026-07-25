import { createMeetingActionFixtures } from "./fixtures";
import type { MeetingActionCandidate } from "./types";

/**
 * Meeting-triage SEAM (mirrors the {@link ProposalRepository}): the triage screen
 * reads this org's promoted meeting action items through this interface, and only
 * the adapter implementation (mock vs network) swaps beneath it.
 *
 * There is no tenant argument anywhere in this interface, deliberately. Scope
 * comes from the verified Clerk session server-side (`callerTenantIds`) — a
 * client-supplied tenant id would be a request to be trusted about identity.
 */
export interface MeetingActionsRepository {
  /** This org's promoted action items, each with its true promotion state. */
  list(): Promise<MeetingActionCandidate[]>;
}

/**
 * An in-memory mock {@link MeetingActionsRepository} over the shared
 * {@link createMeetingActionFixtures} dataset. Each call owns an isolated copy so
 * parallel instances never share state.
 *
 * @param options.latencyMs - optional artificial per-call delay for loading states.
 */
export function createMockMeetingActionsRepository(
  options: { latencyMs?: number } = {},
): MeetingActionsRepository {
  const latencyMs = options.latencyMs ?? 0;
  const candidates: MeetingActionCandidate[] = createMeetingActionFixtures();

  const settle = <T>(value: T): Promise<T> =>
    latencyMs > 0
      ? new Promise((resolve) => setTimeout(() => resolve(value), latencyMs))
      : Promise.resolve(value);

  return {
    list() {
      return settle(candidates.map((candidate) => ({ ...candidate })));
    },
  };
}
