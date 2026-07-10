import { useAuth } from "@clerk/clerk-react";
import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useRef,
} from "react";

import { API_BASE_URL } from "../../env";
import { createNetworkWorkItemRepository } from "./network-repository";
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
 * Provides the network {@link WorkItemRepository} to the whole app. Built ONCE
 * (`useMemo` with a stable dep) so it never remounts and its per-request token
 * resolver always reads the latest Clerk `getToken` via a ref — a rotated token
 * is picked up without rebuilding the adapter.
 *
 * Mount INSIDE `ClerkProvider` and ABOVE the router. When signed out `getToken`
 * resolves to `null`; the adapter omits the bearer header and the API answers
 * `401`, which surfaces through the hook's `error` state.
 */
export function RepositoryProvider({
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
