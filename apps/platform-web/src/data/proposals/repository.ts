import type { WorkItem } from "@/data/work-items";

import { createProposalFixtures } from "./fixtures";
import type { AcceptResult, Proposal } from "./types";

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
        return settle<AcceptResult>({ outcome: "stale" });
      }
      const [proposal] = proposals.splice(index, 1);
      // Stamped per accept() (not once per repository) so each dev/demo
      // acceptance reflects when it actually happened.
      const now = new Date().toISOString();
      // Synthesize the item accept "produces" so the mock's applied path has a
      // linkable target id, mirroring what the real backend returns.
      const item = {
        id: proposal.target_id ?? `wi_new_${proposal.id}`,
        title:
          typeof proposal.payload.title === "string"
            ? proposal.payload.title
            : "Untitled work item",
        created_at: now,
        updated_at: now,
      } as WorkItem;
      return settle<AcceptResult>({ outcome: "applied", item });
    },

    reject(id: string) {
      const index = proposals.findIndex((proposal) => proposal.id === id);
      if (index !== -1) proposals.splice(index, 1);
      return settle(undefined);
    },
  };
}
