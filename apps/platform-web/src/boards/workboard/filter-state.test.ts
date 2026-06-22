import { describe, expect, it } from "vitest";

import type { WorkItemRow } from "@/data/work-items";

import {
  COLUMN_IDS,
  FILTER_OWNER_UNASSIGNED,
  applyWorkboardFilters,
  defaultWorkboardFilterState,
  workboardDepartments,
} from "./filter-state";

/** Minimal WorkItemRow factory for the pure-filter tests (health/counts inert). */
function rowOf(overrides: Partial<WorkItemRow> = {}): WorkItemRow {
  return {
    id: "wi_1",
    title: "Sample item",
    phase: "plan",
    type: "feature",
    priority: "medium",
    tags: [],
    source: "manual",
    project_id: null,
    department: "Engineering",
    assignee_id: null,
    due_date: null,
    created_at: "2026-05-01T09:00:00.000Z",
    updated_at: "2026-06-19T09:00:00.000Z",
    health: "on_track",
    taskCount: 0,
    completedTaskCount: 0,
    ...overrides,
  };
}

describe("workboard filter state", () => {
  it("exposes the 8 wireframe columns in canonical order", () => {
    expect([...COLUMN_IDS]).toEqual([
      "name",
      "type",
      "phase",
      "priority",
      "owner",
      "due",
      "tags",
      "source",
    ]);
  });

  it("defaults to no search, no facet filters, grouped by department", () => {
    const state = defaultWorkboardFilterState();
    expect(state.search).toBe("");
    expect(state.groupBy).toBe("department");
    expect(state.filters.type.size).toBe(0);
    expect(state.filters.owner.size).toBe(0);
    expect(state.filters.department.size).toBe(0);
    expect(state.filters.phase.size).toBe(0);
    expect(state.filters.priority.size).toBe(0);
  });

  it("starts with every column visible and nothing selected", () => {
    const state = defaultWorkboardFilterState();
    expect(state.visibleColumns).toEqual(new Set(COLUMN_IDS));
    expect(state.selection.size).toBe(0);
  });

  it("returns fresh, independent Set instances per call (safe initializer)", () => {
    const a = defaultWorkboardFilterState();
    const b = defaultWorkboardFilterState();
    expect(a.visibleColumns).not.toBe(b.visibleColumns);
    expect(a.filters.type).not.toBe(b.filters.type);

    a.selection.add("wi_auth");
    a.filters.owner.add(FILTER_OWNER_UNASSIGNED);
    expect(b.selection.size).toBe(0);
    expect(b.filters.owner.size).toBe(0);
  });
});

describe("applyWorkboardFilters", () => {
  const rows: WorkItemRow[] = [
    rowOf({
      id: "a",
      title: "Workspace auth hardening",
      type: "feature",
      phase: "execute",
      priority: "high",
      department: "Engineering",
      assignee_id: "user_amara",
      tags: ["security", "backend"],
    }),
    rowOf({
      id: "b",
      title: "Diwali creative set",
      type: "chore",
      phase: "plan",
      priority: "low",
      department: "Marketing",
      assignee_id: null,
      tags: ["campaign"],
    }),
    rowOf({
      id: "c",
      title: "Q3 supplier shortlist",
      type: "research",
      phase: "review",
      priority: "high",
      department: "Sourcing",
      assignee_id: "user_kenji",
      tags: ["sourcing"],
    }),
  ];

  it("returns every row when no filters are active", () => {
    const result = applyWorkboardFilters(rows, defaultWorkboardFilterState());
    expect(result).toHaveLength(rows.length);
  });

  it("matches search case-insensitively over the title", () => {
    const state = { ...defaultWorkboardFilterState(), search: "DIWALI" };
    const result = applyWorkboardFilters(rows, state);
    expect(result.map((row) => row.id)).toEqual(["b"]);
  });

  it("matches search over tags as well as the title", () => {
    const state = { ...defaultWorkboardFilterState(), search: "security" };
    const result = applyWorkboardFilters(rows, state);
    expect(result.map((row) => row.id)).toEqual(["a"]);
  });

  it("treats a whitespace-only search as no filter", () => {
    const state = { ...defaultWorkboardFilterState(), search: "   " };
    expect(applyWorkboardFilters(rows, state)).toHaveLength(rows.length);
  });

  it("filters by type when the type facet is non-empty", () => {
    const base = defaultWorkboardFilterState();
    const state = {
      ...base,
      filters: { ...base.filters, type: new Set(["research"] as const) },
    };
    expect(applyWorkboardFilters(rows, state).map((r) => r.id)).toEqual(["c"]);
  });

  it("filters by department, phase, and priority facets", () => {
    const base = defaultWorkboardFilterState();
    expect(
      applyWorkboardFilters(rows, {
        ...base,
        filters: { ...base.filters, department: new Set(["Marketing"]) },
      }).map((r) => r.id),
    ).toEqual(["b"]);
    expect(
      applyWorkboardFilters(rows, {
        ...base,
        filters: { ...base.filters, phase: new Set(["review"] as const) },
      }).map((r) => r.id),
    ).toEqual(["c"]);
    expect(
      applyWorkboardFilters(rows, {
        ...base,
        filters: { ...base.filters, priority: new Set(["high"] as const) },
      }).map((r) => r.id),
    ).toEqual(["a", "c"]);
  });

  it("matches the unassigned sentinel against null assignees", () => {
    const base = defaultWorkboardFilterState();
    const state = {
      ...base,
      filters: { ...base.filters, owner: new Set([FILTER_OWNER_UNASSIGNED]) },
    };
    expect(applyWorkboardFilters(rows, state).map((r) => r.id)).toEqual(["b"]);
  });

  it("matches an owner id against the matching assignee", () => {
    const base = defaultWorkboardFilterState();
    const state = {
      ...base,
      filters: { ...base.filters, owner: new Set(["user_kenji"]) },
    };
    expect(applyWorkboardFilters(rows, state).map((r) => r.id)).toEqual(["c"]);
  });

  it("intersects active facets with the search (AND semantics)", () => {
    const base = defaultWorkboardFilterState();
    const state = {
      ...base,
      search: "shortlist",
      filters: { ...base.filters, priority: new Set(["high"] as const) },
    };
    expect(applyWorkboardFilters(rows, state).map((r) => r.id)).toEqual(["c"]);
  });

  it("does not mutate the input rows array", () => {
    const snapshot = [...rows];
    applyWorkboardFilters(rows, {
      ...defaultWorkboardFilterState(),
      search: "auth",
    });
    expect(rows).toEqual(snapshot);
  });
});

describe("workboardDepartments", () => {
  it("returns distinct departments sorted alphabetically", () => {
    const rows: WorkItemRow[] = [
      rowOf({ id: "a", department: "Sourcing" }),
      rowOf({ id: "b", department: "Engineering" }),
      rowOf({ id: "c", department: "Marketing" }),
      rowOf({ id: "d", department: "Engineering" }),
    ];
    expect(workboardDepartments(rows)).toEqual([
      "Engineering",
      "Marketing",
      "Sourcing",
    ]);
  });

  it("returns an empty array for no rows", () => {
    expect(workboardDepartments([])).toEqual([]);
  });
});
