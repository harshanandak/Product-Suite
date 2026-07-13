import { useAuth } from "@clerk/clerk-react";
import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useRef,
} from "react";

import { API_BASE_URL } from "../../env";
import { createNetworkProposalRepository } from "./network-repository";
import type { ProposalRepository } from "./repository";

/**
 * Holds the process-wide network {@link ProposalRepository} once provided. `null`
 * when no provider is mounted (tests, stories) — callers then fall back to the
 * in-memory mock via `getDefaultProposalRepository()`.
 */
const ProposalRepositoryContext = createContext<ProposalRepository | null>(null);

/** Access the provided proposal repository, or `null` outside a provider. */
// eslint-disable-next-line react-refresh/only-export-components -- the context hook lives beside its provider (mirrors data/work-items)
export function useProposalRepositoryContext(): ProposalRepository | null {
  return useContext(ProposalRepositoryContext);
}

/**
 * Provides the network {@link ProposalRepository} to the app. Built ONCE (`useMemo`
 * with a stable dep) so it never remounts; its per-request token resolver always
 * reads the latest Clerk `getToken` via a ref. Mount INSIDE `ClerkProvider` and
 * ABOVE the router, mirroring the work-items `RepositoryProvider`.
 */
export function ProposalRepositoryProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const { getToken } = useAuth();

  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const repository = useMemo<ProposalRepository>(
    () =>
      createNetworkProposalRepository({
        baseUrl: API_BASE_URL,
        getToken: () => getTokenRef.current(),
      }),
    [],
  );

  return (
    <ProposalRepositoryContext.Provider value={repository}>
      {children}
    </ProposalRepositoryContext.Provider>
  );
}
