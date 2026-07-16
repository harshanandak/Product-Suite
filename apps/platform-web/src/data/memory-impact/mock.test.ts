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

  it("resolves a seeded impact verbatim", async () => {
    const seed = createMemoryImpactFixture({ verdict: "helps", savedEdits: 9 });
    const adapter = createMockMemoryImpactAdapter(seed);
    await expect(adapter.get()).resolves.toBe(seed);
  });
});
