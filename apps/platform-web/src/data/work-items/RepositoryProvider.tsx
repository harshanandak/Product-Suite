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
import { createNetworkWorkItemRepository } from "./network-repository";
import { createMockWorkItemRepository } from "./repository";
import type { WorkItemRepository } from "./repository";

/**
 * Holds the process-wide network {@link WorkItemRepository} once it is provided.
 * `null` when no {@link RepositoryProvider} is mounted (tests, stories) — callers
 * then fall back to the in-memory mock via `getDefaultRepository()`.
 */
const RepositoryContext = createContext<WorkItemRepository | null>(null);

/** Access the provided network repository, or `null` outside a provider. */
// eslint-disable-next-line react-refresh/only-export-components -- the context hook lives beside its provider (see plan §3)
export function useRepositoryContext(): WorkItemRepository | null {
  return useContext(RepositoryContext);
}

/**
 * DEV-ONLY: one shared in-memory fixture repository for preview mode, built
 * lazily so its mutations persist across renders. Guarded by {@link USE_FIXTURES},
 * which is compile-time `false` in production — this and the branch that returns
 * it are dead-code-eliminated from the production bundle (see `fixtures-mode.ts`).
 */
let fixtureRepository: WorkItemRepository | undefined;
function getFixtureRepository(): WorkItemRepository {
  fixtureRepository ??= createMockWorkItemRepository();
  return fixtureRepository;
}

/**
 * Provides the {@link WorkItemRepository} to the whole app.
 *
 * DEFAULT (production + normal dev): the network adapter, built inside
 * `ClerkProvider` so it can read the session token — see
 * {@link NetworkRepositoryProvider}.
 *
 * DEV-ONLY fixtures/preview branch: when {@link USE_FIXTURES} is on, provide the
 * in-memory fixture repository instead and DO NOT call `useAuth` (there is no
 * `ClerkProvider` in preview mode). `USE_FIXTURES` folds to `false` in a
 * production build, so this whole branch is stripped from the shipped bundle and
 * the app can only ever take the network path there.
 */
export function RepositoryProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  if (USE_FIXTURES) {
    return (
      <RepositoryContext.Provider value={getFixtureRepository()}>
        {children}
      </RepositoryContext.Provider>
    );
  }
  return <NetworkRepositoryProvider>{children}</NetworkRepositoryProvider>;
}

/**
 * The real, Clerk-backed provider. Built ONCE (`useMemo` with a stable dep) so it
 * never remounts and its per-request token resolver always reads the latest Clerk
 * `getToken` via a ref — a rotated token is picked up without rebuilding the
 * adapter.
 *
 * Mount INSIDE `ClerkProvider` and ABOVE the router. When signed out `getToken`
 * resolves to `null`; the adapter omits the bearer header and the API answers
 * `401`, which surfaces through the hook's `error` state.
 */
function NetworkRepositoryProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const { getToken } = useAuth();

  // Keep the resolver current without changing the memo's identity: the adapter
  // is built once, but always calls the freshest getToken.
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const repository = useMemo<WorkItemRepository>(
    () =>
      createNetworkWorkItemRepository({
        baseUrl: API_BASE_URL,
        getToken: () => getTokenRef.current(),
      }),
    [],
  );

  return (
    <RepositoryContext.Provider value={repository}>
      {children}
    </RepositoryContext.Provider>
  );
}
