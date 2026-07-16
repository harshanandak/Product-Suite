import { useEffect, useMemo, useRef, useState } from "react";

import type { MemoryImpactAdapter } from "./adapter";
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

/**
 * `useMemoryImpact` — React-19 hook over the {@link MemoryImpactAdapter},
 * mirroring `useMemories`' plain-state load loop (the app has no react-query
 * infra). Read-only: it loads the impact for `windowDays` once and resolves the
 * injected → context → default adapter in that precedence.
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
  const windowDays = options.windowDays;

  const [impact, setImpact] = useState<MemoryImpact | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    adapter
      .get(windowDays)
      .then((loaded) => {
        if (cancelled || !mountedRef.current) return;
        setImpact(loaded);
      })
      .catch((cause: unknown) => {
        if (cancelled || !mountedRef.current) return;
        setError(cause instanceof Error ? cause : new Error(String(cause)));
      })
      .finally(() => {
        if (cancelled || !mountedRef.current) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [adapter, windowDays]);

  return { impact, loading, error };
}
