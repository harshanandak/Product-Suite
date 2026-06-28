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
  /** Free-text search across title, tags, department, type label, and owner name. */
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
 * Case-insensitive free-text match over a row's user-visible text — its title,
 * tags, department, type label, AND owner display name. The row stores only
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
    row.department,
    WORK_ITEM_TYPE_LABELS[row.type],
    ...row.tags,
    ...(ownerName === undefined ? [] : [ownerName]),
  ];
  return haystacks.some((field) => field.toLowerCase().includes(needle));
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
 *  - search: case-insensitive substring over title, tags, department, type
 *    label, AND owner display name (resolved from `owners`).
 *  - type / phase / priority / department: membership in the matching facet set.
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
  const { search, filters } = state;
  const ownerNameById = new Map(owners.map((owner) => [owner.id, owner.name]));
  return rows.filter(
    (row) =>
      searchMatches(search, row, ownerNameById) &&
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

/** The option lists for all five facets, derived from the live owners/departments. */
export interface WorkboardFacetOptions {
  type: ReadonlyArray<FacetOption<WorkItemType>>;
  owner: ReadonlyArray<FacetOption>;
  department: ReadonlyArray<FacetOption>;
  phase: ReadonlyArray<FacetOption<Phase>>;
  priority: ReadonlyArray<FacetOption<Priority>>;
}

/** Phase facet order — the canonical loop (§1). */
const PHASE_FACET_ORDER: readonly Phase[] = ["plan", "execute", "review", "done"];

/**
 * Build the five facet option lists from the live `owners` + `departments`, so the
 * toolbar and the graph's filter cluster render identical, in-sync facets without
 * duplicating the label/order wiring. The owner facet leads with the
 * {@link FILTER_OWNER_UNASSIGNED} "Unassigned" option.
 */
export function buildFacetOptions(
  owners: ReadonlyArray<Owner>,
  departments: ReadonlyArray<string>,
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
    department: departments.map((department) => ({
      value: department,
      label: department,
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
 * The board view the user last had open — Table (default) or Kanban. Persisted
 * alongside {@link WorkboardFilterState} so a reload restores the same surface.
 */
export type WorkboardView = "table" | "kanban";

/**
 * Single versioned localStorage key for the whole persisted view blob. Mirrors
 * the per-column-width precedent (`workboard.table.colw.v1.<id>`): a `v1` suffix
 * lets a future schema change bump to `v2` and ignore old payloads cleanly.
 */
export const FILTER_STORAGE_KEY = "workboard.filters.v1";

/**
 * The subset of {@link WorkboardFilterState} (plus the active {@link WorkboardView})
 * that survives a reload. {@link WorkboardFilterState.selection} is DELIBERATELY
 * absent — restoring stale row ids across reloads is wrong, so selection always
 * rehydrates empty. Every field is optional: {@link parsePersistedView} omits any
 * field that is missing or fails validation, and the screen merges what survives
 * over a fresh {@link defaultWorkboardFilterState}.
 */
export interface PersistedView {
  search?: string;
  filters?: WorkboardFilters;
  groupBy?: GroupByField;
  visibleColumns?: Set<ColumnId>;
  view?: WorkboardView;
}

/** Allowed value sets for every enum field, used to drop unknown members on read. */
const TYPE_VALUES = new Set<WorkItemType>(WORK_ITEM_TYPE_ORDER);
const PHASE_VALUES = new Set<Phase>(PHASE_FACET_ORDER);
const PRIORITY_VALUES = new Set<Priority>(PRIORITY_ORDER);
const COLUMN_VALUES = new Set<ColumnId>(COLUMN_IDS);
const GROUP_BY_VALUES = new Set<GroupByField>([
  "none",
  "department",
  "phase",
  "priority",
  "type",
]);
const VIEW_VALUES = new Set<WorkboardView>(["table", "kanban"]);

/**
 * Serialize the persistable slice of the view state to a JSON string for
 * {@link FILTER_STORAGE_KEY}. The five filter `Set`s and `visibleColumns` become
 * arrays; `selection` is NEVER written (see {@link PersistedView}). PURE — reads
 * only its argument and returns a string.
 */
export function serializePersistedView(input: {
  filterState: WorkboardFilterState;
  view: WorkboardView;
}): string {
  const { filterState, view } = input;
  return JSON.stringify({
    search: filterState.search,
    groupBy: filterState.groupBy,
    filters: {
      type: [...filterState.filters.type],
      owner: [...filterState.filters.owner],
      department: [...filterState.filters.department],
      phase: [...filterState.filters.phase],
      priority: [...filterState.filters.priority],
    },
    visibleColumns: [...filterState.visibleColumns],
    view,
  });
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
 * Safe-parse a persisted view blob from storage. NEVER throws: malformed JSON, a
 * non-object payload, or a `null`/absent value all return `null` (behave as if
 * nothing was stored). Otherwise returns a {@link PersistedView} carrying ONLY the
 * fields that validated — unknown enum members are dropped, garbage/missing
 * fields are omitted (the caller merges what survives over the defaults). The
 * `owner`/`department` facets are free-form ids/names, so they are kept as-is
 * (string members only); `selection` is never read back.
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
  const record = blob as Record<string, unknown>;
  const result: PersistedView = {};

  if (typeof record.search === "string") {
    result.search = record.search;
  }
  if (
    typeof record.groupBy === "string" &&
    GROUP_BY_VALUES.has(record.groupBy as GroupByField)
  ) {
    result.groupBy = record.groupBy as GroupByField;
  }
  if (
    typeof record.view === "string" &&
    VIEW_VALUES.has(record.view as WorkboardView)
  ) {
    result.view = record.view as WorkboardView;
  }
  if (Array.isArray(record.visibleColumns)) {
    // Only restore a NON-empty validated set. An all-unknown array (e.g. after a
    // future column rename without a key bump) collapses to an empty set — which
    // is truthy and would survive the screen's `?? default` merge, leaving a
    // table with zero data columns. Omitting it lets the all-visible default win.
    const cols = enumSetOf(record.visibleColumns, COLUMN_VALUES);
    if (cols.size > 0) result.visibleColumns = cols;
  }
  if (typeof record.filters === "object" && record.filters !== null) {
    const filters = record.filters as Record<string, unknown>;
    result.filters = {
      type: enumSetOf(filters.type, TYPE_VALUES),
      owner: new Set(stringArrayOf(filters.owner)),
      department: new Set(stringArrayOf(filters.department)),
      phase: enumSetOf(filters.phase, PHASE_VALUES),
      priority: enumSetOf(filters.priority, PRIORITY_VALUES),
    };
  }

  return result;
}
