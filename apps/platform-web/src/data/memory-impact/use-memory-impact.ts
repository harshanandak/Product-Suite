import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { getAdapterIdentity, useServerState } from "@/data/server-state";

import {
  DEFAULT_WINDOW_DAYS,
  type MemoryImpactAdapter,
} from "./adapter";
import { useMemoryImpactContext } from "./MemoryImpactProvider";
import { createMockMemoryImpactAdapter } from "./mock";
import type { MemoryImpact } from "./types";

/**
 * Shared module singleton so every caller that does not inject an adapter sees
 * the same source — mirrors `getDefaultMemoriesAdapter()`. Defaults to the mock
 * (honest `insufficient`) so the card is safe with no provider mounted.
 */
let defaultMemoryImpactAdapter: MemoryImpactAdapter | undefined;

/** The process-wide default {@link MemoryImpactAdapter}, lazily created once. */
export function getDefaultMemoryImpactAdapter(): MemoryImpactAdapter {
  defaultMemoryImpactAdapter ??= createMockMemoryImpactAdapter();
  return defaultMemoryImpactAdapter;
}

/** Options for {@link useMemoryImpact}. The adapter is injectable for tests. */
export interface UseMemoryImpactOptions {
  /** Adapter to read through; defaults to the context → module singleton. */
  adapter?: MemoryImpactAdapter;
  /** Rolling window in days (default 30). */
  windowDays?: number;
}

/** Return shape of {@link useMemoryImpact} — the card's `{ impact, loading, error }`. */
export interface UseMemoryImpactResult {
  /** The measured impact, or `null` until the first load settles / on error. */
  impact: MemoryImpact | null;
  /** True while the load is in flight. */
  loading: boolean;
  /** Set if the load failed; the card then renders nothing (honest silence). */
  error: Error | null;
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * `useMemoryImpact` — Query-backed hook over the {@link MemoryImpactAdapter}.
 * Read-only: it orchestrates impact loads through the authorization-scoped
 * server-state QueryClient, keyed by scope, window, and adapter identity, while
 * resolving the injected → context → default adapter in that precedence.
 */
export function useMemoryImpact(
  options: UseMemoryImpactOptions = {},
): UseMemoryImpactResult {
  const contextAdapter = useMemoryImpactContext();
  // Resolve the adapter REACTIVELY (injected → context → module default). Freezing it
  // on first render (a one-time `useState` initializer) would strand the card on the
  // old source after an auth/org switch swaps the context adapter; `useMemo` re-resolves
  // when an input actually changes, and stays referentially stable when nothing does
  // (the default singleton is stable), so the load loop below does not re-fire needlessly.
  const adapter = useMemo<MemoryImpactAdapter>(
    () => options.adapter ?? contextAdapter ?? getDefaultMemoryImpactAdapter(),
    [options.adapter, contextAdapter],
  );
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const adapterIdentity = getAdapterIdentity(adapter);
  const { queryClient, scope } = useServerState();
  const query = useQuery<MemoryImpact, Error>(
    {
      queryKey: ["memory-impact", scope.key, windowDays, adapterIdentity],
      queryFn: async ({ signal }) => {
        try {
          return await adapter.get(windowDays, signal);
        } catch (error) {
          throw normalizeError(error);
        }
      },
    },
    queryClient,
  );

  return {
    impact: query.data ?? null,
    loading: query.isPending,
    error: query.error,
  };
}
