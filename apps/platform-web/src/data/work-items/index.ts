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
  Check,
  CheckStatus,
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
  CreateCheckInput,
  CreateWorkItemInput,
  ListGraphOptions,
  CheckPatch,
  WorkItemGraph,
  WorkItemRepository,
} from "./repository";
export { createMockWorkItemRepository, DEFAULT_GRAPH_DEPTH } from "./repository";

export {
  buildDependencyAdjacency,
  dependencyExists,
  wouldCreateCycle,
} from "./dependency-graph";

export { childrenByParent, taskProgress, topLevelItems } from "./nesting";
export type { TaskProgress } from "./nesting";

export {
  createActivityFixtures,
  createDependencyFixtures,
  createOwnerFixtures,
  createProjectFixtures,
  createCheckFixtures,
  createWorkItemFixtures,
} from "./fixtures";

export { getDefaultRepository, useWorkItems } from "./use-work-items";
export { RepositoryProvider, useRepositoryContext } from "./RepositoryProvider";
export type {
  UseWorkItemsOptions,
  UseWorkItemsResult,
} from "./use-work-items";

export { useTeams } from "./use-teams";
export type { Team, UseTeamsOptions, UseTeamsResult } from "./use-teams";

export { useItemChecks } from "./use-item-checks";
export type {
  CreateItemCheckInput,
  UseItemChecksOptions,
  UseItemChecksResult,
} from "./use-item-checks";
