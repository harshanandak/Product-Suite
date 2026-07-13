import type { WorkItem } from "@/data/work-items";

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
   */
  accept(id: string): Promise<AcceptResult>;
  /** Reject a proposal, with an optional human reason. */
  reject(id: string, reason?: string): Promise<void>;
}

/**
 * A small, realistic fixture set: one `create` proposal and one `update`
 * proposal against a fixture work item. Enough to drive stories/manual runs and
 * to give a no-provider fallback (tests inject their own controlled repos).
 */
function createProposalFixtures(): Proposal[] {
  return [
    {
      id: "prop_create_1",
      target_type: "work_item",
      target_id: null,
      operation: "create",
      payload: {
        title: "Draft Q3 pricing brief",
        priority: "high",
        type: "task",
        description:
          "Summarize the competitive pricing signals from the last two calls.",
      },
      rationale:
        "The Aqua and Marine calls both surfaced pricing objections; a brief keeps the team aligned before the next round.",
      confidence: 0.82,
      status: "pending",
      run_id: "run_9f2a",
      model_id: "kimi-k2.5",
      created_at: "2026-07-13T09:12:00.000Z",
    },
    {
      id: "prop_update_1",
      target_type: "work_item",
      target_id: "wi_1",
      operation: "update",
      payload: { priority: "critical", phase: "execute" },
      rationale:
        "The blocker on the payments revamp escalated overnight — raising priority reflects the new urgency.",
      confidence: 0.64,
      status: "pending",
      run_id: "run_9f2a",
      model_id: "kimi-k2.5",
      created_at: "2026-07-13T09:14:00.000Z",
    },
  ];
}

/**
 * An in-memory mock {@link ProposalRepository}. Each call owns an isolated copy of
 * the fixtures (so parallel instances/tests never share state). `accept` removes
 * the proposal and returns a synthetic `applied` item; `reject` removes it.
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

  const now = new Date().toISOString();

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
