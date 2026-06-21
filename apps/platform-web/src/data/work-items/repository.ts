import {
  createOwnerFixtures,
  createProjectFixtures,
  createTaskFixtures,
  createWorkItemFixtures,
} from "./fixtures";
import type { Owner, Project, Task, WorkItem, WorkItemPatch } from "./types";

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

  return {
    list() {
      return settle(workItems.map(cloneWorkItem));
    },

    create(input: CreateWorkItemInput) {
      const now = new Date().toISOString();
      const created: WorkItem = {
        id: nextId(),
        title: input.title ?? "Untitled work item",
        phase: input.phase ?? "plan",
        type: input.type ?? "feature",
        priority: input.priority ?? "medium",
        tags: input.tags ? [...input.tags] : [],
        source: "manual",
        project_id: input.project_id ?? null,
        // Default to the caller's department, else the first existing item's
        // department (the active workspace's primary lane), else a safe fallback.
        department: input.department ?? workItems[0]?.department ?? "General",
        assignee_id: input.assignee_id ?? null,
        due_date: input.due_date ?? null,
        created_at: now,
        updated_at: now,
      };
      workItems.unshift(created);
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
      return settle(cloneWorkItem(updated));
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
