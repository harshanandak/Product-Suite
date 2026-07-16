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
import {
  createMemoryImpactAdapter,
  type MemoryImpactAdapter,
} from "./adapter";
import { createMockMemoryImpactAdapter } from "./mock";

/**
 * Holds the process-wide network {@link MemoryImpactAdapter} once provided.
 * `null` when no provider is mounted (tests, stories) — callers then fall back
 * to the in-memory mock via `getDefaultMemoryImpactAdapter()`.
 */
const MemoryImpactContext = createContext<MemoryImpactAdapter | null>(null);

/** Access the provided memory-impact adapter, or `null` outside a provider. */
// eslint-disable-next-line react-refresh/only-export-components -- the context hook lives beside its provider (mirrors data/memories)
export function useMemoryImpactContext(): MemoryImpactAdapter | null {
  return useContext(MemoryImpactContext);
}

/**
 * DEV-ONLY: one shared in-memory mock adapter for preview mode. Guarded by
 * {@link USE_FIXTURES} (compile-time `false` in production) — this and the branch
 * returning it are dead-code-eliminated from the production bundle.
 */
let fixtureAdapter: MemoryImpactAdapter | undefined;
function getFixtureMemoryImpactAdapter(): MemoryImpactAdapter {
  fixtureAdapter ??= createMockMemoryImpactAdapter();
  return fixtureAdapter;
}

/**
 * Provides the {@link MemoryImpactAdapter} to the app.
 *
 * DEFAULT: the network adapter (see {@link NetworkMemoryImpactProvider}).
 *
 * DEV-ONLY fixtures/preview branch: when {@link USE_FIXTURES} is on, provide the
 * in-memory mock and DO NOT call `useAuth` (no `ClerkProvider` in preview mode).
 * `USE_FIXTURES` folds to `false` in a production build, so this branch is
 * stripped from the shipped bundle — mirrors the memories provider.
 */
export function MemoryImpactProvider({
  children,
}: Readonly<{
  children: ReactNode;
}>): ReactNode {
  if (USE_FIXTURES) {
    return (
      <MemoryImpactContext.Provider value={getFixtureMemoryImpactAdapter()}>
        {children}
      </MemoryImpactContext.Provider>
    );
  }
  return <NetworkMemoryImpactProvider>{children}</NetworkMemoryImpactProvider>;
}

/**
 * The real, Clerk-backed provider. Built ONCE (`useMemo` with a stable dep) so it
 * never remounts; its per-request token AND active-org resolvers always read the
 * latest Clerk values via refs. Mount INSIDE `ClerkProvider` and ABOVE the
 * router, mirroring `NetworkMemoriesProvider`.
 */
function NetworkMemoryImpactProvider({
  children,
}: Readonly<{
  children: ReactNode;
}>): ReactNode {
  const { getToken, orgId } = useAuth();

  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const orgIdRef = useRef(orgId);
  orgIdRef.current = orgId;

  const adapter = useMemo<MemoryImpactAdapter>(
    () =>
      createMemoryImpactAdapter({
        apiBase: API_BASE_URL,
        getToken: () => getTokenRef.current(),
        getOrgId: () => orgIdRef.current ?? null,
      }),
    [],
  );

  return (
    <MemoryImpactContext.Provider value={adapter}>
      {children}
    </MemoryImpactContext.Provider>
  );
}
