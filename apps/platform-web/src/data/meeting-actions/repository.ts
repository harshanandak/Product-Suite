import { createMeetingActionFixtures } from "./fixtures";
import type { MeetingActionCandidate, MeetingSyncSummary } from "./types";

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
  /**
   * Run the ingest — propose the promoted action items not already proposed, and
   * report what happened. The backend is idempotent via the promotion ledger, so
   * a repeated sync creates nothing rather than duplicating.
   */
  sync(): Promise<MeetingSyncSummary>;
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
  // The ids THIS instance has proposed, so a repeated sync reports them as
  // duplicates rather than re-proposing them — the fixture stand-in for the
  // `meeting_promotions` ledger.
  const proposed = new Set<string>();

  const settle = <T>(value: T): Promise<T> =>
    latencyMs > 0
      ? new Promise((resolve) => setTimeout(() => resolve(value), latencyMs))
      : Promise.resolve(value);

  return {
    list() {
      return settle(candidates.map((candidate) => ({ ...candidate })));
    },

    sync() {
      // Candidates an EARLIER sync already proposed — the duplicates this run
      // skips, counted before this run adds to the set.
      const skippedDuplicate = proposed.size;
      let proposalsCreated = 0;
      for (const candidate of candidates) {
        // Only an UNPROMOTED candidate is a new proposal. An accepted or dismissed
        // one has been decided, and re-proposing it would reopen a question the
        // human already answered.
        if (candidate.promotion_state !== "unpromoted") continue;
        candidate.promotion_state = "proposal_pending";
        candidate.proposal_id = `prop_synced_${candidate.id}`;
        proposed.add(candidate.id);
        proposalsCreated += 1;
      }
      return settle<MeetingSyncSummary>({
        proposalsCreated,
        skippedDuplicate,
        // The fixture store has no allowlist to fall outside of.
        skippedUnmappedTenant: 0,
      });
    },
  };
}
