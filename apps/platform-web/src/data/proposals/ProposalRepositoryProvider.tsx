import { useAuth } from "@clerk/clerk-react";
import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useRef,
} from "react";

import { USE_FIXTURES } from "@/fixtures-mode";

import { API_BASE_URL } from "../../env";
import { createNetworkProposalRepository } from "./network-repository";
import { createMockProposalRepository } from "./repository";
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
 * DEV-ONLY: one shared in-memory fixture proposal repository for preview mode,
 * built lazily so its accept/reject mutations persist across renders. Guarded by
 * {@link USE_FIXTURES} (compile-time `false` in production) — this and the branch
 * returning it are dead-code-eliminated from the production bundle.
 */
let fixtureRepository: ProposalRepository | undefined;
function getFixtureProposalRepository(): ProposalRepository {
  fixtureRepository ??= createMockProposalRepository();
  return fixtureRepository;
}

/**
 * Provides the {@link ProposalRepository} to the app.
 *
 * DEFAULT: the network adapter (see {@link NetworkProposalRepositoryProvider}).
 *
 * DEV-ONLY fixtures/preview branch: when {@link USE_FIXTURES} is on, provide the
 * in-memory fixture repository and DO NOT call `useAuth` (no `ClerkProvider` in
 * preview mode). `USE_FIXTURES` folds to `false` in a production build, so this
 * branch is stripped from the shipped bundle — mirrors the work-items
 * `RepositoryProvider`.
 */
export function ProposalRepositoryProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  if (USE_FIXTURES) {
    return (
      <ProposalRepositoryContext.Provider value={getFixtureProposalRepository()}>
        {children}
      </ProposalRepositoryContext.Provider>
    );
  }
  return (
    <NetworkProposalRepositoryProvider>
      {children}
    </NetworkProposalRepositoryProvider>
  );
}

/**
 * The real, Clerk-backed provider. Built ONCE (`useMemo` with a stable dep) so it
 * never remounts; its per-request token resolver always reads the latest Clerk
 * `getToken` via a ref. Mount INSIDE `ClerkProvider` and ABOVE the router,
 * mirroring the work-items `NetworkRepositoryProvider`.
 */
function NetworkProposalRepositoryProvider({
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
