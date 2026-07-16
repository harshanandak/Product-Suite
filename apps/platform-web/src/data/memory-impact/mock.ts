import type { MemoryImpactAdapter } from "./adapter";
import type { Cohort, MemoryImpact } from "./types";

/**
 * Build a {@link Cohort}, deriving the fraction rates from the raw counts.
 * `threads` defaults to `applied` (its coherent upper bound — one proposal per
 * thread); callers can pass fewer to simulate the clustering guard.
 */
function cohort(
  applied: number,
  edited: number,
  rejected: number,
  threads: number = applied,
): Cohort {
  return {
    applied,
    edited,
    rejected,
    threads,
    editRate: applied > 0 ? edited / applied : 0,
    rejectRate: applied > 0 ? rejected / applied : 0,
  };
}

/**
 * A default, honest fixture: not enough data yet (`insufficient`). The card
 * renders the muted "measuring" copy and NO headline — the safe default when no
 * provider is mounted (tests, preview without a seeded value).
 */
export function createMemoryImpactFixture(
  overrides: Partial<MemoryImpact> = {},
): MemoryImpact {
  return {
    window_days: 30,
    holdout: cohort(4, 1, 0),
    treated: cohort(3, 1, 0),
    delta: 0,
    savedEdits: 0,
    ciLow: 0,
    ciHigh: 0,
    verdict: "insufficient",
    ...overrides,
  };
}

/**
 * An in-memory {@link MemoryImpactAdapter} for preview/fixtures + tests. Resolves
 * a static {@link MemoryImpact} (default: `insufficient`) so the card never
 * crashes without the network provider. The requested window is ALWAYS echoed
 * onto the result's `window_days` — even a seeded impact — so a caller/test that
 * varies the window actually exercises the parameter instead of getting a fixed
 * fixture back. The seed's cohort counts are left intact (the window only reframes
 * the measurement period, and the seed already declares its own coherent counts).
 */
export function createMockMemoryImpactAdapter(
  seed?: MemoryImpact,
): MemoryImpactAdapter {
  return {
    get: (windowDays = 30) =>
      Promise.resolve(
        seed
          ? { ...seed, window_days: windowDays }
          : createMemoryImpactFixture({ window_days: windowDays }),
      ),
  };
}
