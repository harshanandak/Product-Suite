import type { AcceptResult } from "./types";

/**
 * A tiny process-wide pub/sub for proposal DISPOSALS, so every independent
 * {@link useProposals} instance (the shell launcher badge, the chat Pending
 * section, the Review Inbox) stays in sync when a proposal leaves the pending set
 * in ANY of them — without threading a shared store through the tree.
 *
 * A disposal in the inline card or a Pending row (via `useProposalActions`) or in
 * the inbox (via `useProposals.accept/reject`) calls {@link notifyProposalMutation};
 * every mounted `useProposals` subscribes and refetches, so the badge count can
 * never go stale after a disposal elsewhere. An explicit "Refresh" on a stale card
 * reuses the same signal to re-list against current state.
 *
 * Fire ONLY when the proposal actually LEFT the pending set — see
 * {@link isTerminalAcceptOutcome}. A still-pending outcome (stale / invalid /
 * failed / thrown transport error) must NOT signal, or every mounted useProposals
 * re-lists needlessly (and could remount a row mid-recovery).
 */
type ProposalMutationListener = () => void;

/**
 * Whether an accept outcome REMOVED the proposal from the pending set (so the
 * pending count changed and listeners should re-list):
 *  - `applied` wrote it; `not_pending`/`not_found` mean it is already gone.
 *  - `failed` with `retryable === false` is ALSO terminal: the server (apply.ts)
 *    has already moved that proposal to `failed` in the DB, so it left the set.
 *  - `stale`, `invalid`, and a RETRYABLE `failed` (transient) leave it PENDING and
 *    recoverable, so they are NOT terminal and must not signal.
 */
export function isTerminalAcceptOutcome(result: AcceptResult): boolean {
  if (
    result.status === "applied" ||
    result.status === "not_pending" ||
    result.status === "not_found"
  ) {
    return true;
  }
  return result.status === "failed" && result.retryable === false;
}

const listeners = new Set<ProposalMutationListener>();

/** Subscribe to disposals; returns an unsubscribe fn (call it on unmount). */
export function subscribeProposalMutations(
  listener: ProposalMutationListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Notify every subscriber that a proposal left the pending set. */
export function notifyProposalMutation(): void {
  // Iterate a copy so a listener that (un)subscribes during dispatch is safe.
  for (const listener of [...listeners]) listener();
}
