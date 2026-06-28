import { useEffect, useRef } from "react";

import { FilterIcon, PlusIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";

import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Tabs,
  TabsList,
  TabsTrigger,
  PHASE_LABELS,
  PRIORITY_LABELS,
  PRIORITY_ORDER,
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
  toggledSet,
  type ColumnId,
  type GroupByField,
  type WorkboardFilterState,
} from "../filter-state";

import { FacetFilterMenu } from "./FacetFilterMenu";

/**
 * Workboard TOOLBAR (DESIGN §2 / §4 / §5) — the single control surface that
 * mutates the shared {@link WorkboardFilterState} and triggers the board's
 * create / bulk actions.
 *
 * This is a CONTROLLED component: it owns no view state itself (the parent holds
 * the `WorkboardFilterState` and re-renders the Table from the same value), so
 * every change clones the touched collection and hands a NEW state object to
 * {@link WorkboardToolbarProps.onChange} — it never mutates the incoming `value`
 * or its `Set`s in place. It holds NO local state at all: "set phase"/"set
 * priority" are explicit per-click ACTIONS (each menu item applies its own value
 * through {@link WorkboardToolbarProps.onBulkApply}), so there is no "current
 * bulk value" to track.
 *
 * House grammar (DESIGN §5): every control is a `@product-suite/ui` primitive —
 * no bare `<select>`/`<button>`. The five facet filters are multi-select, so
 * they are built from `DropdownMenu` + `DropdownMenuCheckboxItem` (the single-
 * value suite `*Select`s cannot express an "all / none selected" facet); the
 * bulk cluster uses `DropdownMenu` + `DropdownMenuItem` so every item click is an
 * unconditional action (a value-bound `*Select` would NOT fire on reselecting the
 * already-chosen value, silently dropping the apply).
 */
export interface WorkboardToolbarProps {
  /** The shared, fully-defaulted Workboard view state this toolbar mutates. */
  value: WorkboardFilterState;
  /** Fired with a NEW state object on every change (controlled contract). */
  onChange: (next: WorkboardFilterState) => void;
  /** Active board view; drives the leading Table/Kanban segmented switcher. */
  view: "table" | "kanban";
  /** Fired when the user switches between the Table and Kanban views. */
  onViewChange: (view: "table" | "kanban") => void;
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
  /**
   * Optional handler for the Columns menu's global "Reset column widths" item.
   * Threaded from the screen down to the table's `useColumnWidths` reset; the
   * item only renders when wired, so read-only embeds stay unchanged.
   */
  onResetColumnWidths?: () => void;
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

/**
 * The Workboard toolbar — search, facet filters, group-by, column visibility,
 * the create action, and a selection-scoped bulk-action cluster.
 *
 * @see WorkboardToolbarProps for the (deviation-documented) prop contract.
 */
export function WorkboardToolbar({
  value,
  onChange,
  view,
  onViewChange,
  owners,
  departments,
  selectedCount,
  onNewItem,
  onBulkApply,
  onResetColumnWidths,
}: Readonly<WorkboardToolbarProps>) {
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

  const togglePriority = (priority: Priority): void => {
    onChange({
      ...value,
      filters: { ...filters, priority: toggledSet(filters.priority, priority) },
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
  const priorityOptions = PRIORITY_ORDER.map((priority) => ({
    value: priority,
    label: PRIORITY_LABELS[priority],
  }));
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

  // '/' search shortcut (#11) — focus the search box when "/" is pressed anywhere
  // on the page, UNLESS the user is already typing in a field
  // (input/textarea/contenteditable), so the key never hijacks a literal slash
  // mid-edit. The <kbd>/</kbd> beside the input advertises the affordance.
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focusSearchOnSlash = (event: KeyboardEvent): void => {
      if (event.key !== "/") return;
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", focusSearchOnSlash);
    return () => {
      window.removeEventListener("keydown", focusSearchOnSlash);
    };
  }, []);

  return (
    <div
      role="toolbar"
      aria-label="Workboard controls"
      aria-orientation="horizontal"
      className="flex flex-wrap items-center gap-2"
    >
      {/* View switcher — Table / Kanban. Leads the toolbar (the page header and
          its standalone tabs row were removed; this is now the sole view control). */}
      <Tabs
        value={view}
        onValueChange={(next) =>
          onViewChange(next === "kanban" ? "kanban" : "table")
        }
      >
        <TabsList aria-label="Workboard view">
          <TabsTrigger value="table">Table</TabsTrigger>
          <TabsTrigger value="kanban">Kanban</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Search */}
      <div className="relative">
        <Input
          ref={searchRef}
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
      <FacetFilterMenu
        label="Priority"
        options={priorityOptions}
        selected={filters.priority}
        onToggle={togglePriority}
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
          {onResetColumnWidths ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  onResetColumnWidths();
                }}
              >
                Reset column widths
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Selection-scoped bulk actions */}
      {hasSelection ? (
        <fieldset
          aria-label="Bulk actions"
          className={cn(
            "m-0 flex min-w-0 flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-2 py-1",
          )}
        >
          <span className="text-xs font-medium text-foreground" aria-live="polite">
            {selectedCount} selected
          </span>

          {/* Set phase — every item click is an unconditional bulk apply. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" aria-label="Set phase">
                Set phase
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-40">
              <DropdownMenuLabel>Set phase</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {phaseOptions.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onSelect={() => {
                    onBulkApply({ phase: option.value });
                  }}
                >
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Set priority — every item click is an unconditional bulk apply. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" aria-label="Set priority">
                Set priority
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-40">
              <DropdownMenuLabel>Set priority</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {priorityOptions.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onSelect={() => {
                    onBulkApply({ priority: option.value });
                  }}
                >
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size="sm"
            onClick={clearSelection}
            aria-label="Clear selection"
          >
            <XIcon className="size-4" />
            Clear selection
          </Button>
        </fieldset>
      ) : null}

      {/* New work item — always the last (rightmost) control. ml-auto pins it to
          the right edge regardless of whether the bulk cluster is present. */}
      <Button size="sm" className="ml-auto" onClick={onNewItem}>
        <PlusIcon className="size-4" />
        New work item
      </Button>
    </div>
  );
}
