import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type AddDependencyInput,
  createMockWorkItemRepository,
  type CreateWorkItemInput,
  type WorkItemRepository,
} from "./repository";
import { useRepositoryContext } from "./RepositoryProvider";
import {
  deriveHealth,
  type Owner,
  type Project,
  type Task,
  type WorkItem,
  type WorkItemDependency,
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
  /** All owners; views resolve a row's `assignee_id` → display via this set. */
  owners: Owner[];
  /** All dependency edges (the graph view's edge set). */
  dependencies: WorkItemDependency[];
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
  /**
   * Ids of work items with an optimistic {@link update} currently IN FLIGHT
   * (saving). An id is added synchronously when `update` is called and removed
   * once the repository settles — on BOTH success and rollback — so views can
   * paint a transient pending cue without owning any timing. Purely additive: it
   * never alters the optimistic succeeded/failed/rollback semantics above.
   */
  pendingIds: ReadonlySet<string>;
  /**
   * Create a new work item through the repository, optimistically prepend it to
   * local state, and return the created record. Unlike {@link update} there is no
   * rollback branch: the id is generated repository-side, so there is no prior
   * value to revert — a rejection simply propagates with state untouched.
   */
  create: (input: CreateWorkItemInput) => Promise<WorkItem>;
  /**
   * Create a dependency edge through the repository and append it to local state.
   * Pessimistic (await-then-append) like {@link create}: the repo owns the id and
   * may legitimately REJECT (self-loop, duplicate, or cycle), so an edge is only
   * shown once the store confirms it — never drawn optimistically then yanked.
   */
  addDependency: (input: AddDependencyInput) => Promise<WorkItemDependency>;
  /**
   * Optimistically remove a dependency edge: it disappears immediately and is
   * restored if the repository rejects (mirrors {@link update}'s rollback).
   */
  removeDependency: (id: string) => Promise<void>;
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
  // Resolve the repo BEFORE the stabilizing useState so its initializer captures
  // the right one: an explicitly injected repo wins (the test seam); otherwise
  // the network repo from RepositoryProvider (when mounted); otherwise the
  // in-memory mock singleton (no-provider fallback for tests/stories).
  const contextRepository = useRepositoryContext();
  const [repository] = useState<WorkItemRepository>(
    () => options.repository ?? contextRepository ?? getDefaultRepository(),
  );

  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [dependencies, setDependencies] = useState<WorkItemDependency[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Ids of work items with an optimistic update currently in flight (saving).
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  // Mirror the latest committed work items so `update` can capture the
  // pre-edit record SYNCHRONOUSLY (React defers the functional setState
  // updater, so reading `previous` inside it would race the rollback).
  const workItemsRef = useRef<WorkItem[]>([]);
  workItemsRef.current = workItems;

  // Mirror dependencies for the same reason — `removeDependency` captures the
  // pre-removal record synchronously so its rollback restores the exact edge.
  const dependenciesRef = useRef<WorkItemDependency[]>([]);
  dependenciesRef.current = dependencies;

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
      repository.listOwners(),
      repository.listDependencies(),
    ])
      .then(
        ([
          loadedItems,
          loadedTasks,
          loadedProjects,
          loadedOwners,
          loadedDependencies,
        ]) => {
          if (cancelled || !mountedRef.current) return;
          setWorkItems(loadedItems);
          setTasks(loadedTasks);
          setProjects(loadedProjects);
          setOwners(loadedOwners);
          setDependencies(loadedDependencies);
        },
      )
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
      // Mark the row as saving (additive — does not touch the edit semantics).
      setPendingIds((current) => {
        const next = new Set(current);
        next.add(id);
        return next;
      });

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
      } finally {
        // Clear the saving cue on BOTH settle paths (success + rollback) so a
        // failed write never leaves the row stuck looking busy.
        if (mountedRef.current) {
          setPendingIds((current) => {
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

  const create = useCallback(
    async (input: CreateWorkItemInput): Promise<WorkItem> => {
      const created = await repository.create(input);
      // Prepend so the new item is immediately visible at the top; no rollback —
      // the repo owns the id, so there is nothing optimistic to revert.
      if (mountedRef.current) {
        setWorkItems((current) => [created, ...current]);
      }
      return created;
    },
    [repository],
  );

  const addDependency = useCallback(
    async (input: AddDependencyInput): Promise<WorkItemDependency> => {
      // Pessimistic: the repo validates (self/duplicate/cycle) and owns the id, so
      // only append once it confirms — never draw an edge we might have to retract.
      const created = await repository.addDependency(input);
      if (mountedRef.current) {
        setDependencies((current) => [...current, created]);
      }
      return created;
    },
    [repository],
  );

  const removeDependency = useCallback(
    async (id: string): Promise<void> => {
      // Capture the pre-removal edge synchronously (before the deferred setState)
      // so a rollback restores the exact record.
      const previous = dependenciesRef.current.find(
        (dependency) => dependency.id === id,
      );
      setDependencies((current) =>
        current.filter((dependency) => dependency.id !== id),
      );

      try {
        await repository.removeDependency(id);
      } catch (cause) {
        // Roll the optimistic removal back.
        if (mountedRef.current && previous) {
          const restored = previous;
          setDependencies((current) =>
            current.some((dependency) => dependency.id === restored.id)
              ? current
              : [...current, restored],
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

  return {
    items,
    projects,
    owners,
    dependencies,
    loading,
    error,
    update,
    pendingIds,
    create,
    addDependency,
    removeDependency,
    refetch,
  };
}
