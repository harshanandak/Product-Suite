import { useCallback, useEffect, useRef, useState } from "react";

import { TASK_STATUS_ORDER } from "@product-suite/contracts";

import type { CreateTaskInput, WorkItemRepository } from "./repository";
import type { Task } from "./types";

/** Options for {@link useItemTasks}. The repo is injectable for tests. */
export interface UseItemTasksOptions {
  /** Repository to read/write through (the caller's stabilized instance). */
  repository: WorkItemRepository;
  /**
   * The work item whose tasks to load. `null` (no item open) short-circuits to
   * an empty, non-loading result — the fetch-on-open pattern the detail page and
   * the board editors share, so no surface ever reads ALL tasks just to show one
   * item's list.
   */
  workItemId: string | null;
}

/** The editable task fields a caller may supply to {@link UseItemTasksResult.createTask}. */
export type CreateItemTaskInput = Omit<CreateTaskInput, "work_item_id">;

/** Return shape of {@link useItemTasks}. */
export interface UseItemTasksResult {
  /** This item's tasks; empty when `workItemId` is `null` or before the load settles. */
  tasks: Task[];
  /** True while the per-item load is in flight. */
  loading: boolean;
  /** Set if the per-item load failed; `refetch` to retry. */
  error: Error | null;
  /**
   * Ids of tasks with a {@link toggleStatus} currently IN FLIGHT. Added
   * synchronously when the toggle starts and removed once the repository settles
   * — on BOTH success and rollback — so the UI can paint a transient pending cue
   * (and disable the control) without owning any timing.
   */
  pendingTaskIds: ReadonlySet<string>;
  /**
   * Create a task under the current `workItemId` and append it. Pessimistic
   * (await-then-append) like the work-item `create`: the repository owns the id,
   * so there is nothing optimistic to revert — a rejection propagates with state
   * untouched. Rejects if no item is open (`workItemId` is `null`).
   */
  createTask: (input?: CreateItemTaskInput) => Promise<Task>;
  /**
   * Advance a task one step around the status triad — the one-tap lifecycle
   * gesture. Optimistic: the new status paints immediately and is rolled back if
   * the repository rejects (the rejection is re-thrown so callers can surface it).
   */
  toggleStatus: (id: string) => Promise<Task>;
  /** Force a fresh per-item read from the repository. */
  refetch: () => void;
}

/**
 * `useItemTasks` — per-item task state + the two task-write gestures (move ②).
 *
 * Loads exactly ONE work item's tasks (via `repository.getTasks`) and re-loads
 * when `workItemId` changes — the fetch-on-open path that replaces the board's
 * former fetch-ALL-tasks read (PR3). Layers the same optimistic/rollback +
 * pending-id discipline `useWorkItems` uses for work-item edits onto tasks:
 * {@link UseItemTasksResult.toggleStatus} is optimistic with rollback, and
 * {@link UseItemTasksResult.createTask} is a pessimistic append (the repo owns
 * the id). The list-level `useWorkItems.listTasks` read is a SEPARATE concern
 * (it derives board-wide health/counts) and is intentionally untouched.
 */
export function useItemTasks({
  repository,
  workItemId,
}: UseItemTasksOptions): UseItemTasksResult {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [pendingTaskIds, setPendingTaskIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  // Mirror the latest tasks so `toggleStatus` can capture the pre-edit record
  // SYNCHRONOUSLY (React defers the functional setState updater, so reading the
  // previous value inside it would race the rollback).
  const tasksRef = useRef<Task[]>([]);
  tasksRef.current = tasks;

  // Mirror the CURRENT open item so an in-flight write (create/toggle) can tell,
  // AFTER its await, whether the board still shows the same item it started
  // under. Without this a task resolved after the user switched items would land
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
    // No item open → an empty, settled result; never fetch ALL tasks.
    if (workItemId === null) {
      setTasks([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    repository
      .getTasks(workItemId)
      .then((loaded) => {
        if (cancelled || !mountedRef.current) return;
        setTasks(loaded);
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

  const createTask = useCallback(
    async (input: CreateItemTaskInput = {}): Promise<Task> => {
      if (workItemId === null) {
        throw new Error("Cannot create a task without an open work item.");
      }
      // Capture the item this task is created under; after the await we only
      // append if the open item is STILL that one — otherwise a task created for
      // a since-closed item would leak into whatever item is now open.
      const requestedItemId = workItemId;
      // Pessimistic append: the repo owns the id and may reject (unknown parent),
      // so only show the task once the store confirms it.
      const created = await repository.createTask({
        ...input,
        work_item_id: workItemId,
      });
      if (mountedRef.current && workItemIdRef.current === requestedItemId) {
        setTasks((current) => [...current, created]);
      }
      return created;
    },
    [repository, workItemId],
  );

  const toggleStatus = useCallback(
    async (id: string): Promise<Task> => {
      // The item this toggle targets; after the await we only apply the result
      // (or its rollback) if the open item is STILL that one — the same
      // stale-guard `createTask` uses so a settled write never touches another
      // item's list.
      const requestedItemId = workItemIdRef.current;
      // Capture the pre-edit record synchronously (before the deferred setState)
      // so a rollback restores the exact task.
      const previous = tasksRef.current.find((task) => task.id === id);
      if (previous) {
        const position = TASK_STATUS_ORDER.indexOf(previous.status);
        const nextStatus =
          TASK_STATUS_ORDER[(position + 1) % TASK_STATUS_ORDER.length];
        setTasks((current) =>
          current.map((task) =>
            task.id === id ? { ...task, status: nextStatus } : task,
          ),
        );
      }
      // Mark the task as saving (additive — does not touch the edit semantics).
      setPendingTaskIds((current) => {
        const next = new Set(current);
        next.add(id);
        return next;
      });

      try {
        const saved = await repository.toggleStatus(id);
        if (mountedRef.current && workItemIdRef.current === requestedItemId) {
          setTasks((current) =>
            current.map((task) => (task.id === id ? saved : task)),
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
          setTasks((current) =>
            current.map((task) => (task.id === id ? restored : task)),
          );
        }
        throw cause;
      } finally {
        // Clear the saving cue on BOTH settle paths (success + rollback) so a
        // failed toggle never leaves the task stuck looking busy.
        if (mountedRef.current) {
          setPendingTaskIds((current) => {
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
    tasks,
    loading,
    error,
    pendingTaskIds,
    createTask,
    toggleStatus,
    refetch,
  };
}
