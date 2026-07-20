import { useEffect, useRef, useState } from "react";

import { notifyProposalMutation } from "./proposal-events";
import { useProposalRepositoryContext } from "./ProposalRepositoryProvider";
import type { ProposalRepository } from "./repository";
import type { AcceptResult } from "./types";
import { getDefaultProposalRepository } from "./use-proposals";

/** The accept lifecycle phase a consumer renders from (see {@link AcceptStateView}). */
export type ProposalActionPhase = "idle" | "applying" | "settled" | "rejected";

/** Options for {@link useProposalActions}. The repo is injectable for tests. */
export interface UseProposalActionsOptions {
  /** Repository to dispose through; defaults to context → module singleton. */
  repository?: ProposalRepository;
  /** Called after a settle (accept or reject) so a host can refetch a shared list. */
  onSettled?: (result: AcceptResult | "rejected") => void;
}

/** Return shape of {@link useProposalActions}. */
export interface UseProposalActionsResult {
  /** Where in the accept lifecycle this proposal is. */
  phase: ProposalActionPhase;
  /** The settled accept envelope (only when `phase === "settled"`), else null. */
  result: AcceptResult | null;
  /** True while accept/reject is in flight — disables the actions. */
  busy: boolean;
  /** A reject failure surfaced VISIBLY (accept failures become a `failed` result). */
  error: string | null;
  /**
   * Accept the proposal. Optimistic: flips to `applying` immediately, then
   * `settled` with the typed result. A THROWN transport error is surfaced as a
   * `failed` result (retryable) — never a silent no-op. Double-clicks collapse to
   * ONE apply via the in-flight guard (Stripe-style safe retry; server
   * idempotency via the `applied_from_proposal_id` unique index backs it).
   */
  accept: (editedPayload?: Record<string, unknown>) => void;
  /** Discard (reject) the proposal; settles to `rejected`, or surfaces `error`. */
  reject: (reason?: string) => void;
  /** Return to `idle` (the host's Accept affordance) — the "Edit" recovery path. */
  reset: () => void;
}

/**
 * `useProposalActions(proposalId)` — the placement-agnostic accept/reject engine
 * shared by the inline chat card, the Pending section, and the standalone inbox.
 * It wraps the SAME {@link ProposalRepository} the inbox list uses (injected →
 * context → singleton), owns the accept lifecycle state, and enforces the
 * double-click-safe in-flight guard so one card goes idle → applying →
 * settled/rejected with a single write.
 */
export function useProposalActions(
  proposalId: string,
  options: UseProposalActionsOptions = {},
): UseProposalActionsResult {
  const contextRepository = useProposalRepositoryContext();
  const [repository] = useState<ProposalRepository>(
    () => options.repository ?? contextRepository ?? getDefaultProposalRepository(),
  );

  const [phase, setPhase] = useState<ProposalActionPhase>("idle");
  const [result, setResult] = useState<AcceptResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Synchronous re-entry guard: the SECOND click of a double-click is rejected
  // before React repaints the disabled button, so accept fires exactly once.
  const inFlightRef = useRef(false);
  // Guards setState after unmount across the async accept/reject.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const onSettled = options.onSettled;

  const accept = (editedPayload?: Record<string, unknown>): void => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy(true);
    setError(null);
    setPhase("applying");
    void repository
      .accept(proposalId, editedPayload)
      .then((settled) => {
        if (!mountedRef.current) return;
        setResult(settled);
        setPhase("settled");
        onSettled?.(settled);
        // An applied proposal LEFT the pending set — re-sync every useProposals
        // (the launcher badge, the Pending section). Stale/invalid/failed stay
        // pending, so they intentionally do not signal.
        if (settled.status === "applied") notifyProposalMutation();
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return;
        // A thrown transport error is still legible + recoverable — surface it as
        // a retryable `failed` result rather than a silent revert.
        const failed: AcceptResult = {
          status: "failed",
          proposal_id: proposalId,
          message:
            err instanceof Error ? err.message : "Couldn't apply this proposal. Please try again.",
          retryable: true,
        };
        setResult(failed);
        setPhase("settled");
        onSettled?.(failed);
      })
      .finally(() => {
        inFlightRef.current = false;
        if (mountedRef.current) setBusy(false);
      });
  };

  const reject = (reason?: string): void => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy(true);
    setError(null);
    void repository
      .reject(proposalId, reason)
      .then(() => {
        if (!mountedRef.current) return;
        setResult(null);
        setPhase("rejected");
        onSettled?.("rejected");
        // A rejected proposal left the pending set — re-sync every useProposals.
        notifyProposalMutation();
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return;
        // A failed discard must never read as success — keep the pane actionable
        // and surface the reason.
        setError(
          err instanceof Error ? err.message : "Couldn't discard this proposal. Please try again.",
        );
      })
      .finally(() => {
        inFlightRef.current = false;
        if (mountedRef.current) setBusy(false);
      });
  };

  const reset = (): void => {
    setPhase("idle");
    setResult(null);
    setError(null);
  };

  return { phase, result, busy, error, accept, reject, reset };
}
