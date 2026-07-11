import { TASK_STATUS_ORDER } from "@product-suite/contracts";

import {
  dependencyExists,
  wouldCreateCycle,
} from "./dependency-graph";
import {
  createActivityFixtures,
  createDependencyFixtures,
  createOwnerFixtures,
  createProjectFixtures,
  createTaskFixtures,
  createWorkItemFixtures,
} from "./fixtures";
import type {
  ActivityEvent,
  ActivityEventKind,
  DependencyRelationship,
  Owner,
  Project,
  Task,
  WorkItem,
  WorkItemDependency,
  WorkItemPatch,
} from "./types";

/** Map an update {@link WorkItemPatch} to a human-readable activity one-liner. */
function summarizeUpdate(patch: WorkItemPatch): string {
  if (patch.phase) return `Phase set to ${patch.phase}`;
  if (patch.title !== undefined) return `Renamed to “${patch.title}”`;
  if (patch.priority) return `Priority set to ${patch.priority}`;
  if (patch.archived !== undefined) return patch.archived ? "Archived" : "Unarchived";
  const fields = Object.keys(patch);
  return fields.length > 0 ? `Updated ${fields.join(", ")}` : "Updated";
}

/**
 * Map a task {@link TaskPatch} to a human-readable activity one-liner. Task
 * mutations are logged against the PARENT work item (tasks have no independent
 * feed), consistent with how work-item edits/dependency changes are recorded.
 */
function summarizeTaskUpdate(taskTitle: string, patch: TaskPatch): string {
  if (patch.status) return `Task “${taskTitle}” set to ${patch.status}`;
  if (patch.title !== undefined) return `Task renamed to “${patch.title}”`;
  if (patch.due_date !== undefined) return `Task “${taskTitle}” due date updated`;
  return `Task “${taskTitle}” updated`;
}

/**
 * Input to {@link WorkItemRepository.addDependency}. `relationship_type` is
 * optional and defaults to `depends_on` (the only kind v1 renders); the id and
 * `created_at` are owned by the repository.
 */
export interface AddDependencyInput {
  source_item_id: string;
  target_item_id: string;
  relationship_type?: DependencyRelationship;
}

/**
 * A dependency-graph slice: the work items in scope plus the dependency edges
 * among them. Returned by {@link WorkItemRepository.listGraph} so the graph view
 * gets nodes + edges in one read (and, with a `focusId`, only a neighborhood).
 */
export interface WorkItemGraph {
  nodes: WorkItem[];
  dependencies: WorkItemDependency[];
}

/**
 * Options for {@link WorkItemRepository.listGraph}.
 *
 * - `focusId` — when set, return only the focus item plus its dependency
 *   neighborhood (so the graph never loads the whole set up front; DESIGN §10
 *   "load from where the user came"). Omitted ⇒ the full graph.
 * - `depth` — neighborhood radius in hops over the (undirected) dependency edges;
 *   defaults to {@link DEFAULT_GRAPH_DEPTH}. Ignored when `focusId` is omitted.
 */
export interface ListGraphOptions {
  focusId?: string;
  depth?: number;
}

/** Default neighborhood radius for a focused {@link WorkItemRepository.listGraph}. */
export const DEFAULT_GRAPH_DEPTH = 2;

/**
 * Input to {@link WorkItemRepository.create}. Every field is optional — an empty
 * `{}` yields a fully-defaulted "Untitled work item". `title` is surfaced
 * explicitly (the common case: name-then-edit); the remaining editable fields
 * reuse {@link WorkItemPatch} so the create surface can never drift from the
 * edit surface. The id, `source`, and timestamps are owned by the repository
 * and so are NOT part of the input.
 */
export type CreateWorkItemInput = { title?: string } & Partial<WorkItemPatch>;

/**
 * The editable surface of a TASK — the frozen task-write shape (move ②). Shared
 * by {@link WorkItemRepository.updateTask} and (as the optional tail of)
 * {@link CreateTaskInput}. Excludes managed fields (`id`, `work_item_id`,
 * timestamps): a task never moves work items and its id/timestamps are
 * repository-owned. Tasks are read-only in the UI today; freezing this shape lets
 * F2 author the `product_tasks` table against a stable contract before any write
 * UI is wired.
 */
export type TaskPatch = Partial<Pick<Task, "title" | "status" | "due_date">>;

/**
 * Input to {@link WorkItemRepository.createTask}. `work_item_id` is REQUIRED (a
 * task is always born under a work item — §1); `title` is surfaced explicitly
 * (name-then-edit) and the remaining editable fields reuse {@link TaskPatch} so
 * the create surface can never drift from the edit surface. The id, `work_item_id`
 * aside, and timestamps are repository-owned and are NOT part of the input.
 */
export type CreateTaskInput = { work_item_id: string; title?: string } & Partial<TaskPatch>;

/**
 * Workboard repository SEAM (DESIGN §10 — backend-mediated only; built ahead of
 * the F2 backend). All Workboard data flows through this interface. Only the
 * adapter implementation swaps when F2 lands; callers (the hook, views) never
 * change.
 *
 * Every method is async (Promise-returning) so the hook's `loading` state is
 * meaningful and the real network adapter drops in cleanly.
 */
export interface WorkItemRepository {
  /** All work items (no project filter — views scope/group client-side). */
  list(): Promise<WorkItem[]>;
  /** All projects (for the project switcher / filter). */
  listProjects(): Promise<Project[]>;
  /** All owners (resolves a work item's `assignee_id` → display + the owner filter). */
  listOwners(): Promise<Owner[]>;
  /** All tasks across all items — lets the hook derive list-level health in one read. */
  listTasks(): Promise<Task[]>;
  /** Tasks for one work item (the coalition's task section). */
  getTasks(workItemId: string): Promise<Task[]>;
  /**
   * Create a new task under a work item, filling defaults for every omitted
   * field (`title` → "Untitled task", `status` → `todo`, `due_date` → null),
   * insert it, and return the created record. The id and timestamps are
   * generated repository-side. Rejects if `work_item_id` is unknown (a task
   * cannot exist without a parent — §1). See {@link CreateTaskInput}.
   */
  createTask(input: CreateTaskInput): Promise<Task>;
  /**
   * Apply an editable {@link TaskPatch} to a task and return the updated record.
   * Rejects if the id is unknown. Bumps `updated_at`.
   */
  updateTask(id: string, patch: TaskPatch): Promise<Task>;
  /**
   * Advance a task through the status triad (`todo → in_progress → completed →
   * todo`, in {@link TASK_STATUS_ORDER}) and return the updated record — the
   * one-tap lifecycle gesture. Rejects if the id is unknown. Bumps `updated_at`.
   */
  toggleStatus(id: string): Promise<Task>;
  /** Append-only activity log for one work item (newest first). */
  listActivity(workItemId: string): Promise<ActivityEvent[]>;
  /**
   * Create a new work item from a partial input, filling sensible defaults for
   * every omitted field, insert it into the store, and return the created
   * record. The id is generated server-side (here, repo-side), so the caller
   * never supplies one. See {@link CreateWorkItemInput}.
   */
  create(input: CreateWorkItemInput): Promise<WorkItem>;
  /**
   * Apply an editable patch to a work item and return the updated record.
   * Rejects if the id is unknown. Bumps `updated_at`.
   */
  update(id: string, patch: WorkItemPatch): Promise<WorkItem>;
  /** All dependency edges (the graph view's edge set). */
  listDependencies(): Promise<WorkItemDependency[]>;
  /**
   * Create a directed dependency `source → target` ("source depends on target")
   * and return the created record. Rejects when: either id is unknown; the edge
   * is a self-loop (`source === target`); the pair already exists; or the edge
   * would close a directed cycle (the graph must stay a DAG — dagre requires it).
   */
  addDependency(input: AddDependencyInput): Promise<WorkItemDependency>;
  /** Remove a dependency edge by id. Rejects if the id is unknown. */
  removeDependency(id: string): Promise<void>;
  /**
   * Read a dependency-graph slice in one call — nodes + the edges among them.
   * With {@link ListGraphOptions.focusId} set, returns only the focus item plus
   * its `depth`-hop dependency neighborhood (so the graph view can seed from
   * where the user came in, never loading the whole set; DESIGN §10). The mock
   * slices its in-memory fixtures; F2 serves this server-side.
   */
  listGraph(options?: ListGraphOptions): Promise<WorkItemGraph>;
  /**
   * RealtimeTransport-ish invalidation stub (DESIGN §12 seam 2). Register a
   * callback fired when server-side data changes; returns an unsubscribe fn.
   * The mock never fires it on its own — F2's transport will drive it.
   */
  subscribe(onInvalidate: () => void): () => void;
}

/**
 * Create an in-memory mock repository backed by the fixture dataset.
 *
 * Each call owns an isolated, mutable copy of the fixtures (deep-cloned via the
 * fixture factories), so tests and parallel instances never share state.
 * Returned records are cloned on the way out so callers cannot mutate the
 * store by reference.
 *
 * @param options.latencyMs - optional artificial delay per call (default 0) to
 *   exercise loading states in stories/manual testing.
 */
export function createMockWorkItemRepository(
  options: { latencyMs?: number } = {},
): WorkItemRepository {
  const latencyMs = options.latencyMs ?? 0;

  const projects: Project[] = createProjectFixtures();
  const owners: Owner[] = createOwnerFixtures();
  const workItems: WorkItem[] = createWorkItemFixtures();
  const tasks: Task[] = createTaskFixtures();
  const dependencies: WorkItemDependency[] = createDependencyFixtures();
  const activity: ActivityEvent[] = createActivityFixtures();

  const settle = <T>(value: T): Promise<T> =>
    latencyMs > 0
      ? new Promise((resolve) => setTimeout(() => resolve(value), latencyMs))
      : Promise.resolve(value);

  const clone = <T>(value: T): T => ({ ...value });

  // Work items carry a mutable `tags` array; a shallow clone would alias it back
  // to the store, so copy it too (callers can edit a returned row's tags freely).
  const cloneWorkItem = (item: WorkItem): WorkItem => ({
    ...item,
    tags: [...item.tags],
  });

  // Monotonic suffix so generated ids are unique within this store instance even
  // when several items are created in the same millisecond.
  let createSeq = 0;
  const nextId = (): string => {
    createSeq += 1;
    return `wi_new_${Date.now().toString(36)}_${createSeq}`;
  };

  let depSeq = 0;
  const nextDependencyId = (): string => {
    depSeq += 1;
    return `dep_new_${Date.now().toString(36)}_${depSeq}`;
  };

  let taskSeq = 0;
  const nextTaskId = (): string => {
    taskSeq += 1;
    return `task_new_${Date.now().toString(36)}_${taskSeq}`;
  };

  // Append-only activity log: every mutation records a one-liner so the detail
  // page's Activity tab reads a real history (F2 will emit these server-side).
  let actSeq = 0;
  const logActivity = (
    workItemId: string,
    kind: ActivityEventKind,
    summary: string,
  ): void => {
    actSeq += 1;
    activity.push({
      id: `act_new_${Date.now().toString(36)}_${actSeq}`,
      work_item_id: workItemId,
      kind,
      summary,
      created_at: new Date().toISOString(),
    });
  };

  const workItemExists = (id: string): boolean =>
    workItems.some((item) => item.id === id);

  return {
    list() {
      return settle(workItems.map(cloneWorkItem));
    },

    create(input: CreateWorkItemInput) {
      const now = new Date().toISOString();
      const created: WorkItem = {
        id: nextId(),
        title: input.title ?? "Untitled work item",
        description: input.description ?? "",
        phase: input.phase ?? "plan",
        type: input.type ?? "feature",
        priority: input.priority ?? "medium",
        tags: input.tags ? [...input.tags] : [],
        source: "manual",
        project_id: input.project_id ?? null,
        // team_id is mandatory: use the caller's, else the first existing item's
        // team (the active workspace's primary lane), else a safe fallback.
        team_id: input.team_id ?? workItems[0]?.team_id ?? "team_default",
        // Default to the caller's department, else the first existing item's
        // department (the active workspace's primary lane), else a safe fallback.
        department: input.department ?? workItems[0]?.department ?? "General",
        assignee_id: input.assignee_id ?? null,
        due_date: input.due_date ?? null,
        archived: input.archived ?? false,
        created_at: now,
        updated_at: now,
      };
      workItems.unshift(created);
      logActivity(created.id, "created", `Created “${created.title}”`);
      return settle(cloneWorkItem(created));
    },

    listProjects() {
      return settle(projects.map(clone));
    },

    listOwners() {
      return settle(owners.map(clone));
    },

    listTasks() {
      return settle(tasks.map(clone));
    },

    getTasks(workItemId: string) {
      return settle(
        tasks.filter((task) => task.work_item_id === workItemId).map(clone),
      );
    },

    createTask(input: CreateTaskInput) {
      if (!workItemExists(input.work_item_id)) {
        return Promise.reject(
          new Error(`Unknown work item: ${input.work_item_id}`),
        );
      }
      const now = new Date().toISOString();
      const created: Task = {
        id: nextTaskId(),
        work_item_id: input.work_item_id,
        title: input.title ?? "Untitled task",
        status: input.status ?? "todo",
        due_date: input.due_date ?? null,
        created_at: now,
        updated_at: now,
      };
      tasks.push(created);
      // Tasks have no independent feed — log against the parent work item, like
      // every other mutation.
      logActivity(
        created.work_item_id,
        "updated",
        `Added task “${created.title}”`,
      );
      return settle(clone(created));
    },

    updateTask(id: string, patch: TaskPatch) {
      const index = tasks.findIndex((task) => task.id === id);
      if (index === -1) {
        return Promise.reject(new Error(`Unknown task: ${id}`));
      }
      const updated: Task = {
        ...tasks[index],
        ...patch,
        updated_at: new Date().toISOString(),
      };
      tasks[index] = updated;
      logActivity(
        updated.work_item_id,
        "updated",
        summarizeTaskUpdate(updated.title, patch),
      );
      return settle(clone(updated));
    },

    toggleStatus(id: string) {
      const index = tasks.findIndex((task) => task.id === id);
      if (index === -1) {
        return Promise.reject(new Error(`Unknown task: ${id}`));
      }
      const current = tasks[index];
      // Advance one step around the triad; unknown/legacy statuses restart at the
      // loop head so the gesture is always defined.
      const position = TASK_STATUS_ORDER.indexOf(current.status);
      const next =
        TASK_STATUS_ORDER[(position + 1) % TASK_STATUS_ORDER.length];
      const updated: Task = {
        ...current,
        status: next,
        updated_at: new Date().toISOString(),
      };
      tasks[index] = updated;
      logActivity(updated.work_item_id, "updated", `Task “${updated.title}” set to ${next}`);
      return settle(clone(updated));
    },

    listActivity(workItemId: string) {
      // Newest first. The store is append-ordered (chronological), so we sort by
      // timestamp descending and break ties by insertion index descending — two
      // events logged in the same millisecond (e.g. rapid create→update) still
      // order deterministically, latest-inserted first. A total order, no flake.
      return settle(
        activity
          .map((event, index) => ({ event, index }))
          .filter(({ event }) => event.work_item_id === workItemId)
          .sort((a, b) => {
            if (a.event.created_at !== b.event.created_at) {
              return a.event.created_at < b.event.created_at ? 1 : -1;
            }
            return b.index - a.index;
          })
          .map(({ event }) => clone(event)),
      );
    },

    update(id: string, patch: WorkItemPatch) {
      const index = workItems.findIndex((item) => item.id === id);
      if (index === -1) {
        return Promise.reject(new Error(`Unknown work item: ${id}`));
      }
      const updated: WorkItem = {
        ...workItems[index],
        ...patch,
        // Copy any incoming tags so the store never aliases the caller's array.
        ...(patch.tags ? { tags: [...patch.tags] } : {}),
        updated_at: new Date().toISOString(),
      };
      workItems[index] = updated;
      logActivity(id, "updated", summarizeUpdate(patch));
      return settle(cloneWorkItem(updated));
    },

    listDependencies() {
      return settle(dependencies.map(clone));
    },

    addDependency(input: AddDependencyInput) {
      const source = input.source_item_id;
      const target = input.target_item_id;
      if (!workItemExists(source)) {
        return Promise.reject(new Error(`Unknown work item: ${source}`));
      }
      if (!workItemExists(target)) {
        return Promise.reject(new Error(`Unknown work item: ${target}`));
      }
      if (source === target) {
        return Promise.reject(new Error("A work item cannot depend on itself."));
      }
      if (dependencyExists(dependencies, source, target)) {
        return Promise.reject(
          new Error(`Dependency already exists: ${source} → ${target}`),
        );
      }
      if (wouldCreateCycle(dependencies, source, target)) {
        return Promise.reject(
          new Error(`Dependency would create a cycle: ${source} → ${target}`),
        );
      }
      const created: WorkItemDependency = {
        id: nextDependencyId(),
        source_item_id: source,
        target_item_id: target,
        relationship_type: input.relationship_type ?? "depends_on",
        created_at: new Date().toISOString(),
      };
      dependencies.push(created);
      logActivity(source, "dependency_added", "Added a dependency");
      return settle(clone(created));
    },

    removeDependency(id: string) {
      const index = dependencies.findIndex((dependency) => dependency.id === id);
      if (index === -1) {
        return Promise.reject(new Error(`Unknown dependency: ${id}`));
      }
      const [removed] = dependencies.splice(index, 1);
      if (removed) {
        logActivity(
          removed.source_item_id,
          "dependency_removed",
          "Removed a dependency",
        );
      }
      return settle(undefined);
    },

    listGraph(options: ListGraphOptions = {}) {
      const { focusId } = options;
      const depth = options.depth ?? DEFAULT_GRAPH_DEPTH;

      // No focus → the whole graph; the view applies its own LOD/clustering.
      if (focusId === undefined) {
        return settle({
          nodes: workItems.map(cloneWorkItem),
          dependencies: dependencies.map(clone),
        });
      }

      // Unknown focus → an empty slice (the view shows its empty state).
      if (!workItemExists(focusId)) {
        return settle({ nodes: [], dependencies: [] });
      }

      // BFS the UNDIRECTED dependency neighborhood out to `depth` hops, so the
      // focus item's prerequisites AND dependents both come into view.
      const neighbors = new Map<string, Set<string>>();
      const link = (from: string, to: string): void => {
        const set = neighbors.get(from);
        if (set) {
          set.add(to);
        } else {
          neighbors.set(from, new Set([to]));
        }
      };
      for (const dependency of dependencies) {
        link(dependency.source_item_id, dependency.target_item_id);
        link(dependency.target_item_id, dependency.source_item_id);
      }

      const inScope = new Set<string>([focusId]);
      let frontier: string[] = [focusId];
      for (let hop = 0; hop < Math.max(0, depth); hop += 1) {
        const nextFrontier: string[] = [];
        for (const node of frontier) {
          const next = neighbors.get(node);
          if (!next) continue;
          for (const neighbor of next) {
            if (!inScope.has(neighbor)) {
              inScope.add(neighbor);
              nextFrontier.push(neighbor);
            }
          }
        }
        if (nextFrontier.length === 0) break;
        frontier = nextFrontier;
      }

      return settle({
        nodes: workItems
          .filter((item) => inScope.has(item.id))
          .map(cloneWorkItem),
        dependencies: dependencies
          .filter(
            (dependency) =>
              inScope.has(dependency.source_item_id) &&
              inScope.has(dependency.target_item_id),
          )
          .map(clone),
      });
    },

    subscribe() {
      // No-op until F2's RealtimeTransport drives invalidation (DESIGN §12 seam
      // 2). The mock never fires on its own; this just satisfies the contract.
      return () => {
        // Nothing to tear down while invalidation is inert.
      };
    },
  };
}
