import {
  createProjectFixtures,
  createTaskFixtures,
  createWorkItemFixtures,
} from "./fixtures";
import type { Project, Task, WorkItem, WorkItemPatch } from "./types";

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
  /** All tasks across all items — lets the hook derive list-level health in one read. */
  listTasks(): Promise<Task[]>;
  /** Tasks for one work item (the coalition's task section). */
  getTasks(workItemId: string): Promise<Task[]>;
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
  const workItems: WorkItem[] = createWorkItemFixtures();
  const tasks: Task[] = createTaskFixtures();

  const settle = <T>(value: T): Promise<T> =>
    latencyMs > 0
      ? new Promise((resolve) => setTimeout(() => resolve(value), latencyMs))
      : Promise.resolve(value);

  const clone = <T>(value: T): T => ({ ...value });

  return {
    list() {
      return settle(workItems.map(clone));
    },

    listProjects() {
      return settle(projects.map(clone));
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
        updated_at: new Date().toISOString(),
      };
      workItems[index] = updated;
      return settle(clone(updated));
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
