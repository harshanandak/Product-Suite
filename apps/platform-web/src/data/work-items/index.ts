/**
 * Workboard data seam — public surface.
 *
 * Views (Table, Editor) and integration code import everything from here, never
 * from the individual modules. This barrel is the contract boundary; the
 * underlying repository adapter swaps for F2 without touching callers.
 */
export type {
  Health,
  IsoTimestamp,
  Phase,
  Project,
  Task,
  TaskStatus,
  WorkItem,
  WorkItemPatch,
  WorkItemRow,
} from "./types";
export { deriveHealth } from "./types";

export type { WorkItemRepository } from "./repository";
export { createMockWorkItemRepository } from "./repository";

export {
  createProjectFixtures,
  createTaskFixtures,
  createWorkItemFixtures,
} from "./fixtures";

export { getDefaultRepository, useWorkItems } from "./use-work-items";
export type {
  UseWorkItemsOptions,
  UseWorkItemsResult,
} from "./use-work-items";
