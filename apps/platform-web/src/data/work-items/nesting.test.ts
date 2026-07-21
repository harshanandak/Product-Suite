import { describe, expect, it } from "vitest";

import { childrenByParent, taskProgress, topLevelItems } from "./nesting";

/** Minimal `{ id, parent_id }` rows — all the nesting selectors read. */
const rows = [
  { id: "p1", parent_id: null },
  { id: "c1", parent_id: "p1" },
  { id: "c2", parent_id: "p1" },
  { id: "p2", parent_id: null },
  { id: "c3", parent_id: "p2" },
];

describe("childrenByParent", () => {
  it("buckets children under their parent id, preserving input order", () => {
    const byParent = childrenByParent(rows);
    expect(byParent.get("p1")?.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(byParent.get("p2")?.map((c) => c.id)).toEqual(["c3"]);
  });

  it("omits top-level items — only parents that HAVE children are keys", () => {
    const byParent = childrenByParent(rows);
    // p1/p2 are keys because they have children; a childless top-level item
    // and any child id are never keys.
    expect([...byParent.keys()].sort()).toEqual(["p1", "p2"]);
    expect(byParent.has("c1")).toBe(false);
  });

  it("returns an empty map when nothing is nested", () => {
    const flat = [
      { id: "a", parent_id: null },
      { id: "b", parent_id: null },
    ];
    expect(childrenByParent(flat).size).toBe(0);
  });
});

describe("topLevelItems", () => {
  it("keeps only roots (parent_id === null), preserving order", () => {
    expect(topLevelItems(rows).map((r) => r.id)).toEqual(["p1", "p2"]);
  });
});

describe("taskProgress", () => {
  it("counts children whose phase reached done as the n of n/m", () => {
    const children = [
      { phase: "done" as const },
      { phase: "done" as const },
      { phase: "execute" as const },
    ];
    expect(taskProgress(children)).toEqual({ completed: 2, total: 3 });
  });

  it("is 0/0 for a parent with no children", () => {
    expect(taskProgress([])).toEqual({ completed: 0, total: 0 });
  });

  it("is m/m when every child is done", () => {
    const children = [{ phase: "done" as const }, { phase: "done" as const }];
    expect(taskProgress(children)).toEqual({ completed: 2, total: 2 });
  });
});
