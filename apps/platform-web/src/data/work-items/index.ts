/**
 * Workboard data seam — public surface.
 *
 * Views (Table, Editor) and integration code import everything from here, never
 * from the individual modules. This barrel is the contract boundary; the
 * underlying repository adapter swaps for F2 without touching callers.
 */
export type {
  ActivityEvent,
  ActivityEventKind,
  DependencyRelationship,
  Health,
  Owner,
  Phase,
  Priority,
  Project,
  Task,
  TaskStatus,
  WorkItem,
  WorkItemDependency,
  WorkItemPatch,
  WorkItemRow,
  WorkItemSource,
  WorkItemType,
} from "./types";
export { deriveHealth } from "./types";

export type {
  AddDependencyInput,
  CreateTaskInput,
  CreateWorkItemInput,
  ListGraphOptions,
  TaskPatch,
  WorkItemGraph,
  WorkItemRepository,
} from "./repository";
export { createMockWorkItemRepository, DEFAULT_GRAPH_DEPTH } from "./repository";

export {
  buildDependencyAdjacency,
  dependencyExists,
  wouldCreateCycle,
} from "./dependency-graph";

export {
  createActivityFixtures,
  createDependencyFixtures,
  createOwnerFixtures,
  createProjectFixtures,
  createTaskFixtures,
  createWorkItemFixtures,
} from "./fixtures";

export { getDefaultRepository, useWorkItems } from "./use-work-items";
export { RepositoryProvider, useRepositoryContext } from "./RepositoryProvider";
export type {
  UseWorkItemsOptions,
  UseWorkItemsResult,
} from "./use-work-items";
