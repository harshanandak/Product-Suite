import { useEffect, useRef, useState } from "react";

import {
  BookmarkIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  GROUP_BY_FIELDS,
  SORT_BY_FIELDS,
  TASKS_VISIBILITIES,
  WORKBOARD_LAYOUTS,
  toggledSet,
  type ColumnId,
  type GroupByField,
  type SavedView,
  type SortByField,
  type TasksVisibility,
  type WorkboardFilterState,
  type WorkboardLayout,
} from "../filter-state";

import type { ColumnFilter } from "../table/WorkboardTable";

import { FacetFilterMenu } from "./FacetFilterMenu";

/**
 * The facets that live in the TABLE column headers (Type / Phase / Priority /
 * Owner). Kanban has no headers, so for that view they fall back into the
 * toolbar — same `columnFilters` config the table consumes, in this order.
 */
const HEADER_FACETS: ReadonlyArray<{ id: ColumnId; label: string }> = [
  { id: "type", label: "Type" },
  { id: "phase", label: "Status" },
  { id: "priority", label: "Priority" },
  { id: "owner", label: "Owner" },
];

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
  /**
   * Per-column facet configs (Type / Phase / Priority / Owner). The List layout
   * renders these in its column headers; Board/Graph have no headers, so the
   * toolbar renders them for those layouts. Both consume the SAME config, so a
   * filter set anywhere flows through the shared filter state. Omitted on
   * surfaces without column facets.
   */
  columnFilters?: Partial<Record<ColumnId, ColumnFilter>>;
  /** The pickable owners; feeds the Owner facet filter (plus "Unassigned"). */
  owners: ReadonlyArray<Owner>;
  /**
   * DEVIATION (documented): the verbatim brief props list no team source,
   * yet the Team facet filter needs the workspace-defined team names
   * to populate its menu. The toolbar never sees `items`, so — mirroring the
   * precedent of {@link WorkboardTable}'s added `onUpdateItem` — the distinct
   * team names are surfaced as a prop. The parent derives them from the
   * loaded rows (via `item.department`, the deprecated team-name carrier). The
   * filter renders no options (and stays inert) when empty.
   */
  teams: ReadonlyArray<string>;
  /**
   * Hide the Team facet — set on a team-scoped surface where the
   * scope is already fixed by the route, so filtering by team is meaningless.
   */
  hideTeamFacet?: boolean;
  /** Count of currently-selected rows; drives the bulk-action cluster. */
  selectedCount: number;
  /** Fired when the "New work item" button is pressed. */
  onNewItem: () => void;
  /**
   * Disable the "New work item" button. Set on a team-scoped route with no
   * same-team sibling to source a valid team status from — creating there would
   * post an invalid/cross-team status the API rejects (deferred to 8a3c0d6b).
   */
  newItemDisabled?: boolean;
  /** Apply a patch to the parent's current selection (e.g. bulk phase/priority). */
  onBulkApply: (patch: WorkItemPatch) => void;
  /**
   * Optional handler for the Columns menu's global "Reset column widths" item.
   * Threaded from the screen down to the table's `useColumnWidths` reset; the
   * item only renders when wired, so read-only embeds stay unchanged.
   */
  onResetColumnWidths?: () => void;
  /** The user's saved/named views; listed in the "Saved views" menu (Rank 8b). */
  savedViews: ReadonlyArray<SavedView>;
  /** Apply one saved view (hydrate the live filter state from its config). */
  onApplyView: (view: SavedView) => void;
  /** Save the CURRENT view under a (trimmed, non-empty) name. */
  onSaveView: (name: string) => void;
  /** Delete a saved view by its id. */
  onDeleteView: (id: string) => void;
}

/** Layout labels — the three {@link WorkboardLayout} renderers (DESIGN §B). */
const LAYOUT_LABELS: Record<WorkboardLayout, string> = {
  list: "List",
  board: "Board",
  graph: "Graph",
};

/**
 * Group-by labels for ALL {@link GroupByField}s (DESIGN §B order:
 * Status·Project·Cycle·Priority·Assignee·Team·Type·None). `phase` is labelled
 * "Status" (the label-only rename that kept the `phase` token); `none` reads
 * "No grouping". The menu maps over {@link GROUP_BY_FIELDS} for its order.
 */
const GROUP_BY_LABELS: Record<GroupByField, string> = {
  phase: "Status",
  project: "Project",
  cycle: "Cycle",
  priority: "Priority",
  assignee: "Assignee",
  team: "Team",
  type: "Type",
  none: "No grouping",
};

/** Sort labels — the five {@link SortByField}s (DESIGN §B). */
const SORT_BY_LABELS: Record<SortByField, string> = {
  manual: "Manual",
  priority: "Priority",
  updated: "Updated",
  created: "Created",
  due: "Due",
};

/** Tasks-visibility labels — the three {@link TasksVisibility}s (DESIGN §B). */
const TASKS_LABELS: Record<TasksVisibility, string> = {
  nested: "Nested",
  flat: "Flat",
  hidden: "Hidden",
};

/** Human labels for the toggleable columns (sentence case). */
const COLUMN_LABELS: Record<ColumnId, string> = {
  name: "Name",
  type: "Type",
  phase: "Status",
  priority: "Priority",
  owner: "Owner",
  due: "Due",
  tags: "Tags",
  source: "Source",
};

/** One active-facet selection surfaced as a removable chip (#13). */
interface ActiveFilterChip {
  /** Stable React key — facet label + the selected option's value. */
  id: string;
  /** The owning facet's label (e.g. "Type", "Owner"). */
  facetLabel: string;
  /** The human label of the selected value (e.g. "Feature", "Ada Lovelace"). */
  valueLabel: string;
  /** Remove JUST this value via the facet's existing single-value toggle. */
  remove: () => void;
}

/**
 * Turn one facet's selected values into removable chips, in the facet's
 * canonical option order. Each chip's `remove` calls the facet's existing
 * single-value `toggle` (which {@link toggledSet} turns into a remove when the
 * value is already selected), so a chip reuses the exact controlled plumbing the
 * menus do — no new mutation path.
 */
function facetChips<T extends string>(
  facetLabel: string,
  options: ReadonlyArray<{ value: T; label: string }>,
  selected: ReadonlySet<T>,
  toggle: (value: T) => void,
): ActiveFilterChip[] {
  const labelOf = new Map(options.map((option) => [option.value, option.label]));
  // Known values first, in canonical option order…
  const chips: ActiveFilterChip[] = options
    .filter((option) => selected.has(option.value))
    .map((option) => ({
      id: `${facetLabel}:${option.value}`,
      facetLabel,
      valueLabel: option.label,
      remove: () => {
        toggle(option.value);
      },
    }));
  // …then any selected value whose backing option has disappeared (e.g. a
  // persisted owner filter no longer in `owners`): still show + allow removing
  // it, labelled by the raw value, so it can never get stuck on uncountably.
  for (const value of selected) {
    if (!labelOf.has(value)) {
      chips.push({
        id: `${facetLabel}:${value}`,
        facetLabel,
        valueLabel: value,
        remove: () => {
          toggle(value);
        },
      });
    }
  }
  return chips;
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
  teams,
  hideTeamFacet = false,
  selectedCount,
  onNewItem,
  newItemDisabled = false,
  onBulkApply,
  onResetColumnWidths,
  columnFilters,
  savedViews,
  onApplyView,
  onSaveView,
  onDeleteView,
}: Readonly<WorkboardToolbarProps>) {
  const { filters } = value;

  // Transient UI state for the "Save current view" dialog ONLY (the toolbar
  // holds no VIEW state — that still lives in the parent's filter state). The
  // dialog's open flag + the in-progress name are local because they never
  // outlive the dialog and the parent has no use for them.
  const [saveOpen, setSaveOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [viewsMenuOpen, setViewsMenuOpen] = useState(false);
  const trimmedName = draftName.trim();

  const submitSaveView = (): void => {
    if (trimmedName === "") return;
    onSaveView(trimmedName);
    setDraftName("");
    setSaveOpen(false);
  };
  // A non-empty (trimmed) search counts as an active filter too, so the Clear
  // affordance appears — and resets the search — even when ONLY a search is set.
  const hasSearch = value.search.trim() !== "";
  const activeFilterCount =
    filters.type.size +
    filters.owner.size +
    filters.team.size +
    filters.phase.size +
    filters.priority.size +
    (hasSearch ? 1 : 0);

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

  const toggleTeam = (team: string): void => {
    onChange({
      ...value,
      filters: {
        ...filters,
        team: toggledSet(filters.team, team),
      },
    });
  };

  /** Reset the search AND all five facet sets; leave groupBy/columns/selection. */
  const clearFilters = (): void => {
    onChange({
      ...value,
      search: "",
      filters: {
        type: new Set(),
        owner: new Set(),
        team: new Set(),
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
  const teamOptions = teams.map((team) => ({
    value: team,
    label: team,
  }));

  // Active-filter chips (#13) — one removable chip per selected facet value, in
  // canonical facet then option order. A free-text search is deliberately NOT
  // chipped (it has its own clearable input); each chip removes only its value.
  const activeChips: ActiveFilterChip[] = [
    ...facetChips("Type", typeOptions, filters.type, toggleType),
    ...facetChips("Owner", ownerOptions, filters.owner, toggleOwner),
    ...facetChips("Team", teamOptions, filters.team, toggleTeam),
    ...facetChips("Status", phaseOptions, filters.phase, togglePhase),
    ...facetChips("Priority", priorityOptions, filters.priority, togglePriority),
  ];

  // --- Group-by & columns -------------------------------------------------

  const setLayout = (layout: WorkboardLayout): void => {
    onChange({ ...value, layout });
  };

  const setGroupBy = (groupBy: GroupByField): void => {
    onChange({ ...value, groupBy });
  };

  const setSortBy = (sortBy: SortByField): void => {
    onChange({ ...value, sortBy });
  };

  const setTasks = (tasks: TasksVisibility): void => {
    onChange({ ...value, tasks });
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
      {/* Layout — List / Board / Graph. Leads the display-options row (DESIGN §B):
          the single Item surface, three renderers over the same filtered set. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" aria-label="Layout">
            Layout: {LAYOUT_LABELS[value.layout]}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-40">
          <DropdownMenuLabel>Layout</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={value.layout}
            onValueChange={(next) => {
              setLayout(next as WorkboardLayout);
            }}
          >
            {WORKBOARD_LAYOUTS.map((layout) => (
              <DropdownMenuRadioItem key={layout} value={layout}>
                {LAYOUT_LABELS[layout]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

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

      {/* The Type / Phase / Priority / Owner facets live in the Table's column
          headers — but a header trigger only exists when that column is on
          screen. So the toolbar carries a facet whenever its header is gone:
          Kanban (no headers at all) or a column hidden via the Columns menu.
          Both paths reuse the very same `columnFilters` config the table
          consumes, so a filter set here flows through the shared filter state.
          A still-visible column keeps its facet in the header (no duplicate). */}
      {HEADER_FACETS.map(({ id, label }) => {
        const headerHidden =
          value.layout !== "list" || !value.visibleColumns.has(id);
        if (!headerHidden) return null;
        const facet = columnFilters?.[id];
        return facet ? (
          <FacetFilterMenu
            key={id}
            label={label}
            options={facet.options}
            selected={facet.selected}
            onToggle={facet.onToggle}
            onSetSelected={facet.onSetSelected}
            searchable={facet.searchable}
          />
        ) : null;
      })}

      {/* Team facet — always a toolbar filter (Team has no table
          column, so unlike Type / Phase / Priority / Owner it cannot move into a
          column header). All facets still flow into the active-filter count +
          chips below (both derive from the shared filter state). Hidden on a
          team-scoped surface, where the team is already fixed by the route. */}
      {hideTeamFacet ? null : (
        <FacetFilterMenu
          label="Team"
          options={teamOptions}
          selected={filters.team}
          onToggle={toggleTeam}
          onSetSelected={(next) =>
            onChange({ ...value, filters: { ...filters, team: next } })
          }
          searchable
        />
      )}

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
            {GROUP_BY_FIELDS.map((field) => (
              <DropdownMenuRadioItem key={field} value={field}>
                {GROUP_BY_LABELS[field]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Sort — row ordering within each group (DESIGN §B). */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" aria-label="Sort by">
            Sort: {SORT_BY_LABELS[value.sortBy]}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-40">
          <DropdownMenuLabel>Sort by</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={value.sortBy}
            onValueChange={(next) => {
              setSortBy(next as SortByField);
            }}
          >
            {SORT_BY_FIELDS.map((field) => (
              <DropdownMenuRadioItem key={field} value={field}>
                {SORT_BY_LABELS[field]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Tasks — sub-item visibility (DESIGN §B): Nested / Flat / Hidden. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" aria-label="Tasks">
            Tasks: {TASKS_LABELS[value.tasks]}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-40">
          <DropdownMenuLabel>Tasks</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={value.tasks}
            onValueChange={(next) => {
              setTasks(next as TasksVisibility);
            }}
          >
            {TASKS_VISIBILITIES.map((visibility) => (
              <DropdownMenuRadioItem key={visibility} value={visibility}>
                {TASKS_LABELS[visibility]}
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

      {/* Saved / named views (Rank 8b) — the "Saved views" menu lists every
          saved view (apply via its row, delete via the trash affordance), and the
          sibling "Save current view" button opens the name dialog. Apply and
          delete are both `DropdownMenuItem`s so they join the menu's roving
          arrow-key focus (a plain button inside `DropdownMenuContent` is NOT
          keyboard-reachable). They are SEPARATE items, so deleting can never also
          apply (no propagation to fight). */}
      <DropdownMenu open={viewsMenuOpen} onOpenChange={setViewsMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" aria-label="Saved views">
            <BookmarkIcon className="size-4" />
            Views
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56">
          <DropdownMenuLabel>Saved views</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {savedViews.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">
              No saved views yet
            </p>
          ) : (
            savedViews.map((saved) => (
              <div key={saved.id} className="flex items-center gap-1">
                <DropdownMenuItem
                  className="min-w-0 flex-1 truncate"
                  onSelect={() => {
                    // Selecting an item closes the (modal) menu via onOpenChange,
                    // so the rest of the toolbar is no longer aria-hidden.
                    onApplyView(saved);
                  }}
                >
                  {saved.name}
                </DropdownMenuItem>
                <DropdownMenuItem
                  aria-label={`Delete view ${saved.name}`}
                  className="text-muted-foreground"
                  onSelect={(event) => {
                    // Keep the menu open after a delete so several views can be
                    // removed in a row.
                    event.preventDefault();
                    onDeleteView(saved.id);
                  }}
                >
                  <Trash2Icon />
                </DropdownMenuItem>
              </div>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setSaveOpen(true);
        }}
      >
        Save current view
      </Button>

      {/* Save-current-view dialog — a house Dialog (the suite has no Popover) with
          a single name Input + a Save button that is disabled until the trimmed
          name is non-empty. Submitting snapshots the current config upward. */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save current view</DialogTitle>
            <DialogDescription>
              Name this view to apply its filters, grouping, columns, and layout
              again in one click.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              submitSaveView();
            }}
          >
            <Input
              aria-label="View name"
              placeholder="e.g. My execute lane"
              value={draftName}
              onChange={(event) => {
                setDraftName(event.target.value);
              }}
              autoFocus
            />
            <DialogFooter>
              <Button type="submit" disabled={trimmedName === ""}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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

          {/* Assign owner — one unconditional action per owner, plus an explicit
              "Unassigned" that clears the owner. Built fresh from `owners` (NOT
              the filter's `ownerOptions`, whose leading sentinel is a FILTER
              token, never a real assignee_id) so Unassigned applies `null`. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" aria-label="Assign owner">
                Assign owner
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-40">
              <DropdownMenuLabel>Assign owner</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {owners.map((owner) => (
                <DropdownMenuItem
                  key={owner.id}
                  onSelect={() => {
                    onBulkApply({ assignee_id: owner.id });
                  }}
                >
                  {owner.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem
                onSelect={() => {
                  onBulkApply({ assignee_id: null });
                }}
              >
                Unassigned
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Archive — two explicit actions, not a toggle: a mixed selection can
              hold both archived and active rows, so we never compute a single
              flip. Each item is an unconditional bulk apply. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" aria-label="Archive">
                Archive
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-40">
              <DropdownMenuLabel>Archive</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  onBulkApply({ archived: true });
                }}
              >
                Archive selected
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  onBulkApply({ archived: false });
                }}
              >
                Restore selected
              </DropdownMenuItem>
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
      <Button
        size="sm"
        className="ml-auto"
        onClick={onNewItem}
        disabled={newItemDisabled}
        title={
          newItemDisabled
            ? "Creating in an empty team needs team status setup (coming soon)"
            : undefined
        }
      >
        <PlusIcon className="size-4" />
        New work item
      </Button>

      {/* Active-filter chips (#13) — a removable chip per selected facet value.
          `basis-full` drops the row beneath the controls (the toolbar wraps);
          it renders nothing when no facet is active. Each chip's X removes just
          its own value through the facet's single-value toggle. */}
      {activeChips.length > 0 ? (
        <div
          role="group"
          aria-label="Active filters"
          className="flex basis-full flex-wrap items-center gap-1.5"
        >
          {activeChips.map((chip) => (
            <span
              key={chip.id}
              className="inline-flex items-center gap-1 rounded-full border bg-muted/60 py-0.5 pr-0.5 pl-2 text-xs"
            >
              <span className="text-muted-foreground">{chip.facetLabel}:</span>
              <span className="font-medium text-foreground">
                {chip.valueLabel}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                className="rounded-full"
                aria-label={`Remove ${chip.facetLabel} ${chip.valueLabel}`}
                onClick={chip.remove}
              >
                <XIcon />
              </Button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
