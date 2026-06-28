import { describe, expect, it } from "vitest";

import type { WorkItemRow } from "@/data/work-items";

import {
  COLUMN_IDS,
  FILTER_OWNER_UNASSIGNED,
  FILTER_STORAGE_KEY,
  applyWorkboardFilters,
  defaultWorkboardFilterState,
  parsePersistedView,
  serializePersistedView,
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

  it("matches search over the department name", () => {
    const state = { ...defaultWorkboardFilterState(), search: "marketing" };
    // "Marketing" is row b's department (not in any title/tag/type/owner).
    expect(applyWorkboardFilters(rows, state).map((row) => row.id)).toEqual([
      "b",
    ]);
  });

  it("matches search over the human type label", () => {
    const state = { ...defaultWorkboardFilterState(), search: "chore" };
    // row b is a `chore`; the visible label "Chore" matches the typed word.
    expect(applyWorkboardFilters(rows, state).map((row) => row.id)).toEqual([
      "b",
    ]);
  });

  it("matches search over the owner's display name (resolved via owners)", () => {
    const owners = [
      { id: "user_amara", name: "Amara Okafor" },
      { id: "user_kenji", name: "Kenji Tanaka" },
    ];
    const state = { ...defaultWorkboardFilterState(), search: "kenji" };
    // row c is assigned to user_kenji → "Kenji Tanaka".
    expect(
      applyWorkboardFilters(rows, state, owners).map((row) => row.id),
    ).toEqual(["c"]);
  });

  it("never matches an owner name when no owners are supplied", () => {
    const state = { ...defaultWorkboardFilterState(), search: "Amara" };
    // Without the owners lookup the row carries only an id, so owner-name search
    // simply finds nothing (graceful default).
    expect(applyWorkboardFilters(rows, state)).toHaveLength(0);
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

describe("persisted view state (serialize ⇄ parse)", () => {
  it("exposes a single versioned storage key", () => {
    expect(FILTER_STORAGE_KEY).toBe("workboard.filters.v1");
  });

  it("round-trips a populated filter state + view", () => {
    const base = defaultWorkboardFilterState();
    const filterState = {
      ...base,
      search: "auth",
      groupBy: "phase" as const,
      filters: {
        type: new Set(["feature", "bug"] as const),
        owner: new Set(["user_kenji", FILTER_OWNER_UNASSIGNED]),
        department: new Set(["Engineering"]),
        phase: new Set(["execute"] as const),
        priority: new Set(["high"] as const),
      },
      visibleColumns: new Set(["name", "type", "phase"] as const),
    };

    const parsed = parsePersistedView(
      serializePersistedView({ filterState, view: "kanban" }),
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.search).toBe("auth");
    expect(parsed?.groupBy).toBe("phase");
    expect(parsed?.view).toBe("kanban");
    expect(parsed?.visibleColumns).toEqual(new Set(["name", "type", "phase"]));
    expect(parsed?.filters?.type).toEqual(new Set(["feature", "bug"]));
    expect(parsed?.filters?.owner).toEqual(
      new Set(["user_kenji", FILTER_OWNER_UNASSIGNED]),
    );
    expect(parsed?.filters?.department).toEqual(new Set(["Engineering"]));
    expect(parsed?.filters?.phase).toEqual(new Set(["execute"]));
    expect(parsed?.filters?.priority).toEqual(new Set(["high"]));
  });

  it("never serializes the selection set", () => {
    const base = defaultWorkboardFilterState();
    const filterState = {
      ...base,
      selection: new Set(["wi_auth", "wi_realtime"]),
    };
    const raw = serializePersistedView({ filterState, view: "table" });

    expect(raw).not.toContain("selection");
    expect(raw).not.toContain("wi_auth");
    const parsed = parsePersistedView(raw);
    expect(parsed).not.toHaveProperty("selection");
  });

  it("returns null for malformed JSON", () => {
    expect(parsePersistedView("not json {{{")).toBeNull();
  });

  it("returns null for an absent key (null input)", () => {
    expect(parsePersistedView(null)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parsePersistedView("")).toBeNull();
  });

  it("returns null when the blob is not an object", () => {
    expect(parsePersistedView("42")).toBeNull();
    expect(parsePersistedView("null")).toBeNull();
    expect(parsePersistedView('"a string"')).toBeNull();
  });

  it("drops unknown enum members while keeping valid ones", () => {
    const raw = JSON.stringify({
      groupBy: "phase",
      view: "kanban",
      visibleColumns: ["name", "bogus", "source"],
      filters: {
        type: ["feature", "epic"],
        phase: ["execute", "archived"],
        priority: ["high", "urgent"],
        owner: ["user_kenji"],
        department: ["Engineering"],
      },
    });
    const parsed = parsePersistedView(raw);

    expect(parsed?.visibleColumns).toEqual(new Set(["name", "source"]));
    expect(parsed?.filters?.type).toEqual(new Set(["feature"]));
    expect(parsed?.filters?.phase).toEqual(new Set(["execute"]));
    expect(parsed?.filters?.priority).toEqual(new Set(["high"]));
    expect(parsed?.filters?.owner).toEqual(new Set(["user_kenji"]));
  });

  it("omits visibleColumns when EVERY stored id is unknown (keeps the all-visible default)", () => {
    // A future column rename without a key bump would leave only stale ids. An
    // empty visible set is truthy, so assigning it would survive the screen's
    // `?? default` merge and render a table with zero data columns. Omitting it
    // instead lets the all-visible default win.
    const parsed = parsePersistedView(
      JSON.stringify({ visibleColumns: ["legacyName", "legacyType"] }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.visibleColumns).toBeUndefined();
  });

  it("coerces an unknown groupBy / view to absent (falls back at merge)", () => {
    const parsed = parsePersistedView(
      JSON.stringify({ groupBy: "galaxy", view: "spreadsheet", search: 42 }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.groupBy).toBeUndefined();
    expect(parsed?.view).toBeUndefined();
    // a non-string search is garbage → absent
    expect(parsed?.search).toBeUndefined();
  });

  it("tolerates partial / missing fields", () => {
    const parsed = parsePersistedView(JSON.stringify({ view: "kanban" }));
    expect(parsed).toEqual({ view: "kanban" });
  });

  it("ignores non-array filter facets and non-array visibleColumns", () => {
    const parsed = parsePersistedView(
      JSON.stringify({
        visibleColumns: "name",
        filters: { type: "feature" },
      }),
    );
    // filters present but every facet coerces to an empty set
    expect(parsed?.filters?.type).toEqual(new Set());
    expect(parsed?.visibleColumns).toBeUndefined();
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
