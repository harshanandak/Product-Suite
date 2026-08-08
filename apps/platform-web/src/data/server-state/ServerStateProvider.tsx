import { useAuth } from "@clerk/clerk-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { USE_FIXTURES } from "@/fixtures-mode";

const STALE_TIME_MS = 30_000;
const GC_TIME_MS = 5 * 60_000;

export interface ServerStateScope {
  key: string;
  mode: "authenticated" | "fixtures";
  principalId: string;
  orgId: string;
}

export interface ServerStateValue {
  queryClient: QueryClient;
  scope: ServerStateScope;
}

const FIXTURE_SCOPE: ServerStateScope = {
  key: "fixtures",
  mode: "fixtures",
  principalId: "fixture-user",
  orgId: "fixture-org",
};

const adapterIdentities = new WeakMap<object, number>();
let nextAdapterIdentity = 1;

/** Return a stable primitive id without serializing an adapter into a query key. */
export function getAdapterIdentity(adapter: object): number {
  const existing = adapterIdentities.get(adapter);
  if (existing !== undefined) return existing;
  const identity = nextAdapterIdentity;
  nextAdapterIdentity += 1;
  adapterIdentities.set(adapter, identity);
  return identity;
}

function structuralName(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("name" in error)) {
    return undefined;
  }
  return typeof error.name === "string" ? error.name : undefined;
}

function structuralStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return undefined;
  }
  return typeof error.status === "number" ? error.status : undefined;
}

/** Bounded, adapter-agnostic retry classification for read-only server state. */
export function shouldRetryServerStateQuery(
  failureCount: number,
  error: unknown,
): boolean {
  if (failureCount >= 1) return false;

  const name = structuralName(error);
  if (name === "AbortError") return false;

  const status = structuralStatus(error);
  if (status !== undefined) return status >= 500 && status <= 599;

  return name === "TypeError" || name === "TimeoutError";
}

export function createServerStateQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: GC_TIME_MS,
        refetchOnWindowFocus: true,
        retry: shouldRetryServerStateQuery,
        staleTime: STALE_TIME_MS,
      },
    },
  });
}

const fallbackValue: ServerStateValue = {
  queryClient: createServerStateQueryClient(),
  scope: FIXTURE_SCOPE,
};

const ServerStateContext = createContext<ServerStateValue | null>(null);

/** Read the active boundary, with a deterministic fixture fallback for isolated tests. */
export function useServerState(): ServerStateValue {
  return useContext(ServerStateContext) ?? fallbackValue;
}

export function ServerStateProvider({
  children,
}: Readonly<{ children: ReactNode }>): ReactNode {
  if (USE_FIXTURES) {
    return <FixtureServerStateProvider>{children}</FixtureServerStateProvider>;
  }
  return (
    <AuthenticatedServerStateProvider>{children}</AuthenticatedServerStateProvider>
  );
}

function FixtureServerStateProvider({
  children,
}: Readonly<{ children: ReactNode }>): ReactNode {
  const [queryClient] = useState(createServerStateQueryClient);
  return (
    <ServerStateBoundary queryClient={queryClient} scope={FIXTURE_SCOPE}>
      {children}
    </ServerStateBoundary>
  );
}

function AuthenticatedServerStateProvider({
  children,
}: Readonly<{ children: ReactNode }>): ReactNode {
  const { orgId, userId } = useAuth();
  const principalId = userId ?? "signed-out";
  const activeOrgId = orgId ?? "no-org";
  const scopeKey = `authenticated:${principalId}:${activeOrgId}`;
  const scope = useMemo<ServerStateScope>(
    () => ({
      key: scopeKey,
      mode: "authenticated",
      principalId,
      orgId: activeOrgId,
    }),
    [activeOrgId, principalId, scopeKey],
  );
  const queryClient = useMemo(createServerStateQueryClient, [scopeKey]);

  return (
    <ServerStateBoundary queryClient={queryClient} scope={scope}>
      {children}
    </ServerStateBoundary>
  );
}

function ServerStateBoundary({
  children,
  queryClient,
  scope,
}: Readonly<{
  children: ReactNode;
  queryClient: QueryClient;
  scope: ServerStateScope;
}>): ReactNode {
  useEffect(() => () => queryClient.clear(), [queryClient]);
  const value = useMemo(() => ({ queryClient, scope }), [queryClient, scope]);

  return (
    <ServerStateContext.Provider value={value}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ServerStateContext.Provider>
  );
}
