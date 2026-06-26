import { describe, expect, it } from "vitest";

import * as workItemsSeam from "./index";

/**
 * Contract test for the Workboard data-seam barrel (`./index`).
 *
 * Views and integration code import EXCLUSIVELY from this barrel (never the
 * underlying modules), so the public surface is itself the contract. This test
 * pins that surface: every runtime value the barrel promises must be defined and
 * callable. Type-only re-exports erase at compile time, so they cannot be
 * asserted at runtime — `typecheck` is the gate for those — but importing this
 * module at all proves the type re-exports resolve.
 *
 * It also satisfies the repo's test-coupling gate (every source file needs a
 * colocated test); a missing export here fails loudly instead of silently
 * breaking every downstream importer.
 */
describe("work-items barrel (./index)", () => {
  it("re-exports the type/derivation helper", () => {
    expect(workItemsSeam.deriveHealth).toBeDefined();
    expect(typeof workItemsSeam.deriveHealth).toBe("function");
  });

  it("re-exports the repository factory", () => {
    expect(workItemsSeam.createMockWorkItemRepository).toBeDefined();
    expect(typeof workItemsSeam.createMockWorkItemRepository).toBe("function");
  });

  it("re-exports the fixtures helpers", () => {
    expect(workItemsSeam.createProjectFixtures).toBeDefined();
    expect(typeof workItemsSeam.createProjectFixtures).toBe("function");
    expect(workItemsSeam.createTaskFixtures).toBeDefined();
    expect(typeof workItemsSeam.createTaskFixtures).toBe("function");
    expect(workItemsSeam.createWorkItemFixtures).toBeDefined();
    expect(typeof workItemsSeam.createWorkItemFixtures).toBe("function");
    expect(workItemsSeam.createOwnerFixtures).toBeDefined();
    expect(typeof workItemsSeam.createOwnerFixtures).toBe("function");
  });

  it("re-exports the hook and the shared-singleton accessor", () => {
    expect(workItemsSeam.useWorkItems).toBeDefined();
    expect(typeof workItemsSeam.useWorkItems).toBe("function");
    expect(workItemsSeam.getDefaultRepository).toBeDefined();
    expect(typeof workItemsSeam.getDefaultRepository).toBe("function");
  });

  it("exposes a single shared default repository instance (singleton)", () => {
    const first = workItemsSeam.getDefaultRepository();
    const second = workItemsSeam.getDefaultRepository();
    expect(first).toBe(second);
  });
});
