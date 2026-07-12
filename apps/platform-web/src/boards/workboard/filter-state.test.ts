import { describe, expect, it } from "vitest";

import type { WorkItemRow } from "@/data/work-items";

import {
  COLUMN_IDS,
  FILTER_OWNER_UNASSIGNED,
  FILTER_STORAGE_KEY,
  SAVED_VIEWS_KEY,
  applyWorkboardFilters,
  currentViewConfig,
  defaultWorkboardFilterState,
  parsePersistedView,
  parseSavedViews,
  serializePersistedView,
  serializeSavedViews,
  workboardDepartments,
  type SavedView,
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
    team_id: "team_engineering",
    status_id: "status_engineering_plan",
    parent_id: null,
    depth: 0,
    department: "Engineering",
    assignee_id: null,
    due_date: null,
    created_at: "2026-05-01T09:00:00.000Z",
    updated_at: "2026-06-19T09:00:00.000Z",
    health: "on_track",
    checkCount: 0,
    completedCheckCount: 0,
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

describe("currentViewConfig", () => {
  it("snapshots the persistable slice (search/groupBy/filters/columns/view)", () => {
    const base = defaultWorkboardFilterState();
    const filterState = {
      ...base,
      search: "auth",
      groupBy: "phase" as const,
      filters: {
        type: new Set(["feature"] as const),
        owner: new Set(["user_kenji"]),
        department: new Set(["Engineering"]),
        phase: new Set(["execute"] as const),
        priority: new Set(["high"] as const),
      },
      visibleColumns: new Set(["name", "type"] as const),
    };
    const config = currentViewConfig({ filterState, view: "kanban" });
    expect(config.search).toBe("auth");
    expect(config.groupBy).toBe("phase");
    expect(config.view).toBe("kanban");
    expect(config.visibleColumns).toEqual(new Set(["name", "type"]));
    expect(config.filters?.type).toEqual(new Set(["feature"]));
    expect(config.filters?.priority).toEqual(new Set(["high"]));
  });

  it("never carries the selection into the config", () => {
    const config = currentViewConfig({
      filterState: {
        ...defaultWorkboardFilterState(),
        selection: new Set(["wi_auth", "wi_realtime"]),
      },
      view: "table",
    });
    expect(config).not.toHaveProperty("selection");
    expect(JSON.stringify(config)).not.toContain("wi_auth");
  });

  it("clones the Sets so the snapshot never aliases live state", () => {
    const filterState = defaultWorkboardFilterState();
    const config = currentViewConfig({ filterState, view: "table" });
    expect(config.filters?.type).not.toBe(filterState.filters.type);
    expect(config.visibleColumns).not.toBe(filterState.visibleColumns);
    // Mutating the live state after the snapshot must not change the config.
    filterState.filters.type.add("bug");
    expect(config.filters?.type.size).toBe(0);
  });
});

describe("saved views (serialize ⇄ parse)", () => {
  it("exposes a versioned storage key distinct from the filter key", () => {
    expect(SAVED_VIEWS_KEY).toBe("workboard.savedViews.v1");
    expect(SAVED_VIEWS_KEY).not.toBe(FILTER_STORAGE_KEY);
  });

  it("round-trips a list of saved views", () => {
    const views: SavedView[] = [
      {
        id: "v1",
        name: "My execute lane",
        config: currentViewConfig({
          filterState: {
            ...defaultWorkboardFilterState(),
            search: "auth",
            groupBy: "phase",
            filters: {
              type: new Set(["feature", "bug"] as const),
              owner: new Set([FILTER_OWNER_UNASSIGNED]),
              department: new Set(["Engineering"]),
              phase: new Set(["execute"] as const),
              priority: new Set(["high"] as const),
            },
            visibleColumns: new Set(["name", "phase"] as const),
          },
          view: "kanban",
        }),
      },
      {
        id: "v2",
        name: "All",
        config: currentViewConfig({
          filterState: defaultWorkboardFilterState(),
          view: "table",
        }),
      },
    ];

    const restored = parseSavedViews(serializeSavedViews(views));
    expect(restored).toHaveLength(2);
    expect(restored[0]?.id).toBe("v1");
    expect(restored[0]?.name).toBe("My execute lane");
    expect(restored[0]?.config.search).toBe("auth");
    expect(restored[0]?.config.groupBy).toBe("phase");
    expect(restored[0]?.config.view).toBe("kanban");
    expect(restored[0]?.config.filters?.type).toEqual(
      new Set(["feature", "bug"]),
    );
    expect(restored[0]?.config.filters?.owner).toEqual(
      new Set([FILTER_OWNER_UNASSIGNED]),
    );
    expect(restored[0]?.config.visibleColumns).toEqual(
      new Set(["name", "phase"]),
    );
    expect(restored[1]?.id).toBe("v2");
  });

  it("tolerates malformed JSON / a null key (returns [])", () => {
    expect(parseSavedViews("not json {{{")).toEqual([]);
    expect(parseSavedViews(null)).toEqual([]);
    expect(parseSavedViews("")).toEqual([]);
  });

  it("ignores a non-array payload", () => {
    expect(parseSavedViews(JSON.stringify({ id: "x", name: "y" }))).toEqual([]);
    expect(parseSavedViews("42")).toEqual([]);
    expect(parseSavedViews("null")).toEqual([]);
  });

  it("drops entries missing a non-empty string name or id", () => {
    const raw = JSON.stringify([
      { id: "ok", name: "Keep me", config: {} },
      { id: "", name: "No id", config: {} },
      { id: "no-name", name: "   ", config: {} },
      { id: "no-name-key", config: {} },
      { name: "No id key", config: {} },
      { id: 7, name: "Numeric id", config: {} },
      "a bare string",
      null,
    ]);
    const restored = parseSavedViews(raw);
    expect(restored.map((view) => view.id)).toEqual(["ok"]);
  });

  it("sanitises a garbage embedded config instead of dropping the entry", () => {
    const raw = JSON.stringify([
      {
        id: "v1",
        name: "Stale view",
        config: {
          groupBy: "galaxy",
          view: "spreadsheet",
          visibleColumns: ["name", "bogus"],
          filters: {
            type: ["feature", "epic"],
            phase: ["execute", "archived"],
            priority: ["nope"],
            owner: ["user_kenji"],
            department: ["Engineering"],
          },
        },
      },
    ]);
    const restored = parseSavedViews(raw);
    // The entry SURVIVES (name + id valid) but its config is sanitised.
    expect(restored).toHaveLength(1);
    expect(restored[0]?.config.groupBy).toBeUndefined();
    expect(restored[0]?.config.view).toBeUndefined();
    expect(restored[0]?.config.visibleColumns).toEqual(new Set(["name"]));
    expect(restored[0]?.config.filters?.type).toEqual(new Set(["feature"]));
    expect(restored[0]?.config.filters?.phase).toEqual(new Set(["execute"]));
    expect(restored[0]?.config.filters?.priority).toEqual(new Set());
  });

  it("never lets a selection leak into a saved config", () => {
    const views: SavedView[] = [
      {
        id: "v1",
        name: "Live state snapshot",
        config: currentViewConfig({
          filterState: {
            ...defaultWorkboardFilterState(),
            selection: new Set(["wi_auth"]),
          },
          view: "table",
        }),
      },
    ];
    const raw = serializeSavedViews(views);
    expect(raw).not.toContain("selection");
    expect(raw).not.toContain("wi_auth");
    expect(parseSavedViews(raw)[0]?.config).not.toHaveProperty("selection");
  });
});
