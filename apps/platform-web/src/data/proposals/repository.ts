import { createProposalFixtures } from "./fixtures";
import type { AcceptResult, Proposal, UndoResult } from "./types";

/**
 * Proposal review SEAM (mirrors the work-items {@link WorkItemRepository}): the
 * inbox reads pending proposals and disposes of them through this interface, and
 * only the adapter implementation (mock vs network) swaps beneath it.
 */
export interface ProposalRepository {
  /** All PENDING proposals (tenant-scoped). */
  list(): Promise<Proposal[]>;
  /**
   * Accept a proposal — the backend applies it (creates/updates the target work
   * item). The result is a discriminated {@link AcceptResult}: `applied` carries
   * the resulting item, while `stale`/`invalid` surface the 409/404 and 422
   * cases WITHOUT throwing, so the caller can message them precisely.
   *
   * `editedPayload` is a human's gold-label correction (P1b): the backend applies
   * `edited_payload ?? payload` as a WHOLESALE replace, so callers must send the
   * FULL merged payload (never a partial), or omit it to accept the agent's original.
   */
  accept(id: string, editedPayload?: Record<string, unknown>): Promise<AcceptResult>;
  /** Reject a proposal, with an optional human reason. */
  reject(id: string, reason?: string): Promise<void>;
  /**
   * Undo an ACCEPTED change — write the item's previous values back through the
   * same validated path the accept used. Scoped to `work_item` `update` proposals
   * (a create's inverse is a delete; memory ops reverse via supersede/retract).
   *
   * The result is a discriminated {@link UndoResult} rather than a throw: a
   * `conflict` (someone edited the item after the accept — nothing was written) is
   * a normal, explainable outcome the reviewer must see, not an error.
   */
  undo(id: string): Promise<UndoResult>;
  /**
   * The `kind='rule'` memories that were active during the run that authored this
   * proposal — provenance for the "Rules active when this was drafted" badge (never
   * causation). Empty when the proposal has no authoring run or no rule attributions
   * (a holdout run suppressed them). Only meaningful for work-item proposals.
   */
  activeRules(id: string): Promise<{ id: string; title: string }[]>;
}

/**
 * An in-memory mock {@link ProposalRepository} over the shared
 * {@link createProposalFixtures} dataset. Each call owns an isolated copy of the
 * fixtures (so parallel instances/tests never share state). `accept` removes the
 * proposal and returns a synthetic `applied` item; `reject` removes it.
 *
 * @param options.latencyMs - optional artificial per-call delay for loading states.
 */
export function createMockProposalRepository(
  options: { latencyMs?: number } = {},
): ProposalRepository {
  const latencyMs = options.latencyMs ?? 0;
  const proposals: Proposal[] = createProposalFixtures();
  // Every proposal this instance has ACCEPTED, with the state of its reversal.
  // Accepted-ness and undoability are tracked separately on purpose: `not_found`
  // must mean "unknown or never accepted", so an accepted proposal that is merely
  // outside undo's scope (a create) — or one already undone — is KNOWN and reports
  // `not_undoable` WITH the reason, instead of masquerading as missing.
  type UndoState = "available" | "out_of_scope" | "already_undone";
  const accepted = new Map<string, { itemId: string; undo: UndoState }>();
  const UNDO_REFUSALS: Record<Exclude<UndoState, "available">, string> = {
    out_of_scope: "only an applied work item update can be undone",
    already_undone: "this change has already been undone",
  };

  const settle = <T>(value: T): Promise<T> =>
    latencyMs > 0
      ? new Promise((resolve) => setTimeout(() => resolve(value), latencyMs))
      : Promise.resolve(value);

  const clone = (proposal: Proposal): Proposal => ({
    ...proposal,
    payload: { ...proposal.payload },
  });

  return {
    list() {
      return settle(proposals.map(clone));
    },

    accept(id: string) {
      const index = proposals.findIndex((proposal) => proposal.id === id);
      if (index === -1) {
        // Already disposed of by another reviewer/tab — no longer pending.
        return settle<AcceptResult>({ status: "not_pending", proposal_id: id });
      }
      const [proposal] = proposals.splice(index, 1);
      // Synthesize the applied item id so the mock's applied path has a linkable
      // target, mirroring what the real backend returns as `item_id`.
      const itemId = proposal.target_id ?? `wi_new_${proposal.id}`;
      // Only a work-item UPDATE is reversible — mirrors the API's undo scope so the
      // fixture surface offers Undo in exactly the cases the real backend accepts.
      accepted.set(id, {
        itemId,
        undo:
          proposal.target_type === "work_item" && proposal.operation === "update"
            ? "available"
            : "out_of_scope",
      });
      return settle<AcceptResult>({
        status: "applied",
        proposal_id: id,
        item_id: itemId,
      });
    },

    reject(id: string) {
      const index = proposals.findIndex((proposal) => proposal.id === id);
      if (index !== -1) proposals.splice(index, 1);
      return settle(undefined);
    },

    undo(id: string) {
      const record = accepted.get(id);
      // Never accepted here (or an id we have never seen) — genuinely unknown.
      if (record === undefined) {
        return settle<UndoResult>({ status: "not_found", proposal_id: id });
      }
      if (record.undo !== "available") {
        // KNOWN, but nothing to reverse — either outside undo's scope or already
        // undone. Say which, so the banner can explain rather than deny existence.
        return settle<UndoResult>({
          status: "not_undoable",
          proposal_id: id,
          message: UNDO_REFUSALS[record.undo],
        });
      }
      // Single-step: consumed, so the same accept cannot be undone twice.
      accepted.set(id, { itemId: record.itemId, undo: "already_undone" });
      return settle<UndoResult>({
        status: "undone",
        proposal_id: id,
        item_id: record.itemId,
      });
    },

    // The mock dataset carries no run→rule attributions — provenance is a
    // network-only concern, so the fixtures surface renders no badge.
    activeRules() {
      return settle<{ id: string; title: string }[]>([]);
    },
  };
}
