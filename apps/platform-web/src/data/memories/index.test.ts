import { describe, expect, it } from "vitest";

import * as memories from "./index";

describe("data/memories barrel", () => {
  it("re-exports the adapter factories, hook, and provider", () => {
    expect(typeof memories.createMemoriesAdapter).toBe("function");
    expect(typeof memories.createMockMemoriesAdapter).toBe("function");
    expect(typeof memories.createMemoryFixtures).toBe("function");
    expect(typeof memories.useMemories).toBe("function");
    expect(typeof memories.getDefaultMemoriesAdapter).toBe("function");
    expect(typeof memories.MemoriesProvider).toBe("function");
    expect(typeof memories.useMemoriesContext).toBe("function");
  });
});
