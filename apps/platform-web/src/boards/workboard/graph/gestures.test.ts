import { describe, expect, it } from "vitest";

import type { WorkItemDependency } from "@/data/work-items";

import { canCreateDependency, connectionToDependencyInput } from "./gestures";

/**
 * Pure coverage for the edge-drag gesture's DECISION logic (DESIGN §5 / §10) —
 * the feature's heart, tested without rendering React Flow. The view's
 * `isValidConnection` / `onConnect` are thin wrappers over these.
 */

/** Terse edge builder: `dep("a", "b")` is the dependency `a → b`. */
function dep(source: string, target: string): WorkItemDependency {
  return {
    id: `${source}->${target}`,
    source_item_id: source,
    target_item_id: target,
    relationship_type: "depends_on",
    created_at: "2026-06-01T09:00:00.000Z",
  };
}

describe("canCreateDependency", () => {
  it("allows a fresh edge between two unrelated nodes", () => {
    expect(canCreateDependency([], "a", "b")).toBe(true);
  });

  it("rejects a missing endpoint", () => {
    expect(canCreateDependency([], null, "b")).toBe(false);
    expect(canCreateDependency([], "a", undefined)).toBe(false);
    expect(canCreateDependency([], "", "b")).toBe(false);
  });

  it("rejects a self-loop", () => {
    expect(canCreateDependency([], "a", "a")).toBe(false);
  });

  it("rejects a duplicate of an existing edge", () => {
    expect(canCreateDependency([dep("a", "b")], "a", "b")).toBe(false);
  });

  it("allows the reverse of a non-cyclic edge only when it does not loop", () => {
    // a→b exists; b→a WOULD close a 2-cycle → rejected.
    expect(canCreateDependency([dep("a", "b")], "b", "a")).toBe(false);
  });

  it("rejects an edge that would close a transitive cycle", () => {
    // a→b→c exists; c→a would loop.
    const deps = [dep("a", "b"), dep("b", "c")];
    expect(canCreateDependency(deps, "c", "a")).toBe(false);
  });

  it("allows a shortcut edge that does not close a loop", () => {
    // a→b→c exists; a→c is a safe shortcut (still a DAG).
    const deps = [dep("a", "b"), dep("b", "c")];
    expect(canCreateDependency(deps, "a", "c")).toBe(true);
  });

  it("validates against the FULL set — a cycle through a third node is caught", () => {
    // a→b, b→c present (c hidden from the view, say). c→a must still be rejected
    // even though the view would not render the b→c edge.
    const deps = [dep("a", "b"), dep("b", "c")];
    expect(canCreateDependency(deps, "c", "a")).toBe(false);
  });
});

describe("connectionToDependencyInput", () => {
  it("maps a complete connection to a dependency input (source depends on target)", () => {
    expect(connectionToDependencyInput({ source: "a", target: "b" })).toEqual({
      source_item_id: "a",
      target_item_id: "b",
    });
  });

  it("returns null when an endpoint is missing", () => {
    expect(connectionToDependencyInput({ source: "a", target: null })).toBeNull();
    expect(connectionToDependencyInput({ source: null, target: "b" })).toBeNull();
    expect(connectionToDependencyInput({})).toBeNull();
  });
});
