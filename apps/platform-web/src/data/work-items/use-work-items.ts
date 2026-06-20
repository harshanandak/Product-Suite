import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createMockWorkItemRepository,
  type WorkItemRepository,
} from "./repository";
import {
  deriveHealth,
  type Project,
  type Task,
  type WorkItem,
  type WorkItemPatch,
  type WorkItemRow,
} from "./types";

/**
 * Shared module singleton so every caller that does not inject a repository
 * sees the same in-memory store (optimistic edits persist across components).
 */
let defaultRepository: WorkItemRepository | undefined;

/**
 * The process-wide default {@link WorkItemRepository}, lazily created once.
 *
 * Every caller that does not inject its own repository (the hook AND any screen
 * that reads tasks directly) must route through this so they all share ONE
 * in-memory store — optimistic edits then persist across components and across
 * navigation instead of being lost to a fresh per-mount mock.
 */
export function getDefaultRepository(): WorkItemRepository {
  defaultRepository ??= createMockWorkItemRepository();
  return defaultRepository;
}

/** Options for {@link useWorkItems}. The repo is injectable for tests. */
export interface UseWorkItemsOptions {
  /** Repository to read/write through; defaults to the module singleton. */
  repository?: WorkItemRepository;
}

/** Return shape of {@link useWorkItems}. */
export interface UseWorkItemsResult {
  /** View-model rows with derived health + task counts (computed on read). */
  items: WorkItemRow[];
  /** All projects (for the project switcher / filter). */
  projects: Project[];
  /** True while the initial load is in flight. */
  loading: boolean;
  /** Set if the initial load failed; `refetch` to retry. */
  error: Error | null;
  /**
   * Optimistically apply an editable patch to a work item. Local state updates
   * immediately; on repository failure the change is rolled back and the
   * rejection re-thrown so callers can surface it.
   */
  update: (id: string, patch: WorkItemPatch) => Promise<WorkItem>;
  /** Force a fresh read from the repository. */
  refetch: () => void;
}

function toRows(workItems: WorkItem[], tasks: Task[], now: number): WorkItemRow[] {
  const tasksByItem = new Map<string, Task[]>();
  for (const task of tasks) {
    const bucket = tasksByItem.get(task.work_item_id);
    if (bucket) {
      bucket.push(task);
    } else {
      tasksByItem.set(task.work_item_id, [task]);
    }
  }

  return workItems.map((item) => {
    const itemTasks = tasksByItem.get(item.id) ?? [];
    const completedTaskCount = itemTasks.filter(
      (task) => task.status === "completed",
    ).length;
    return {
      ...item,
      health: deriveHealth(item, itemTasks, now),
      taskCount: itemTasks.length,
      completedTaskCount,
    };
  });
}

/**
 * `useWorkItems` — React-19 hook over the {@link WorkItemRepository}.
 *
 * Loads work items + tasks + projects, exposes them as `WorkItemRow[]` with
 * read-time derived health (never stored — DESIGN §3), and provides an
 * optimistic `update` mutator with rollback. Subscribes to the repository's
 * realtime-invalidation stub and refetches when it fires.
 */
export function useWorkItems(
  options: UseWorkItemsOptions = {},
): UseWorkItemsResult {
  // Stabilize the repo: an injected one is used as-is; otherwise the singleton.
  const [repository] = useState<WorkItemRepository>(
    () => options.repository ?? getDefaultRepository(),
  );

  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Mirror the latest committed work items so `update` can capture the
  // pre-edit record SYNCHRONOUSLY (React defers the functional setState
  // updater, so reading `previous` inside it would race the rollback).
  const workItemsRef = useRef<WorkItem[]>([]);
  workItemsRef.current = workItems;

  // Guards against setState after unmount across the async load.
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

    Promise.all([
      repository.list(),
      repository.listTasks(),
      repository.listProjects(),
    ])
      .then(([loadedItems, loadedTasks, loadedProjects]) => {
        if (cancelled || !mountedRef.current) return;
        setWorkItems(loadedItems);
        setTasks(loadedTasks);
        setProjects(loadedProjects);
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
  }, [repository, reloadKey]);

  const refetch = useCallback(() => {
    setReloadKey((key) => key + 1);
  }, []);

  // Refetch when the realtime transport signals an invalidation.
  useEffect(() => repository.subscribe(refetch), [repository, refetch]);

  const update = useCallback(
    async (id: string, patch: WorkItemPatch): Promise<WorkItem> => {
      // Capture the pre-edit record synchronously (before the deferred setState).
      const previous = workItemsRef.current.find((item) => item.id === id);
      setWorkItems((current) =>
        current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      );

      try {
        const saved = await repository.update(id, patch);
        if (mountedRef.current) {
          setWorkItems((current) =>
            current.map((item) => (item.id === id ? saved : item)),
          );
        }
        return saved;
      } catch (cause) {
        // Roll back the optimistic edit.
        if (mountedRef.current && previous) {
          const restored = previous;
          setWorkItems((current) =>
            current.map((item) => (item.id === id ? restored : item)),
          );
        }
        throw cause;
      }
    },
    [repository],
  );

  const items = useMemo(
    () => toRows(workItems, tasks, Date.now()),
    [workItems, tasks],
  );

  return { items, projects, loading, error, update, refetch };
}
