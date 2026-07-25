import { useCallback, useEffect, useRef, useState } from "react";

import { useMeetingActionsRepositoryContext } from "./MeetingActionsRepositoryProvider";
import {
  createMockMeetingActionsRepository,
  type MeetingActionsRepository,
} from "./repository";
import type { MeetingActionCandidate, MeetingSyncSummary } from "./types";

/**
 * Shared module singleton so every caller that does not inject a repository sees
 * the same in-memory store — mirrors `getDefaultProposalRepository()`.
 */
let defaultMeetingActionsRepository: MeetingActionsRepository | undefined;

/** The process-wide default {@link MeetingActionsRepository}, lazily created once. */
export function getDefaultMeetingActionsRepository(): MeetingActionsRepository {
  defaultMeetingActionsRepository ??= createMockMeetingActionsRepository();
  return defaultMeetingActionsRepository;
}

/** Options for {@link useMeetingActions}. The repo is injectable for tests. */
export interface UseMeetingActionsOptions {
  /** Repository to read through; defaults to context, then the module singleton. */
  repository?: MeetingActionsRepository;
}

/** Return shape of {@link useMeetingActions}. */
export interface UseMeetingActionsResult {
  /** This org's promoted meeting action items with their promotion state. */
  candidates: MeetingActionCandidate[];
  /**
   * True ONLY while the very first load is in flight — the full-skeleton signal.
   * A later `refetch` raises {@link isRefetching} instead, so the list stays on
   * screen while it reloads (the InboxScreen lesson: don't flash a skeleton over
   * data the user is already reading).
   */
  isLoading: boolean;
  /** True while a background reload (a `refetch` after the first load) is in flight. */
  isRefetching: boolean;
  /** Set if the load failed; `refetch` to retry. */
  error: Error | null;
  /**
   * Run the ingest, then refetch so newly-created proposals appear. Resolves to
   * the summary on success and `null` on failure (the failure lands in
   * {@link syncError}) — the caller is a button handler, not an error boundary.
   */
  sync: () => Promise<MeetingSyncSummary | null>;
  /** True while an ingest is in flight — the signal that disables the button. */
  isSyncing: boolean;
  /**
   * Set if the LAST sync failed, cleared when one succeeds. Separate from
   * {@link error} so a failed write never replaces the list the user is reading
   * with an error screen.
   */
  syncError: Error | null;
  /** Force a fresh read from the repository. */
  refetch: () => void;
}

/**
 * `useMeetingActions` — React hook over the {@link MeetingActionsRepository},
 * mirroring `useProposals`' plain-state pattern (the app has no react-query
 * infra). Resolves the injected → context → mock repository in that precedence,
 * exactly like the proposals hook.
 */
export function useMeetingActions(
  options: UseMeetingActionsOptions = {},
): UseMeetingActionsResult {
  const contextRepository = useMeetingActionsRepositoryContext();
  const [repository] = useState<MeetingActionsRepository>(
    () =>
      options.repository ?? contextRepository ?? getDefaultMeetingActionsRepository(),
  );

  const [candidates, setCandidates] = useState<MeetingActionCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefetching, setIsRefetching] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<Error | null>(null);

  // Flips true after the FIRST successful load and never back. A failed initial
  // load leaves it false so a retry still shows the skeleton, not a bare reload.
  const hasLoadedRef = useRef(false);

  // Guards against setState after unmount across async loads.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (hasLoadedRef.current) setIsRefetching(true);
    else setIsLoading(true);
    setError(null);

    repository
      .list()
      .then((loaded) => {
        if (cancelled || !mountedRef.current) return;
        setCandidates(loaded);
        hasLoadedRef.current = true;
      })
      .catch((cause: unknown) => {
        if (cancelled || !mountedRef.current) return;
        setError(cause instanceof Error ? cause : new Error(String(cause)));
      })
      .finally(() => {
        if (cancelled || !mountedRef.current) return;
        setIsLoading(false);
        setIsRefetching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [repository, reloadKey]);

  const refetch = useCallback(() => {
    if (mountedRef.current) setReloadKey((key) => key + 1);
  }, []);

  // Guards against a second ingest from a double-click: the ref flips
  // synchronously, before React has re-rendered the disabled button.
  const syncingRef = useRef(false);

  const sync = useCallback(async (): Promise<MeetingSyncSummary | null> => {
    if (syncingRef.current) return null;
    syncingRef.current = true;
    setIsSyncing(true);
    try {
      const summary = await repository.sync();
      if (mountedRef.current) {
        // Only a SUCCESSFUL ingest clears the error — a stale banner above a
        // successful sync would be a lie.
        setSyncError(null);
        // The ingest created proposals; re-read so they show as pending.
        setReloadKey((key) => key + 1);
      }
      return summary;
    } catch (cause: unknown) {
      // A failed ingest wrote nothing, so we do NOT refetch — the list the user
      // is reading stays exactly as it was, with the failure shown beside it.
      if (mountedRef.current) {
        setSyncError(cause instanceof Error ? cause : new Error(String(cause)));
      }
      return null;
    } finally {
      syncingRef.current = false;
      if (mountedRef.current) setIsSyncing(false);
    }
  }, [repository]);

  return {
    candidates,
    isLoading,
    isRefetching,
    error,
    sync,
    isSyncing,
    syncError,
    refetch,
  };
}
