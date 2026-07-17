import { describe, expect, it } from "vitest";

import {
  createMemoryImpactFixture,
  createMockMemoryImpactAdapter,
} from "./mock";

describe("createMemoryImpactFixture", () => {
  it("defaults to the honest 'insufficient' verdict with no saved edits", () => {
    const impact = createMemoryImpactFixture();
    expect(impact.verdict).toBe("insufficient");
    expect(impact.savedEdits).toBe(0);
  });

  it("derives cohort rates from the raw counts and applies overrides", () => {
    const impact = createMemoryImpactFixture({ window_days: 14 });
    // holdout is 4 applied / 1 edited ⇒ 0.25.
    expect(impact.holdout.editRate).toBeCloseTo(0.25);
    expect(impact.window_days).toBe(14);
  });
});

describe("createMockMemoryImpactAdapter", () => {
  it("resolves the default insufficient fixture and echoes the window", async () => {
    const adapter = createMockMemoryImpactAdapter();
    const impact = await adapter.get(14);
    expect(impact.verdict).toBe("insufficient");
    expect(impact.window_days).toBe(14);
  });

  it("resolves a seeded impact's fields but echoes the requested window", async () => {
    const seed = createMemoryImpactFixture({ verdict: "helps", savedEdits: 9, window_days: 30 });
    const adapter = createMockMemoryImpactAdapter(seed);
    const impact = await adapter.get(7);
    // The seed's measurement fields ride through unchanged...
    expect(impact.verdict).toBe("helps");
    expect(impact.savedEdits).toBe(9);
    expect(impact.holdout).toEqual(seed.holdout);
    // ...but the requested window is reflected, not the seed's — the param is honored.
    expect(impact.window_days).toBe(7);
  });
});
