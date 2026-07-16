import { describe, expect, it } from "vitest";

import type { Cohort, MemoryImpact } from "./types";

describe("memory-impact types", () => {
  it("Cohort carries fractional rates in [0, 1]", () => {
    const cohort: Cohort = {
      applied: 12,
      edited: 2,
      editRate: 0.167,
      rejected: 1,
      rejectRate: 0.083,
    };
    expect(cohort.editRate).toBeGreaterThanOrEqual(0);
    expect(cohort.editRate).toBeLessThanOrEqual(1);
  });

  it("MemoryImpact accepts the backend shape with a verdict", () => {
    const impact: MemoryImpact = {
      window_days: 30,
      holdout: { applied: 8, edited: 4, editRate: 0.5, rejected: 0, rejectRate: 0 },
      treated: { applied: 12, edited: 2, editRate: 0.167, rejected: 0, rejectRate: 0 },
      delta: 0.333,
      savedEdits: 12,
      ciLow: 4,
      ciHigh: 20,
      verdict: "helps",
    };
    expect(impact.verdict).toBe("helps");
    expect(impact.savedEdits).toBe(12);
  });
});
