import type { Phase, Priority, WorkItemType } from "@product-suite/ui";

import type { WorkItemRow } from "@/data/work-items";

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
 * The fields the rows may be grouped into swimlanes by. `"none"` is a flat list.
 * `"department"` matches the Table's current default grouping.
 */
export type GroupByField = "none" | "department" | "phase" | "priority" | "type";

/**
 * Owner-filter sentinel for "no owner" (items routed to a department queue —
 * `assignee_id: null`). Used INSTEAD of `null` inside the `owner` filter set so
 * the set stays a homogeneous `Set<string>`; the Table maps it back to a
 * `assignee_id === null` predicate.
 */
export const FILTER_OWNER_UNASSIGNED = "__unassigned__";

/**
 * The structured filter facets. Each facet is a `Set` of selected values; an
 * EMPTY set means "no filter on this facet" (show all). The `owner` set holds
 * owner ids plus the {@link FILTER_OWNER_UNASSIGNED} sentinel; `department`
 * holds department names.
 */
export interface WorkboardFilters {
  /** Selected work-item types; empty = all types. */
  type: Set<WorkItemType>;
  /** Selected owner ids (or {@link FILTER_OWNER_UNASSIGNED}); empty = all owners. */
  owner: Set<string>;
  /** Selected department names; empty = all departments. */
  department: Set<string>;
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
  /** Free-text search across the row's title (and, optionally, tags). */
  search: string;
  /** Structured facet filters (see {@link WorkboardFilters}). */
  filters: WorkboardFilters;
  /** Current swimlane grouping (`"department"` by default). */
  groupBy: GroupByField;
  /** Which columns are shown, in {@link COLUMN_IDS} order. */
  visibleColumns: Set<ColumnId>;
  /** Selected work-item ids (row-selection checkboxes). */
  selection: Set<string>;
}

/**
 * Fresh, fully-defaulted {@link WorkboardFilterState}: no search, no facet
 * filters, grouped by department (matching the Table's existing behaviour), all
 * columns visible, nothing selected.
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
      department: new Set(),
      phase: new Set(),
      priority: new Set(),
    },
    groupBy: "department",
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
 * Case-insensitive free-text match over a row's title and its tags. An empty (or
 * whitespace-only) query passes everything.
 */
function searchMatches(query: string, row: WorkItemRow): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  if (row.title.toLowerCase().includes(needle)) return true;
  return row.tags.some((tag) => tag.toLowerCase().includes(needle));
}

/**
 * Apply the shared {@link WorkboardFilterState}'s search + facet filters to a set
 * of rows, returning the rows that pass ALL active criteria. PURE — never mutates
 * its inputs and reads no view state beyond `search` + `filters` (group-by,
 * column visibility, and selection are render concerns the Table owns).
 *
 * The Table never filters; the screen runs this once and hands the Table the
 * already-filtered `rows`, so the two surfaces can never desync (DESIGN §4).
 *
 * Filter semantics — an EMPTY facet set is "no filter" (show all):
 *  - search: case-insensitive substring over title AND tags.
 *  - type / phase / priority / department: membership in the matching facet set.
 *  - owner: the {@link FILTER_OWNER_UNASSIGNED} sentinel matches
 *    `assignee_id === null`; an owner id matches that `assignee_id`.
 *
 * @param rows - the candidate rows (already health-derived by the hook).
 * @param state - the active filter state.
 */
export function applyWorkboardFilters(
  rows: WorkItemRow[],
  state: WorkboardFilterState,
): WorkItemRow[] {
  const { search, filters } = state;
  return rows.filter(
    (row) =>
      searchMatches(search, row) &&
      facetMatches(filters.type, row.type) &&
      ownerMatches(filters.owner, row.assignee_id) &&
      facetMatches(filters.department, row.department) &&
      facetMatches(filters.phase, row.phase) &&
      facetMatches(filters.priority, row.priority),
  );
}

/**
 * Distinct department names present across `rows`, sorted alphabetically. Feeds
 * the toolbar's Department facet so its options always reflect the loaded data
 * (the toolbar never sees the rows directly — see its `departments` prop note).
 *
 * @param rows - the rows to scan for department names.
 */
export function workboardDepartments(rows: WorkItemRow[]): string[] {
  return [...new Set(rows.map((row) => row.department))].sort((a, b) =>
    a.localeCompare(b),
  );
}
