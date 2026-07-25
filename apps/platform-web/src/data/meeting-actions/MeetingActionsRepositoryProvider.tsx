import { useAuth } from "@clerk/clerk-react";
import { type ReactNode, useContext, useMemo, useRef } from "react";

import { USE_FIXTURES } from "@/fixtures-mode";

import { API_BASE_URL } from "../../env";
import { MeetingActionsRepositoryContext } from "./meeting-actions-repository-context";
import { createNetworkMeetingActionsRepository } from "./network-repository";
import { createMockMeetingActionsRepository } from "./repository";
import type { MeetingActionsRepository } from "./repository";

/** Access the provided meeting-actions repository, or `null` outside a provider. */
// eslint-disable-next-line react-refresh/only-export-components -- the context hook lives beside its provider (mirrors data/proposals)
export function useMeetingActionsRepositoryContext(): MeetingActionsRepository | null {
  return useContext(MeetingActionsRepositoryContext);
}

/**
 * DEV-ONLY: one shared in-memory fixture repository for preview mode, built
 * lazily so it is stable across renders. Guarded by {@link USE_FIXTURES}
 * (compile-time `false` in production), so this and the branch returning it are
 * dead-code-eliminated from the production bundle.
 */
let fixtureRepository: MeetingActionsRepository | undefined;
function getFixtureMeetingActionsRepository(): MeetingActionsRepository {
  fixtureRepository ??= createMockMeetingActionsRepository();
  return fixtureRepository;
}

/**
 * Provides the {@link MeetingActionsRepository} to the app.
 *
 * DEFAULT: the network adapter — so the shipped triage screen reads REAL meeting
 * candidates. The fixture store is reachable only through the dev-only
 * `USE_FIXTURES` branch below, which is stripped from a production build.
 */
export function MeetingActionsRepositoryProvider({
  children,
}: Readonly<{
  children: ReactNode;
}>): ReactNode {
  if (USE_FIXTURES) {
    return (
      <MeetingActionsRepositoryContext.Provider
        value={getFixtureMeetingActionsRepository()}
      >
        {children}
      </MeetingActionsRepositoryContext.Provider>
    );
  }
  return (
    <NetworkMeetingActionsRepositoryProvider>
      {children}
    </NetworkMeetingActionsRepositoryProvider>
  );
}

/**
 * The real, Clerk-backed provider. Built ONCE (`useMemo` with a stable dep) so it
 * never remounts; its per-request token resolver always reads the latest Clerk
 * `getToken` via a ref. Mount INSIDE `ClerkProvider` and ABOVE the router,
 * mirroring `NetworkProposalRepositoryProvider`.
 */
function NetworkMeetingActionsRepositoryProvider({
  children,
}: Readonly<{
  children: ReactNode;
}>): ReactNode {
  const { getToken } = useAuth();

  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const repository = useMemo<MeetingActionsRepository>(
    () =>
      createNetworkMeetingActionsRepository({
        baseUrl: API_BASE_URL,
        getToken: () => getTokenRef.current(),
      }),
    [],
  );

  return (
    <MeetingActionsRepositoryContext.Provider value={repository}>
      {children}
    </MeetingActionsRepositoryContext.Provider>
  );
}
