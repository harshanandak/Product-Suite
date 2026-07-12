import { useCallback, useEffect, useRef, useState } from "react";

import { CHECK_STATUS_ORDER } from "@product-suite/contracts";

import type { CreateCheckInput, WorkItemRepository } from "./repository";
import type { Check } from "./types";

/** Options for {@link useItemChecks}. The repo is injectable for tests. */
export interface UseItemChecksOptions {
  /** Repository to read/write through (the caller's stabilized instance). */
  repository: WorkItemRepository;
  /**
   * The work item whose checks to load. `null` (no item open) short-circuits to
   * an empty, non-loading result — the fetch-on-open pattern the detail page and
   * the board editors share, so no surface ever reads ALL checks just to show one
   * item's list.
   */
  workItemId: string | null;
}

/** The editable check fields a caller may supply to {@link UseItemChecksResult.createCheck}. */
export type CreateItemCheckInput = Omit<CreateCheckInput, "work_item_id">;

/** Return shape of {@link useItemChecks}. */
export interface UseItemChecksResult {
  /** This item's checks; empty when `workItemId` is `null` or before the load settles. */
  checks: Check[];
  /** True while the per-item load is in flight. */
  loading: boolean;
  /** Set if the per-item load failed; `refetch` to retry. */
  error: Error | null;
  /**
   * Ids of checks with a {@link toggleStatus} currently IN FLIGHT. Added
   * synchronously when the toggle starts and removed once the repository settles
   * — on BOTH success and rollback — so the UI can paint a transient pending cue
   * (and disable the control) without owning any timing.
   */
  pendingCheckIds: ReadonlySet<string>;
  /**
   * Create a check under the current `workItemId` and append it. Pessimistic
   * (await-then-append) like the work-item `create`: the repository owns the id,
   * so there is nothing optimistic to revert — a rejection propagates with state
   * untouched. Rejects if no item is open (`workItemId` is `null`).
   */
  createCheck: (input?: CreateItemCheckInput) => Promise<Check>;
  /**
   * Advance a check one step around the status triad — the one-tap lifecycle
   * gesture. Optimistic: the new status paints immediately and is rolled back if
   * the repository rejects (the rejection is re-thrown so callers can surface it).
   */
  toggleStatus: (id: string) => Promise<Check>;
  /** Force a fresh per-item read from the repository. */
  refetch: () => void;
}

/**
 * `useItemChecks` — per-item check state + the two check-write gestures (move ②).
 *
 * Loads exactly ONE work item's checks (via `repository.getChecks`) and re-loads
 * when `workItemId` changes — the fetch-on-open path that replaces the board's
 * former fetch-ALL-checks read (PR3). Layers the same optimistic/rollback +
 * pending-id discipline `useWorkItems` uses for work-item edits onto checks:
 * {@link UseItemChecksResult.toggleStatus} is optimistic with rollback, and
 * {@link UseItemChecksResult.createCheck} is a pessimistic append (the repo owns
 * the id). The list-level `useWorkItems.listChecks` read is a SEPARATE concern
 * (it derives board-wide health/counts) and is intentionally untouched.
 */
export function useItemChecks({
  repository,
  workItemId,
}: UseItemChecksOptions): UseItemChecksResult {
  const [checks, setChecks] = useState<Check[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [pendingCheckIds, setPendingCheckIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  // Mirror the latest checks so `toggleStatus` can capture the pre-edit record
  // SYNCHRONOUSLY (React defers the functional setState updater, so reading the
  // previous value inside it would race the rollback).
  const checksRef = useRef<Check[]>([]);
  checksRef.current = checks;

  // Mirror the CURRENT open item so an in-flight write (create/toggle) can tell,
  // AFTER its await, whether the board still shows the same item it started
  // under. Without this a check resolved after the user switched items would land
  // in the newly-loaded item's list (a stale cross-item leak).
  const workItemIdRef = useRef<string | null>(workItemId);
  workItemIdRef.current = workItemId;

  // Guards against setState after unmount across the async load/mutations.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    // No item open → an empty, settled result; never fetch ALL checks.
    if (workItemId === null) {
      setChecks([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    repository
      .getChecks(workItemId)
      .then((loaded) => {
        if (cancelled || !mountedRef.current) return;
        setChecks(loaded);
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
  }, [repository, workItemId, reloadKey]);

  const refetch = useCallback(() => {
    setReloadKey((key) => key + 1);
  }, []);

  const createCheck = useCallback(
    async (input: CreateItemCheckInput = {}): Promise<Check> => {
      if (workItemId === null) {
        throw new Error("Cannot create a check without an open work item.");
      }
      // Capture the item this check is created under; after the await we only
      // append if the open item is STILL that one — otherwise a check created for
      // a since-closed item would leak into whatever item is now open.
      const requestedItemId = workItemId;
      // Pessimistic append: the repo owns the id and may reject (unknown parent),
      // so only show the check once the store confirms it.
      const created = await repository.createCheck({
        ...input,
        work_item_id: workItemId,
      });
      if (mountedRef.current && workItemIdRef.current === requestedItemId) {
        setChecks((current) => [...current, created]);
      }
      return created;
    },
    [repository, workItemId],
  );

  const toggleStatus = useCallback(
    async (id: string): Promise<Check> => {
      // The item this toggle targets; after the await we only apply the result
      // (or its rollback) if the open item is STILL that one — the same
      // stale-guard `createCheck` uses so a settled write never touches another
      // item's list.
      const requestedItemId = workItemIdRef.current;
      // Capture the pre-edit record synchronously (before the deferred setState)
      // so a rollback restores the exact check.
      const previous = checksRef.current.find((check) => check.id === id);
      if (previous) {
        const position = CHECK_STATUS_ORDER.indexOf(previous.status);
        const nextStatus =
          CHECK_STATUS_ORDER[(position + 1) % CHECK_STATUS_ORDER.length];
        setChecks((current) =>
          current.map((check) =>
            check.id === id ? { ...check, status: nextStatus } : check,
          ),
        );
      }
      // Mark the check as saving (additive — does not touch the edit semantics).
      setPendingCheckIds((current) => {
        const next = new Set(current);
        next.add(id);
        return next;
      });

      try {
        const saved = await repository.toggleStatus(id);
        if (mountedRef.current && workItemIdRef.current === requestedItemId) {
          setChecks((current) =>
            current.map((check) => (check.id === id ? saved : check)),
          );
        }
        return saved;
      } catch (cause) {
        // Roll back the optimistic advance — but only if we are still on the item
        // the toggle started under (else its list is already gone).
        if (
          mountedRef.current &&
          workItemIdRef.current === requestedItemId &&
          previous
        ) {
          const restored = previous;
          setChecks((current) =>
            current.map((check) => (check.id === id ? restored : check)),
          );
        }
        throw cause;
      } finally {
        // Clear the saving cue on BOTH settle paths (success + rollback) so a
        // failed toggle never leaves the check stuck looking busy.
        if (mountedRef.current) {
          setPendingCheckIds((current) => {
            if (!current.has(id)) return current;
            const next = new Set(current);
            next.delete(id);
            return next;
          });
        }
      }
    },
    [repository],
  );

  return {
    checks,
    loading,
    error,
    pendingCheckIds,
    createCheck,
    toggleStatus,
    refetch,
  };
}
