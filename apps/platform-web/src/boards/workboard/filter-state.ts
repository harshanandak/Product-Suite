import {
  PHASE_LABELS,
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  WORK_ITEM_TYPE_LABELS,
  WORK_ITEM_TYPE_ORDER,
  type Phase,
  type Priority,
  type WorkItemType,
} from "@product-suite/ui";

import type { Owner, WorkItemRow } from "@/data/work-items";

/**
 * Shared Workboard view state (DESIGN §4 board grammar) — the single contract
 * the toolbar and the Table both read and write.
 *
 * This is VIEW state, not persistence: it never crosses the repository seam, so
 * it lives under `boards/workboard/` rather than `data/`. The toolbar owns the
 * controls that mutate it (search box, filter menus, group-by, column toggles);
 * the Table consumes it to filter, group, order columns, and track selection.
 *
 * Pair the type with {@link defaultWorkboardFilterState} so every consumer starts
 * from the same baseline (and the colocated test has a runtime value to assert).
 */

/**
 * The Table's columns, in wireframe order (`plan-table`: Name · Type · Phase ·
 * Priority · Owner · Due · Tags · Source). Drives both column visibility toggles
 * and the rendered column order. The leading selection checkbox is structural
 * (always present) and is deliberately NOT a `ColumnId`.
 */
export type ColumnId =
  | "name"
  | "type"
  | "phase"
  | "priority"
  | "owner"
  | "due"
  | "tags"
  | "source";

/** All columns in canonical order — the default visible set and toggle source. */
export const COLUMN_IDS: readonly ColumnId[] = [
  "name",
  "type",
  "phase",
  "priority",
  "owner",
  "due",
  "tags",
  "source",
];

/**
 * The fields the rows may be grouped into swimlanes by (DESIGN §B "Group"
 * options). `"phase"` is the **Status** grouping — the label-only rename from
 * Phase 1 kept the `phase` identifier (the field flip to `status_id` is Phase 4),
 * so "Group by Status" in the UI is this `"phase"` token. `"none"` is a flat list.
 *
 * `"project"` and `"cycle"` are valid tokens now but their data lands in Phase 4
 * (`project_id` exists on the row; there is no cycle field yet — grouping by cycle
 * currently buckets everything under "No cycle"). `"type"` is retained from v2.
 */
export type GroupByField =
  | "phase"
  | "project"
  | "cycle"
  | "priority"
  | "assignee"
  | "team"
  | "type"
  | "none";

/**
 * The group-by options in DESIGN §B order (Status·Project·Cycle·Priority·
 * Assignee·Team·Type·None). The toolbar's Group menu maps over this; the last
 * two (`type`, `none`) trail the design list as retained/utility options.
 */
export const GROUP_BY_FIELDS: readonly GroupByField[] = [
  "phase",
  "project",
  "cycle",
  "priority",
  "assignee",
  "team",
  "type",
  "none",
];

/**
 * The layout renderer for the one Item surface (DESIGN §B "Layout"). Replaces the
 * v2 `WorkboardView` (`table`/`kanban`): `list` is the former table, `board` the
 * former kanban, and `graph` folds the ex-standalone graph screen in as a third
 * renderer of the SAME filtered/grouped set.
 */
export type WorkboardLayout = "list" | "board" | "graph";

/** The three layouts in toolbar order (List · Board · Graph); default `list`. */
export const WORKBOARD_LAYOUTS: readonly WorkboardLayout[] = [
  "list",
  "board",
  "graph",
];

/**
 * Row ordering within each group (DESIGN §B "Sort"). `"manual"` preserves the
 * incoming order (no reorder); the rest sort by the named field. Default
 * `"updated"` (most-recently-updated first).
 */
export type SortByField = "manual" | "priority" | "updated" | "created" | "due";

/** The sort options in toolbar order; default `updated`. */
export const SORT_BY_FIELDS: readonly SortByField[] = [
  "manual",
  "priority",
  "updated",
  "created",
  "due",
];

/**
 * Sub-item (Tasks) visibility on the surface (DESIGN §B "Tasks"). Consumed by the
 * Table's nesting renderer (Lane B / Phase 3): `"nested"` shows child tasks
 * indented under their parent, `"flat"` shows every item at one level, `"hidden"`
 * shows only parents. Default `"nested"`.
 */
export type TasksVisibility = "nested" | "flat" | "hidden";

/** The tasks-visibility options in toolbar order; default `nested`. */
export const TASKS_VISIBILITIES: readonly TasksVisibility[] = [
  "nested",
  "flat",
  "hidden",
];

/**
 * Owner-filter sentinel for "no owner" (items routed to a team queue —
 * `assignee_id: null`). Used INSTEAD of `null` inside the `owner` filter set so
 * the set stays a homogeneous `Set<string>`; the Table maps it back to a
 * `assignee_id === null` predicate.
 */
export const FILTER_OWNER_UNASSIGNED = "__unassigned__";

/**
 * The structured filter facets. Each facet is a `Set` of selected values; an
 * EMPTY set means "no filter on this facet" (show all). The `owner` set holds
 * owner ids plus the {@link FILTER_OWNER_UNASSIGNED} sentinel; `team`
 * holds team names.
 */
export interface WorkboardFilters {
  /** Selected work-item types; empty = all types. */
  type: Set<WorkItemType>;
  /** Selected owner ids (or {@link FILTER_OWNER_UNASSIGNED}); empty = all owners. */
  owner: Set<string>;
  /**
   * Selected team names; empty = all teams. VALUES are team NAME strings — they
   * match `item.department`, the deprecated-but-retained team-name carrier that
   * {@link applyWorkboardFilters} keeps reading (see the seam note there).
   */
  team: Set<string>;
  /** Selected phases; empty = all phases. */
  phase: Set<Phase>;
  /** Selected priorities; empty = all priorities. */
  priority: Set<Priority>;
}

/**
 * The complete toolbar ⇄ table view state. Shared by reference so a single
 * `setState` from the toolbar re-renders the Table consistently.
 */
export interface WorkboardFilterState {
  /** Free-text search across title, tags, team, type label, and owner name. */
  search: string;
  /** Structured facet filters (see {@link WorkboardFilters}). */
  filters: WorkboardFilters;
  /** The active layout renderer (List/Board/Graph); default `"list"`. */
  layout: WorkboardLayout;
  /** Current swimlane grouping (`"phase"`=Status by default, per DESIGN §B). */
  groupBy: GroupByField;
  /** Row ordering within each group (`"updated"` by default). */
  sortBy: SortByField;
  /** Sub-item visibility (Lane B / Phase 3 consumes this); `"nested"` default. */
  tasks: TasksVisibility;
  /** Which columns are shown, in {@link COLUMN_IDS} order. */
  visibleColumns: Set<ColumnId>;
  /** Selected work-item ids (row-selection checkboxes). */
  selection: Set<string>;
}

/**
 * Fresh, fully-defaulted {@link WorkboardFilterState} (DESIGN §B defaults): no
 * search, no facet filters, List layout, grouped by Status (`phase`), sorted by
 * Updated, tasks nested, all columns visible, nothing selected.
 *
 * Returns a NEW value (fresh `Set` instances) on every call so consumers never
 * share mutable collections — safe to use as a `useState` initializer.
 */
export function defaultWorkboardFilterState(): WorkboardFilterState {
  return {
    search: "",
    filters: {
      type: new Set(),
      owner: new Set(),
      team: new Set(),
      phase: new Set(),
      priority: new Set(),
    },
    layout: "list",
    groupBy: "phase",
    sortBy: "updated",
    tasks: "nested",
    visibleColumns: new Set(COLUMN_IDS),
    selection: new Set(),
  };
}

/**
 * Predicate helper: an EMPTY facet set means "no filter on this facet" (show
 * all). Otherwise the row's value must be a member of the selected set.
 */
function facetMatches<T>(selected: ReadonlySet<T>, value: T): boolean {
  return selected.size === 0 || selected.has(value);
}

/**
 * Owner-facet predicate. An empty set passes everything; otherwise the row
 * matches when its `assignee_id` is in the set, OR when the row is unassigned
 * (`assignee_id === null`) and the set carries the {@link FILTER_OWNER_UNASSIGNED}
 * sentinel.
 */
function ownerMatches(
  selected: ReadonlySet<string>,
  assigneeId: string | null,
): boolean {
  if (selected.size === 0) return true;
  if (assigneeId === null) return selected.has(FILTER_OWNER_UNASSIGNED);
  return selected.has(assigneeId);
}

/**
 * Case-insensitive free-text match over a row's user-visible text — its title,
 * tags, team, type label, AND owner display name. The row stores only
 * `assignee_id`, so the owner name is resolved through the `ownerNameById`
 * lookup; the type is matched by its human {@link WORK_ITEM_TYPE_LABELS} label
 * (what the user actually sees), not its raw enum code. An empty (or
 * whitespace-only) query passes everything.
 */
function searchMatches(
  query: string,
  row: WorkItemRow,
  ownerNameById: ReadonlyMap<string, string>,
): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  const ownerName =
    row.assignee_id === null ? undefined : ownerNameById.get(row.assignee_id);
  const haystacks = [
    row.title,
    // `row.department` is the deprecated-but-retained team-name carrier.
    row.department,
    WORK_ITEM_TYPE_LABELS[row.type],
    ...row.tags,
    ...(ownerName === undefined ? [] : [ownerName]),
  ];
  return haystacks.some((field) => field.toLowerCase().includes(needle));
}

/** Priority rank (severity-first) for the `sortBy: "priority"` ordering; mirrors
 * {@link PRIORITY_ORDER} so the sort matches the facet/badge ordering everywhere.
 * An unknown priority sorts last. */
const PRIORITY_RANK = new Map<Priority, number>(
  PRIORITY_ORDER.map((priority, index) => [priority, index]),
);

/**
 * Comparator for the active {@link SortByField}. Timestamps sort most-recent
 * first (descending ISO string compare); `due` sorts soonest-first with nulls
 * last; `priority` sorts by severity via {@link PRIORITY_RANK}; `manual` is a
 * no-op (returns 0) so the stable sort preserves the incoming order. A tie
 * returns 0, so the stable sort keeps the pre-sort (filtered) order as the
 * secondary key.
 */
function compareRowsBy(
  a: WorkItemRow,
  b: WorkItemRow,
  sortBy: SortByField,
): number {
  switch (sortBy) {
    case "priority":
      return (
        (PRIORITY_RANK.get(a.priority) ?? PRIORITY_ORDER.length) -
        (PRIORITY_RANK.get(b.priority) ?? PRIORITY_ORDER.length)
      );
    case "updated":
      return b.updated_at.localeCompare(a.updated_at);
    case "created":
      return b.created_at.localeCompare(a.created_at);
    case "due":
      if (a.due_date === null && b.due_date === null) return 0;
      if (a.due_date === null) return 1;
      if (b.due_date === null) return -1;
      return a.due_date.localeCompare(b.due_date);
    case "manual":
      return 0;
  }
}

/**
 * Apply the shared {@link WorkboardFilterState}'s search + facet filters to a set
 * of rows, returning the rows that pass ALL active criteria, ORDERED by the
 * active {@link SortByField}. PURE — never mutates its inputs (filters into a new
 * array, then sorts that copy) and reads no view state beyond `search`,
 * `filters`, and `sortBy` (group-by, column visibility, and selection are render
 * concerns the Table owns).
 *
 * The Table never filters; the screen runs this once and hands the Table the
 * already-filtered `rows`, so the two surfaces can never desync (DESIGN §4).
 *
 * Filter semantics — an EMPTY facet set is "no filter" (show all):
 *  - search: case-insensitive substring over title, tags, team, type
 *    label, AND owner display name (resolved from `owners`).
 *  - type / phase / priority / team: membership in the matching facet set.
 *  - owner: the {@link FILTER_OWNER_UNASSIGNED} sentinel matches
 *    `assignee_id === null`; an owner id matches that `assignee_id`.
 *
 * @param rows - the candidate rows (already health-derived by the hook).
 * @param state - the active filter state.
 * @param owners - owner records used to resolve `assignee_id` → display name for
 *   search; defaults to none (search then simply never matches on owner name).
 */
export function applyWorkboardFilters(
  rows: WorkItemRow[],
  state: WorkboardFilterState,
  owners: ReadonlyArray<Owner> = [],
): WorkItemRow[] {
  const { search, filters, sortBy } = state;
  const ownerNameById = new Map(owners.map((owner) => [owner.id, owner.name]));
  const filtered = rows.filter(
    (row) =>
      searchMatches(search, row, ownerNameById) &&
      facetMatches(filters.type, row.type) &&
      ownerMatches(filters.owner, row.assignee_id) &&
      // Team facet reads `row.department` — the deprecated-but-retained
      // team-name carrier (the only client-side team-name source today).
      facetMatches(filters.team, row.department) &&
      facetMatches(filters.phase, row.phase) &&
      facetMatches(filters.priority, row.priority),
  );
  // `manual` keeps the incoming order; other keys sort the already-copied
  // `filtered` array (never the caller's `rows`).
  return sortBy === "manual"
    ? filtered
    : filtered.sort((a, b) => compareRowsBy(a, b, sortBy));
}

/**
 * Distinct team names present across `rows`, sorted alphabetically. Feeds
 * the toolbar's Team facet so its options always reflect the loaded data
 * (the toolbar never sees the rows directly — see its `teams` prop note).
 * Reads `row.department`, the deprecated-but-retained team-name carrier.
 *
 * @param rows - the rows to scan for team names.
 */
export function workboardTeams(rows: WorkItemRow[]): string[] {
  return [...new Set(rows.map((row) => row.department))].sort((a, b) =>
    a.localeCompare(b),
  );
}

// Back-compat alias for the Phase-2-exempt graph screen, which still imports the
// pre-rename name. Prefer `workboardTeams`; dropped when the graph is rewired
// (plan Task 2.3).
export const workboardDepartments = workboardTeams;

/** Clone a `Set`, toggling `value`'s membership; returns the new `Set`. Shared by
 * every facet control so a toggle always hands a fresh `Set` upward (controlled). */
export function toggledSet<T>(source: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(source);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}

/** One selectable facet option (value + human label). */
export interface FacetOption<T extends string = string> {
  readonly value: T;
  readonly label: string;
}

/** The option lists for all five facets, derived from the live owners/teams. */
export interface WorkboardFacetOptions {
  type: ReadonlyArray<FacetOption<WorkItemType>>;
  owner: ReadonlyArray<FacetOption>;
  team: ReadonlyArray<FacetOption>;
  phase: ReadonlyArray<FacetOption<Phase>>;
  priority: ReadonlyArray<FacetOption<Priority>>;
}

/** Phase facet order — the canonical loop (§1). */
const PHASE_FACET_ORDER: readonly Phase[] = ["plan", "execute", "review", "done"];

/**
 * Build the five facet option lists from the live `owners` + `teams`, so the
 * toolbar and the graph's filter cluster render identical, in-sync facets without
 * duplicating the label/order wiring. The owner facet leads with the
 * {@link FILTER_OWNER_UNASSIGNED} "Unassigned" option.
 */
export function buildFacetOptions(
  owners: ReadonlyArray<Owner>,
  teams: ReadonlyArray<string>,
): WorkboardFacetOptions {
  return {
    type: WORK_ITEM_TYPE_ORDER.map((type) => ({
      value: type,
      label: WORK_ITEM_TYPE_LABELS[type],
    })),
    owner: [
      { value: FILTER_OWNER_UNASSIGNED, label: "Unassigned" },
      ...owners.map((owner) => ({ value: owner.id, label: owner.name })),
    ],
    team: teams.map((team) => ({
      value: team,
      label: team,
    })),
    phase: PHASE_FACET_ORDER.map((phase) => ({
      value: phase,
      label: PHASE_LABELS[phase],
    })),
    priority: PRIORITY_ORDER.map((priority) => ({
      value: priority,
      label: PRIORITY_LABELS[priority],
    })),
  };
}

/**
 * Single versioned localStorage key for the whole persisted view blob. Mirrors
 * the per-column-width precedent (`workboard.table.colw.v1.<id>`): the version
 * suffix lets a schema change bump the key and ignore old payloads cleanly. The
 * `v2→v3` bump (this wave) orphans pre-one-surface blobs — they carried a `view:
 * table|kanban` key instead of `layout`, and lacked `sortBy`/`tasks` — so a fresh
 * default is used rather than mis-parsing them (no migration shim).
 */
export const FILTER_STORAGE_KEY = "workboard.filters.v3";

/**
 * The subset of {@link WorkboardFilterState} that survives a reload.
 * {@link WorkboardFilterState.selection} is DELIBERATELY absent — restoring stale
 * row ids across reloads is wrong, so selection always rehydrates empty. Every
 * field is optional: {@link parsePersistedView} omits any field that is missing
 * or fails validation, and the screen merges what survives over a fresh
 * {@link defaultWorkboardFilterState}.
 */
export interface PersistedView {
  search?: string;
  filters?: WorkboardFilters;
  layout?: WorkboardLayout;
  groupBy?: GroupByField;
  sortBy?: SortByField;
  tasks?: TasksVisibility;
  visibleColumns?: Set<ColumnId>;
}

/** Allowed value sets for every enum field, used to drop unknown members on read. */
const TYPE_VALUES = new Set<WorkItemType>(WORK_ITEM_TYPE_ORDER);
const PHASE_VALUES = new Set<Phase>(PHASE_FACET_ORDER);
const PRIORITY_VALUES = new Set<Priority>(PRIORITY_ORDER);
const COLUMN_VALUES = new Set<ColumnId>(COLUMN_IDS);
const GROUP_BY_VALUES = new Set<GroupByField>(GROUP_BY_FIELDS);
const LAYOUT_VALUES = new Set<WorkboardLayout>(WORKBOARD_LAYOUTS);
const SORT_BY_VALUES = new Set<SortByField>(SORT_BY_FIELDS);
const TASKS_VALUES = new Set<TasksVisibility>(TASKS_VISIBILITIES);

/**
 * Snapshot the persistable slice of the live view state as a {@link PersistedView}
 * OBJECT (the in-memory, `Set`-bearing form — NOT a JSON string). This is the
 * shape a saved view stores under {@link SavedView.config}, and the same object
 * {@link serializePersistedView} stringifies. {@link WorkboardFilterState.selection}
 * is DELIBERATELY excluded (stale row ids must never travel with a config). PURE —
 * clones every `Set` so the snapshot never aliases the live state's collections.
 */
export function currentViewConfig(filterState: WorkboardFilterState): PersistedView {
  return {
    search: filterState.search,
    layout: filterState.layout,
    groupBy: filterState.groupBy,
    sortBy: filterState.sortBy,
    tasks: filterState.tasks,
    filters: {
      type: new Set(filterState.filters.type),
      owner: new Set(filterState.filters.owner),
      team: new Set(filterState.filters.team),
      phase: new Set(filterState.filters.phase),
      priority: new Set(filterState.filters.priority),
    },
    visibleColumns: new Set(filterState.visibleColumns),
  };
}

/**
 * Convert a {@link PersistedView} object into its storable record — every `Set`
 * becomes an array, and only PRESENT fields are emitted (so a partial config
 * round-trips without spurious keys). Shared by {@link serializePersistedView}
 * and {@link serializeSavedViews} so both write the exact same field shape.
 */
function persistedViewToStorable(config: PersistedView): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (config.search !== undefined) out.search = config.search;
  if (config.layout !== undefined) out.layout = config.layout;
  if (config.groupBy !== undefined) out.groupBy = config.groupBy;
  if (config.sortBy !== undefined) out.sortBy = config.sortBy;
  if (config.tasks !== undefined) out.tasks = config.tasks;
  if (config.filters !== undefined) {
    out.filters = {
      type: [...config.filters.type],
      owner: [...config.filters.owner],
      team: [...config.filters.team],
      phase: [...config.filters.phase],
      priority: [...config.filters.priority],
    };
  }
  if (config.visibleColumns !== undefined) {
    out.visibleColumns = [...config.visibleColumns];
  }
  return out;
}

/**
 * Serialize the persistable slice of the view state to a JSON string for
 * {@link FILTER_STORAGE_KEY}. The five filter `Set`s and `visibleColumns` become
 * arrays; `selection` is NEVER written (see {@link PersistedView}). PURE — reads
 * only its argument and returns a string. Built from {@link currentViewConfig}
 * (which always populates every field), so the output stays the full, ordered blob.
 */
export function serializePersistedView(
  filterState: WorkboardFilterState,
): string {
  return JSON.stringify(persistedViewToStorable(currentViewConfig(filterState)));
}

/** Keep only the string members of an array; non-arrays yield an empty list. */
function stringArrayOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/** Build a `Set` of the array's members that are present in `allowed`. */
function enumSetOf<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
): Set<T> {
  const result = new Set<T>();
  if (!Array.isArray(value)) return result;
  for (const item of value) {
    if (typeof item === "string" && allowed.has(item as T)) {
      result.add(item as T);
    }
  }
  return result;
}

/**
 * Coerce/validate an UNKNOWN record into a {@link PersistedView}, keeping ONLY the
 * fields that validate — unknown enum members are dropped, garbage/missing fields
 * are omitted. A non-object input yields an empty `{}` (everything falls back).
 * The `owner`/`team` facets are free-form ids/names, so they are kept as-is
 * (string members only); `selection` is never read.
 *
 * Shared by {@link parsePersistedView} (the FILTER_STORAGE_KEY blob) and
 * {@link parseSavedViews} (each saved view's embedded config), so a stale/garbage
 * config is sanitised the same way rather than trusted.
 */
export function coercePersistedView(record: unknown): PersistedView {
  const result: PersistedView = {};
  if (typeof record !== "object" || record === null) return result;
  const rec = record as Record<string, unknown>;

  if (typeof rec.search === "string") {
    result.search = rec.search;
  }
  if (
    typeof rec.layout === "string" &&
    LAYOUT_VALUES.has(rec.layout as WorkboardLayout)
  ) {
    result.layout = rec.layout as WorkboardLayout;
  }
  if (
    typeof rec.groupBy === "string" &&
    GROUP_BY_VALUES.has(rec.groupBy as GroupByField)
  ) {
    result.groupBy = rec.groupBy as GroupByField;
  }
  if (
    typeof rec.sortBy === "string" &&
    SORT_BY_VALUES.has(rec.sortBy as SortByField)
  ) {
    result.sortBy = rec.sortBy as SortByField;
  }
  if (
    typeof rec.tasks === "string" &&
    TASKS_VALUES.has(rec.tasks as TasksVisibility)
  ) {
    result.tasks = rec.tasks as TasksVisibility;
  }
  if (Array.isArray(rec.visibleColumns)) {
    // Only restore a NON-empty validated set. An all-unknown array (e.g. after a
    // future column rename without a key bump) collapses to an empty set — which
    // is truthy and would survive the screen's `?? default` merge, leaving a
    // table with zero data columns. Omitting it lets the all-visible default win.
    const cols = enumSetOf(rec.visibleColumns, COLUMN_VALUES);
    if (cols.size > 0) result.visibleColumns = cols;
  }
  if (typeof rec.filters === "object" && rec.filters !== null) {
    const filters = rec.filters as Record<string, unknown>;
    result.filters = {
      type: enumSetOf(filters.type, TYPE_VALUES),
      owner: new Set(stringArrayOf(filters.owner)),
      team: new Set(stringArrayOf(filters.team)),
      phase: enumSetOf(filters.phase, PHASE_VALUES),
      priority: enumSetOf(filters.priority, PRIORITY_VALUES),
    };
  }

  return result;
}

/**
 * Safe-parse a persisted view blob from storage. NEVER throws: malformed JSON, a
 * non-object payload, or a `null`/absent value all return `null` (behave as if
 * nothing was stored). Otherwise delegates to {@link coercePersistedView}, which
 * returns a {@link PersistedView} carrying ONLY the fields that validated (the
 * caller merges what survives over the defaults).
 */
export function parsePersistedView(raw: string | null): PersistedView | null {
  if (raw === null) return null;
  let blob: unknown;
  try {
    blob = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof blob !== "object" || blob === null) return null;
  return coercePersistedView(blob);
}

/**
 * Single versioned localStorage key for the named/saved view LIST — a separate key
 * from {@link FILTER_STORAGE_KEY} (which holds the single last-applied config), so
 * the two persistence concerns never collide. The version suffix lets a schema
 * bump ignore old payloads cleanly; the `v2→v3` bump orphans pre-one-surface
 * saved views (they stored `view` instead of `layout`, no `sortBy`/`tasks`).
 */
export const SAVED_VIEWS_KEY = "workboard.savedViews.v3";

/**
 * One named, user-saved Workboard view: a stable {@link id}, a display {@link name},
 * and the {@link PersistedView} {@link config} captured when it was saved (selection
 * is intentionally NOT part of a config). Applying a saved view hydrates the live
 * filter state from `config`; deleting removes it by `id`.
 */
export interface SavedView {
  /** Stable, collision-free id (generated at save time; survives reloads). */
  id: string;
  /** User-supplied display name (non-empty). */
  name: string;
  /** The snapshotted view configuration (see {@link currentViewConfig}). */
  config: PersistedView;
}

/**
 * Serialize a list of saved views to a JSON string for {@link SAVED_VIEWS_KEY}.
 * Each view's `config` is reduced to its storable record (every `Set` → array)
 * via the SAME builder {@link serializePersistedView} uses, so configs round-trip
 * identically. PURE — reads only its argument.
 */
export function serializeSavedViews(views: SavedView[]): string {
  return JSON.stringify(
    views.map((view) => ({
      id: view.id,
      name: view.name,
      config: persistedViewToStorable(view.config),
    })),
  );
}

/**
 * Safe-parse the saved-views list from storage. NEVER throws: malformed JSON, a
 * `null`/absent value, or a non-array payload all yield `[]`. Each entry is kept
 * only when it carries a non-empty string `id` AND a non-empty (trimmed) string
 * `name`; its `config` is run through {@link coercePersistedView} so a stale or
 * garbage embedded config is SANITISED (unknown enums dropped) rather than trusted
 * — an otherwise-valid entry is never dropped just because its config is junk.
 */
export function parseSavedViews(raw: string | null): SavedView[] {
  if (raw === null) return [];
  let blob: unknown;
  try {
    blob = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(blob)) return [];
  const result: SavedView[] = [];
  for (const entry of blob) {
    if (typeof entry !== "object" || entry === null) continue;
    const rec = entry as Record<string, unknown>;
    const { id, name } = rec;
    if (typeof id !== "string" || id === "") continue;
    if (typeof name !== "string" || name.trim() === "") continue;
    result.push({ id, name, config: coercePersistedView(rec.config) });
  }
  return result;
}
