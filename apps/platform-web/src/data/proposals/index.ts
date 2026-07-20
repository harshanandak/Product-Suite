/**
 * Agent-proposal data seam — public surface (Agent Slice PR3).
 *
 * The review inbox imports everything from here, never from the individual
 * modules. Mirrors `data/work-items`' barrel: the underlying repository adapter
 * (mock vs network) swaps for the real backend without touching callers.
 */
export type { AcceptFieldError, AcceptResult, Proposal } from "./types";

export type { ProposalRepository } from "./repository";
export { createMockProposalRepository } from "./repository";

export type { NetworkProposalRepositoryOptions } from "./network-repository";
export { createNetworkProposalRepository } from "./network-repository";

export { getDefaultProposalRepository, useProposals } from "./use-proposals";
export type {
  UseProposalsOptions,
  UseProposalsResult,
} from "./use-proposals";

export {
  ProposalRepositoryProvider,
  useProposalRepositoryContext,
} from "./ProposalRepositoryProvider";
