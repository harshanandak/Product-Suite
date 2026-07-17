import { describe, expect, it } from "vitest";

import * as memoryImpact from "./index";

describe("data/memory-impact barrel", () => {
  it("re-exports the adapter factory, mock, hook, and provider", () => {
    expect(typeof memoryImpact.createMemoryImpactAdapter).toBe("function");
    expect(typeof memoryImpact.createMockMemoryImpactAdapter).toBe("function");
    expect(typeof memoryImpact.createMemoryImpactFixture).toBe("function");
    expect(typeof memoryImpact.useMemoryImpact).toBe("function");
    expect(typeof memoryImpact.getDefaultMemoryImpactAdapter).toBe("function");
    expect(typeof memoryImpact.MemoryImpactProvider).toBe("function");
    expect(typeof memoryImpact.useMemoryImpactContext).toBe("function");
    expect(memoryImpact.DEFAULT_WINDOW_DAYS).toBe(30);
  });
});
