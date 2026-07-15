import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { MemoriesAdapter } from "./adapter";
import { useMemoriesContext } from "./MemoriesProvider";
import { createMockMemoriesAdapter } from "./mock";
import type {
  CreateMemoryInput,
  DeferMemoryInput,
  MemoryDetail,
  MemoryFilters,
  MemoryRow,
  SupersedeMemoryInput,
} from "./types";

/**
 * Shared module singleton so every caller that does not inject an adapter sees
 * the same in-memory store — mirrors `getDefaultProposalRepository()`.
 */
let defaultMemoriesAdapter: MemoriesAdapter | undefined;

/** The process-wide default {@link MemoriesAdapter}, lazily created once. */
export function getDefaultMemoriesAdapter(): MemoriesAdapter {
  defaultMemoriesAdapter ??= createMockMemoriesAdapter();
  return defaultMemoriesAdapter;
}

/** Options for {@link useMemories}. The adapter is injectable for tests. */
export interface UseMemoriesOptions {
  /** Adapter to read/mutate through; defaults to the module singleton. */
  adapter?: MemoriesAdapter;
  /** Server-side list filters (kind/status/topic/scope/q). */
  filters?: MemoryFilters;
}

/** Return shape of {@link useMemories}. */
export interface UseMemoriesResult {
  /** The loaded memories (Decision Log source). */
  memories: MemoryRow[];
  /** True while the initial load is in flight. */
  isLoading: boolean;
  /** Set if the load failed; `refetch` to retry. */
  error: Error | null;
  /** Force a fresh read from the adapter. */
  refetch: () => void;
  /** Fetch one memory + its supersession chain (for the history view). */
  get: (id: string) => Promise<MemoryDetail>;
  /** Capture a new memory; refetches on settle. */
  create: (input: CreateMemoryInput) => Promise<MemoryRow>;
  /** Supersede a memory (mandatory `change_reason`); refetches on settle. */
  supersede: (id: string, input: SupersedeMemoryInput) => Promise<MemoryRow>;
  /** Retract a memory; refetches on settle. */
  retract: (id: string) => Promise<MemoryRow>;
  /** Defer a memory; refetches on settle. */
  defer: (id: string, input: DeferMemoryInput) => Promise<MemoryRow>;
  /** Reactivate a parked (deferred) memory; refetches on settle. */
  reactivate: (id: string) => Promise<MemoryRow>;
  /** True while any create/supersede/retract/defer/reactivate is in flight. */
  isMutating: boolean;
}

/**
 * `useMemories` — React-19 hook over the {@link MemoriesAdapter}, mirroring
 * `useProposals`' plain-state pattern (the app has no react-query infra). Loads
 * the filtered list, exposes mutations that refetch on settle (no optimistic
 * UI), and resolves the injected → context → default adapter in that precedence.
 */
export function useMemories(
  options: UseMemoriesOptions = {},
): UseMemoriesResult {
  const contextAdapter = useMemoriesContext();
  const [adapter] = useState<MemoriesAdapter>(
    () => options.adapter ?? contextAdapter ?? getDefaultMemoriesAdapter(),
  );

  // Serialize the filters so a caller passing a fresh object literal each render
  // does not retrigger the load loop; only a real filter change reloads.
  const filtersKey = JSON.stringify(options.filters ?? {});
  const filters = useMemo<MemoryFilters | undefined>(
    () => options.filters,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the serialized value
    [filtersKey],
  );

  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [mutatingCount, setMutatingCount] = useState(0);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    adapter
      .list(filters)
      .then((loaded) => {
        if (cancelled || !mountedRef.current) return;
        setMemories(loaded);
      })
      .catch((cause: unknown) => {
        if (cancelled || !mountedRef.current) return;
        setError(cause instanceof Error ? cause : new Error(String(cause)));
      })
      .finally(() => {
        if (cancelled || !mountedRef.current) return;
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [adapter, filters, reloadKey]);

  const refetch = useCallback(() => {
    if (mountedRef.current) setReloadKey((key) => key + 1);
  }, []);

  /** Wrap a mutation: count in-flight state + invalidate the list on settle. */
  const runMutation = useCallback(
    async <T>(op: () => Promise<T>): Promise<T> => {
      setMutatingCount((count) => count + 1);
      try {
        return await op();
      } finally {
        if (mountedRef.current) setMutatingCount((count) => count - 1);
        refetch();
      }
    },
    [refetch],
  );

  const get = useCallback((id: string) => adapter.get(id), [adapter]);

  const create = useCallback(
    (input: CreateMemoryInput) => runMutation(() => adapter.create(input)),
    [adapter, runMutation],
  );
  const supersede = useCallback(
    (id: string, input: SupersedeMemoryInput) =>
      runMutation(() => adapter.supersede(id, input)),
    [adapter, runMutation],
  );
  const retract = useCallback(
    (id: string) => runMutation(() => adapter.retract(id)),
    [adapter, runMutation],
  );
  const defer = useCallback(
    (id: string, input: DeferMemoryInput) =>
      runMutation(() => adapter.defer(id, input)),
    [adapter, runMutation],
  );
  const reactivate = useCallback(
    (id: string) => runMutation(() => adapter.reactivate(id)),
    [adapter, runMutation],
  );

  return {
    memories,
    isLoading,
    error,
    refetch,
    get,
    create,
    supersede,
    retract,
    defer,
    reactivate,
    isMutating: mutatingCount > 0,
  };
}
