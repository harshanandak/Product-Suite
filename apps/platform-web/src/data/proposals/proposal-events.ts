/**
 * A tiny process-wide pub/sub for proposal DISPOSALS, so every independent
 * {@link useProposals} instance (the shell launcher badge, the chat Pending
 * section, the Review Inbox) stays in sync when a proposal is accepted or
 * rejected in ANY of them — without threading a shared store through the tree.
 *
 * A disposal in the inline card or a Pending row (via `useProposalActions`) or in
 * the inbox (via `useProposals.accept/reject`) calls {@link notifyProposalMutation};
 * every mounted `useProposals` subscribes and refetches, so the badge count can
 * never go stale after a disposal elsewhere.
 *
 * Fire ONLY on a terminal disposal (applied / rejected) — a still-pending outcome
 * (stale / invalid / failed) leaves the pending set unchanged, so re-listing would
 * be wasted work (and could remount a row mid-recovery).
 */
type ProposalMutationListener = () => void;

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
