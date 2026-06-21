import * as React from "react";

import { FilterIcon, PlusIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";

import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  PHASE_LABELS,
  PRIORITY_ORDER,
  PhaseSelect,
  PrioritySelect,
  WORK_ITEM_TYPE_LABELS,
  WORK_ITEM_TYPE_ORDER,
  cn,
  type Phase,
  type Priority,
  type WorkItemType,
} from "@product-suite/ui";

import type { Owner, WorkItemPatch } from "@/data/work-items";

import {
  COLUMN_IDS,
  FILTER_OWNER_UNASSIGNED,
  type ColumnId,
  type GroupByField,
  type WorkboardFilterState,
} from "../filter-state";

/**
 * Workboard TOOLBAR (DESIGN §2 / §4 / §5) — the single control surface that
 * mutates the shared {@link WorkboardFilterState} and triggers the board's
 * create / bulk actions.
 *
 * This is a CONTROLLED component: it owns no view state itself (the parent holds
 * the `WorkboardFilterState` and re-renders the Table from the same value), so
 * every change clones the touched collection and hands a NEW state object to
 * {@link WorkboardToolbarProps.onChange} — it never mutates the incoming `value`
 * or its `Set`s in place. The only local state is the two bulk pickers' bound
 * values: "set phase"/"set priority" are ACTIONS with no field on the row to
 * read back from, so each needs a controlled `value` of its own (mirroring the
 * Table's `bulkPhase`), and applies through {@link WorkboardToolbarProps.onBulkApply}.
 *
 * House grammar (DESIGN §5): every control is a `@product-suite/ui` primitive —
 * no bare `<select>`/`<button>`. The four facet filters are multi-select, so
 * they are built from `DropdownMenu` + `DropdownMenuCheckboxItem` (the single-
 * value suite `*Select`s cannot express an "all / none selected" facet); the
 * suite `PhaseSelect`/`PrioritySelect` back the bulk cluster, where a single
 * required value is exactly right.
 */
export interface WorkboardToolbarProps {
  /** The shared, fully-defaulted Workboard view state this toolbar mutates. */
  value: WorkboardFilterState;
  /** Fired with a NEW state object on every change (controlled contract). */
  onChange: (next: WorkboardFilterState) => void;
  /** The pickable owners; feeds the Owner facet filter (plus "Unassigned"). */
  owners: ReadonlyArray<Owner>;
  /**
   * DEVIATION (documented): the verbatim brief props list no department source,
   * yet the Department facet filter needs the workspace-defined department names
   * to populate its menu. The toolbar never sees `items`, so — mirroring the
   * precedent of {@link WorkboardTable}'s added `onUpdateItem` — the distinct
   * department names are surfaced as a prop. The parent derives them from the
   * loaded rows. The filter renders no options (and stays inert) when empty.
   */
  departments: ReadonlyArray<string>;
  /** Count of currently-selected rows; drives the bulk-action cluster. */
  selectedCount: number;
  /** Fired when the "New work item" button is pressed. */
  onNewItem: () => void;
  /** Apply a patch to the parent's current selection (e.g. bulk phase/priority). */
  onBulkApply: (patch: WorkItemPatch) => void;
}

/** Group-by options in canonical order — labels for the 5 {@link GroupByField}s. */
const GROUP_BY_LABELS: Record<GroupByField, string> = {
  none: "None",
  department: "Department",
  phase: "Phase",
  priority: "Priority",
  type: "Type",
};

/** Render order for the group-by menu (matches {@link GroupByField}). */
const GROUP_BY_ORDER: readonly GroupByField[] = [
  "none",
  "department",
  "phase",
  "priority",
  "type",
];

/** Human labels for the toggleable columns (sentence case). */
const COLUMN_LABELS: Record<ColumnId, string> = {
  name: "Name",
  type: "Type",
  phase: "Phase",
  priority: "Priority",
  owner: "Owner",
  due: "Due",
  tags: "Tags",
  source: "Source",
};

/** Clone a `Set`, toggling `value`'s membership; returns the new `Set`. */
function toggledSet<T>(source: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(source);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}

/**
 * A single multi-select facet filter rendered as a checkbox dropdown. Generic
 * over the facet's value type so Type/Phase/Owner/Department all share one
 * keyboard-accessible, token-styled menu. Each toggle hands a brand-new `Set`
 * up via `onToggle` — the parent splices it into a fresh state object.
 */
function FacetFilterMenu<T extends string>({
  label,
  options,
  selected,
  onToggle,
}: Readonly<{
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  selected: ReadonlySet<T>;
  onToggle: (value: T) => void;
}>) {
  const count = selected.size;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={`Filter by ${label.toLowerCase()}`}
        >
          {label}
          {count > 0 ? (
            <span
              data-slot="facet-count"
              className="ml-1 rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground"
            >
              {count}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={selected.has(option.value)}
            // Keep the menu open across multiple toggles.
            onSelect={(event) => {
              event.preventDefault();
            }}
            onCheckedChange={() => {
              onToggle(option.value);
            }}
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The Workboard toolbar — search, facet filters, group-by, column visibility,
 * the create action, and a selection-scoped bulk-action cluster.
 *
 * @see WorkboardToolbarProps for the (deviation-documented) prop contract.
 */
export function WorkboardToolbar({
  value,
  onChange,
  owners,
  departments,
  selectedCount,
  onNewItem,
  onBulkApply,
}: Readonly<WorkboardToolbarProps>) {
  // Bulk pickers are actions, not bound fields — they need their own controlled
  // value (the suite selects require a non-null `value`). Default to the first
  // option in canonical order.
  const [bulkPhase, setBulkPhase] = React.useState<Phase>("plan");
  const [bulkPriority, setBulkPriority] = React.useState<Priority>(
    PRIORITY_ORDER[0],
  );

  const { filters } = value;
  const activeFilterCount =
    filters.type.size +
    filters.owner.size +
    filters.department.size +
    filters.phase.size +
    filters.priority.size;

  // --- Filter facets ------------------------------------------------------

  const toggleType = (type: WorkItemType): void => {
    onChange({
      ...value,
      filters: { ...filters, type: toggledSet(filters.type, type) },
    });
  };

  const togglePhase = (phase: Phase): void => {
    onChange({
      ...value,
      filters: { ...filters, phase: toggledSet(filters.phase, phase) },
    });
  };

  const toggleOwner = (ownerId: string): void => {
    onChange({
      ...value,
      filters: { ...filters, owner: toggledSet(filters.owner, ownerId) },
    });
  };

  const toggleDepartment = (department: string): void => {
    onChange({
      ...value,
      filters: {
        ...filters,
        department: toggledSet(filters.department, department),
      },
    });
  };

  /** Empty ONLY the four facet sets; leave search/groupBy/columns/selection. */
  const clearFilters = (): void => {
    onChange({
      ...value,
      filters: {
        type: new Set(),
        owner: new Set(),
        department: new Set(),
        phase: new Set(),
        priority: new Set(),
      },
    });
  };

  const typeOptions = WORK_ITEM_TYPE_ORDER.map((type) => ({
    value: type,
    label: WORK_ITEM_TYPE_LABELS[type],
  }));
  const phaseOptions = (["plan", "execute", "review", "done"] as const).map(
    (phase) => ({ value: phase, label: PHASE_LABELS[phase] }),
  );
  const ownerOptions: ReadonlyArray<{ value: string; label: string }> = [
    { value: FILTER_OWNER_UNASSIGNED, label: "Unassigned" },
    ...owners.map((owner) => ({ value: owner.id, label: owner.name })),
  ];
  const departmentOptions = departments.map((department) => ({
    value: department,
    label: department,
  }));

  // --- Group-by & columns -------------------------------------------------

  const setGroupBy = (groupBy: GroupByField): void => {
    onChange({ ...value, groupBy });
  };

  const toggleColumn = (column: ColumnId): void => {
    onChange({
      ...value,
      visibleColumns: toggledSet(value.visibleColumns, column),
    });
  };

  // --- Search & selection -------------------------------------------------

  const setSearch = (search: string): void => {
    onChange({ ...value, search });
  };

  const clearSelection = (): void => {
    onChange({ ...value, selection: new Set() });
  };

  const hasSelection = selectedCount > 0;

  return (
    <div
      role="toolbar"
      aria-label="Workboard controls"
      aria-orientation="horizontal"
      className="flex flex-wrap items-center gap-2"
    >
      {/* Search */}
      <div className="relative">
        <Input
          type="search"
          value={value.search}
          aria-label="Search work items"
          placeholder="Search work items"
          className="w-56 pr-8"
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border bg-muted px-1 text-xs text-muted-foreground"
        >
          /
        </kbd>
      </div>

      {/* Facet filters */}
      <span
        className="inline-flex items-center text-muted-foreground"
        aria-hidden="true"
      >
        <FilterIcon className="size-4" />
      </span>
      <FacetFilterMenu
        label="Type"
        options={typeOptions}
        selected={filters.type}
        onToggle={toggleType}
      />
      <FacetFilterMenu
        label="Owner"
        options={ownerOptions}
        selected={filters.owner}
        onToggle={toggleOwner}
      />
      <FacetFilterMenu
        label="Department"
        options={departmentOptions}
        selected={filters.department}
        onToggle={toggleDepartment}
      />
      <FacetFilterMenu
        label="Phase"
        options={phaseOptions}
        selected={filters.phase}
        onToggle={togglePhase}
      />

      {activeFilterCount > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={clearFilters}
          aria-label={`Clear filters (${activeFilterCount} active)`}
        >
          <XIcon className="size-4" />
          Clear filters
          <span className="text-muted-foreground">({activeFilterCount})</span>
        </Button>
      ) : null}

      {/* Group by */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" aria-label="Group by">
            Group: {GROUP_BY_LABELS[value.groupBy]}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-40">
          <DropdownMenuLabel>Group by</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={value.groupBy}
            onValueChange={(next) => {
              setGroupBy(next as GroupByField);
            }}
          >
            {GROUP_BY_ORDER.map((field) => (
              <DropdownMenuRadioItem key={field} value={field}>
                {GROUP_BY_LABELS[field]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Column visibility */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" aria-label="Columns">
            <SlidersHorizontalIcon className="size-4" />
            Columns
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-40">
          <DropdownMenuLabel>Columns</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {COLUMN_IDS.map((column) => (
            <DropdownMenuCheckboxItem
              key={column}
              checked={value.visibleColumns.has(column)}
              onSelect={(event) => {
                event.preventDefault();
              }}
              onCheckedChange={() => {
                toggleColumn(column);
              }}
            >
              {COLUMN_LABELS[column]}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* New work item */}
      <Button size="sm" className="ml-auto" onClick={onNewItem}>
        <PlusIcon className="size-4" />
        New work item
      </Button>

      {/* Selection-scoped bulk actions */}
      {hasSelection ? (
        <div
          role="group"
          aria-label="Bulk actions"
          className={cn(
            "flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-2 py-1",
          )}
        >
          <span className="text-xs font-medium text-foreground" aria-live="polite">
            {selectedCount} selected
          </span>

          <label className="sr-only" htmlFor="bulk-phase">
            Set phase
          </label>
          <PhaseSelect
            id="bulk-phase"
            size="sm"
            aria-label="Set phase"
            value={bulkPhase}
            onValueChange={(next) => {
              setBulkPhase(next);
              onBulkApply({ phase: next });
            }}
          />

          <label className="sr-only" htmlFor="bulk-priority">
            Set priority
          </label>
          <PrioritySelect
            id="bulk-priority"
            size="sm"
            aria-label="Set priority"
            value={bulkPriority}
            onValueChange={(next) => {
              setBulkPriority(next);
              onBulkApply({ priority: next });
            }}
          />

          <Button
            variant="ghost"
            size="sm"
            onClick={clearSelection}
            aria-label="Clear selection"
          >
            <XIcon className="size-4" />
            Clear selection
          </Button>
        </div>
      ) : null}
    </div>
  );
}
