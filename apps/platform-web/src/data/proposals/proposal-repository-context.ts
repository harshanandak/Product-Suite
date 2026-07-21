import { createContext } from "react";

import type { ProposalRepository } from "./repository";

/**
 * Holds the process-wide {@link ProposalRepository} once a provider supplies it.
 * `null` when no provider is mounted (tests, stories, the screenshot harness) —
 * callers then fall back to the in-memory mock via `getDefaultProposalRepository()`.
 *
 * Lives in its own component-free module so it can be imported both by the
 * provider/hook AND by test/harness code that needs to inject a repository, without
 * pulling a React component into those import graphs (keeps Fast Refresh boundaries
 * clean and gives the harness a legitimate DI seam).
 */
export const ProposalRepositoryContext =
  createContext<ProposalRepository | null>(null);
