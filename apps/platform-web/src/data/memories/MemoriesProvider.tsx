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
import { createMemoriesAdapter, type MemoriesAdapter } from "./adapter";
import { createMockMemoriesAdapter } from "./mock";

/**
 * Holds the process-wide network {@link MemoriesAdapter} once provided. `null`
 * when no provider is mounted (tests, stories) — callers then fall back to the
 * in-memory mock via `getDefaultMemoriesAdapter()`.
 */
const MemoriesContext = createContext<MemoriesAdapter | null>(null);

/** Access the provided memories adapter, or `null` outside a provider. */
// eslint-disable-next-line react-refresh/only-export-components -- the context hook lives beside its provider (mirrors data/proposals)
export function useMemoriesContext(): MemoriesAdapter | null {
  return useContext(MemoriesContext);
}

/**
 * DEV-ONLY: one shared in-memory fixture adapter for preview mode, built lazily
 * so its create/supersede mutations persist across renders. Guarded by
 * {@link USE_FIXTURES} (compile-time `false` in production) — this and the branch
 * returning it are dead-code-eliminated from the production bundle.
 */
let fixtureAdapter: MemoriesAdapter | undefined;
function getFixtureMemoriesAdapter(): MemoriesAdapter {
  fixtureAdapter ??= createMockMemoriesAdapter();
  return fixtureAdapter;
}

/**
 * Provides the {@link MemoriesAdapter} to the app.
 *
 * DEFAULT: the network adapter (see {@link NetworkMemoriesProvider}).
 *
 * DEV-ONLY fixtures/preview branch: when {@link USE_FIXTURES} is on, provide the
 * in-memory fixture adapter and DO NOT call `useAuth` (no `ClerkProvider` in
 * preview mode). `USE_FIXTURES` folds to `false` in a production build, so this
 * branch is stripped from the shipped bundle — mirrors the proposals provider.
 */
export function MemoriesProvider({
  children,
}: Readonly<{
  children: ReactNode;
}>): ReactNode {
  if (USE_FIXTURES) {
    return (
      <MemoriesContext.Provider value={getFixtureMemoriesAdapter()}>
        {children}
      </MemoriesContext.Provider>
    );
  }
  return <NetworkMemoriesProvider>{children}</NetworkMemoriesProvider>;
}

/**
 * The real, Clerk-backed provider. Built ONCE (`useMemo` with a stable dep) so it
 * never remounts; its per-request token AND active-org resolvers always read the
 * latest Clerk values via refs. The org id is sent as `?org_id` so a multi-org
 * user only sees/writes the current org's memories. Mount INSIDE `ClerkProvider`
 * and ABOVE the router, mirroring the proposals `NetworkProposalRepositoryProvider`.
 */
function NetworkMemoriesProvider({
  children,
}: Readonly<{
  children: ReactNode;
}>): ReactNode {
  const { getToken, orgId } = useAuth();

  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const orgIdRef = useRef(orgId);
  orgIdRef.current = orgId;

  const adapter = useMemo<MemoriesAdapter>(
    () =>
      createMemoriesAdapter({
        apiBase: API_BASE_URL,
        getToken: () => getTokenRef.current(),
        getOrgId: () => orgIdRef.current ?? null,
      }),
    [],
  );

  return (
    <MemoriesContext.Provider value={adapter}>
      {children}
    </MemoriesContext.Provider>
  );
}
