import { type QueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";

import { createServerStateQueryClient } from "./query-client";

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

export const FIXTURE_SCOPE: ServerStateScope = {
  key: "fixtures",
  mode: "fixtures",
  principalId: "fixture-user",
  orgId: "fixture-org",
};

const fallbackValue: ServerStateValue = {
  queryClient: createServerStateQueryClient(),
  scope: FIXTURE_SCOPE,
};

export const ServerStateContext = createContext<ServerStateValue | null>(null);

/** Read the active boundary, with a deterministic fixture fallback for isolated tests. */
export function useServerState(): ServerStateValue {
  return useContext(ServerStateContext) ?? fallbackValue;
}
