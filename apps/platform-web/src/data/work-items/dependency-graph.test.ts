import { describe, expect, it } from "vitest";

import {
  buildDependencyAdjacency,
  dependencyExists,
  wouldCreateCycle,
} from "./dependency-graph";
import type { WorkItemDependency } from "./types";

/** Terse edge builder: `edge("a", "b")` is the dependency `a → b`. */
function edge(source: string, target: string): WorkItemDependency {
  return {
    id: `${source}->${target}`,
    source_item_id: source,
    target_item_id: target,
    relationship_type: "depends_on",
    created_at: "2026-06-01T09:00:00.000Z",
  };
}

describe("buildDependencyAdjacency", () => {
  it("maps each source to the set of items it depends on", () => {
    const adjacency = buildDependencyAdjacency([
      edge("a", "b"),
      edge("a", "c"),
      edge("b", "c"),
    ]);
    expect([...(adjacency.get("a") ?? [])].sort()).toEqual(["b", "c"]);
    expect([...(adjacency.get("b") ?? [])]).toEqual(["c"]);
    expect(adjacency.get("c")).toBeUndefined();
  });

  it("returns an empty map for no dependencies", () => {
    expect(buildDependencyAdjacency([]).size).toBe(0);
  });
});

describe("dependencyExists", () => {
  const deps = [edge("a", "b"), edge("b", "c")];

  it("is true only for an existing directed pair", () => {
    expect(dependencyExists(deps, "a", "b")).toBe(true);
    expect(dependencyExists(deps, "b", "c")).toBe(true);
  });

  it("is direction-sensitive (b→a is not a→b)", () => {
    expect(dependencyExists(deps, "b", "a")).toBe(false);
    expect(dependencyExists(deps, "a", "c")).toBe(false);
  });
});

describe("wouldCreateCycle", () => {
  it("reports a self-loop as a cycle", () => {
    expect(wouldCreateCycle([], "a", "a")).toBe(true);
  });

  it("is false when adding an edge into an empty graph", () => {
    expect(wouldCreateCycle([], "a", "b")).toBe(false);
  });

  it("detects a direct two-node cycle (a→b then b→a)", () => {
    expect(wouldCreateCycle([edge("a", "b")], "b", "a")).toBe(true);
  });

  it("detects a transitive cycle across a chain (a→b→c then c→a)", () => {
    const chain = [edge("a", "b"), edge("b", "c")];
    expect(wouldCreateCycle(chain, "c", "a")).toBe(true);
  });

  it("allows a shortcut edge that does NOT close a loop (a→b→c then a→c)", () => {
    const chain = [edge("a", "b"), edge("b", "c")];
    expect(wouldCreateCycle(chain, "a", "c")).toBe(false);
  });

  it("allows an unrelated edge between disconnected nodes", () => {
    const chain = [edge("a", "b"), edge("b", "c")];
    expect(wouldCreateCycle(chain, "d", "e")).toBe(false);
  });

  it("does not loop forever on a graph that already contains a cycle", () => {
    // a↔b already cyclic; asking about an unrelated edge must still terminate.
    const cyclic = [edge("a", "b"), edge("b", "a")];
    expect(wouldCreateCycle(cyclic, "c", "d")).toBe(false);
  });
});
