/**
 * Memory-impact data seam — public surface (Memory Brain P2b).
 *
 * The "Saved N edits" card imports everything from here, never from the
 * individual modules. Mirrors `data/memories`' barrel: the underlying adapter
 * (mock vs network) swaps for the real backend without touching callers.
 */
export type { Cohort, MemoryImpact, MemoryImpactVerdict } from "./types";

export type {
  CreateMemoryImpactAdapterOptions,
  MemoryImpactAdapter,
} from "./adapter";
export {
  createMemoryImpactAdapter,
  DEFAULT_WINDOW_DAYS,
} from "./adapter";

export {
  createMemoryImpactFixture,
  createMockMemoryImpactAdapter,
} from "./mock";

export {
  getDefaultMemoryImpactAdapter,
  useMemoryImpact,
} from "./use-memory-impact";
export type {
  UseMemoryImpactOptions,
  UseMemoryImpactResult,
} from "./use-memory-impact";

export {
  MemoryImpactProvider,
  useMemoryImpactContext,
} from "./MemoryImpactProvider";
