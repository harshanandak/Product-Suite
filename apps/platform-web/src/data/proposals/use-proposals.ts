import { useCallback, useEffect, useRef, useState } from "react";

import { useProposalRepositoryContext } from "./ProposalRepositoryProvider";
import {
  createMockProposalRepository,
  type ProposalRepository,
} from "./repository";
import type { AcceptResult, Proposal } from "./types";

/**
 * Shared module singleton so every caller that does not inject a repository sees
 * the same in-memory store — mirrors `getDefaultRepository()` in data/work-items.
 */
let defaultProposalRepository: ProposalRepository | undefined;

/** The process-wide default {@link ProposalRepository}, lazily created once. */
export function getDefaultProposalRepository(): ProposalRepository {
  defaultProposalRepository ??= createMockProposalRepository();
  return defaultProposalRepository;
}

/** Options for {@link useProposals}. The repo is injectable for tests. */
export interface UseProposalsOptions {
  /** Repository to read/dispose through; defaults to the module singleton. */
  repository?: ProposalRepository;
}

/** Return shape of {@link useProposals}. */
export interface UseProposalsResult {
  /** The pending proposals (the inbox list). */
  proposals: Proposal[];
  /** True while the initial load is in flight. */
  isLoading: boolean;
  /** Set if the initial load failed; `refetch` to retry. */
  error: Error | null;
  /**
   * Accept a proposal. Returns the {@link AcceptResult} so the caller can message
   * the `applied`/`stale`/`invalid` cases, and ALWAYS refetches the list on settle
   * (invalidate-on-settle — an accepted or newly-stale proposal leaves the list).
   * No optimistic UI: the list only reflects a change once the server confirms it.
   */
  accept: (id: string) => Promise<AcceptResult>;
  /** Reject a proposal (optional reason); refetches the list on settle. */
  reject: (id: string, reason?: string) => Promise<void>;
  /** True while any accept/reject mutation is in flight. */
  isMutating: boolean;
  /** Force a fresh read from the repository. */
  refetch: () => void;
}

/**
 * `useProposals` — React-19 hook over the {@link ProposalRepository}, mirroring
 * `useWorkItems`' plain-state pattern (the app has no react-query infra). Loads
 * the pending list, exposes accept/reject mutations that refetch the list on
 * settle (no optimistic UI), and resolves the injected → context → mock repo in
 * that precedence exactly like the work-items hook.
 */
export function useProposals(
  options: UseProposalsOptions = {},
): UseProposalsResult {
  const contextRepository = useProposalRepositoryContext();
  const [repository] = useState<ProposalRepository>(
    () => options.repository ?? contextRepository ?? getDefaultProposalRepository(),
  );

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [mutatingCount, setMutatingCount] = useState(0);

  // Guards against setState after unmount across async loads/mutations.
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

    repository
      .list()
      .then((loaded) => {
        if (cancelled || !mountedRef.current) return;
        setProposals(loaded);
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
  }, [repository, reloadKey]);

  const refetch = useCallback(() => {
    if (mountedRef.current) setReloadKey((key) => key + 1);
  }, []);

  const accept = useCallback(
    async (id: string): Promise<AcceptResult> => {
      setMutatingCount((count) => count + 1);
      try {
        return await repository.accept(id);
      } finally {
        if (mountedRef.current) setMutatingCount((count) => count - 1);
        // Invalidate on settle — applied/stale both change the pending set.
        refetch();
      }
    },
    [repository, refetch],
  );

  const reject = useCallback(
    async (id: string, reason?: string): Promise<void> => {
      setMutatingCount((count) => count + 1);
      try {
        await repository.reject(id, reason);
      } finally {
        if (mountedRef.current) setMutatingCount((count) => count - 1);
        refetch();
      }
    },
    [repository, refetch],
  );

  return {
    proposals,
    isLoading,
    error,
    accept,
    reject,
    isMutating: mutatingCount > 0,
    refetch,
  };
}
