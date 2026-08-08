import { useAuth } from "@clerk/clerk-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { USE_FIXTURES } from "@/fixtures-mode";

import {
  FIXTURE_SCOPE,
  ServerStateContext,
  type ServerStateScope,
} from "./context";
import { createServerStateQueryClient } from "./query-client";

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
  return (
    <ScopedQueryClientBoundary key={scope.key} queryClient={queryClient} scope={scope}>
      {children}
    </ScopedQueryClientBoundary>
  );
}

function ScopedQueryClientBoundary({
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
