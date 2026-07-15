/**
 * Memory-brain data seam — public surface (Memory Brain P1).
 *
 * The Decision Log screen + capture form import everything from here, never
 * from the individual modules. Mirrors `data/proposals`' barrel: the underlying
 * adapter (mock vs network) swaps for the real backend without touching callers.
 */
export type {
  CreateMemoryInput,
  DeferMemoryInput,
  MemoryDetail,
  MemoryFilters,
  MemoryKind,
  MemoryRow,
  MemoryStatus,
  ScopeType,
  SourceKind,
  SupersedeMemoryInput,
} from "./types";

export type {
  CreateMemoriesAdapterOptions,
  MemoriesAdapter,
} from "./adapter";
export { createMemoriesAdapter } from "./adapter";

export { createMemoryFixtures, createMockMemoriesAdapter } from "./mock";

export { getDefaultMemoriesAdapter, useMemories } from "./use-memories";
export type { UseMemoriesOptions, UseMemoriesResult } from "./use-memories";

export { MemoriesProvider, useMemoriesContext } from "./MemoriesProvider";
