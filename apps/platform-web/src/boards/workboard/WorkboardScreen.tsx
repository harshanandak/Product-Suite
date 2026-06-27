import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button, EmptyState } from "@product-suite/ui";

import {
  getDefaultRepository,
  useWorkItems,
  type Task,
  type WorkItem,
  type WorkItemPatch,
  type WorkItemRepository,
  type WorkItemRow,
} from "@/data/work-items";

import { WorkItemEditor } from "./editor/WorkItemEditor";
import {
  applyWorkboardFilters,
  defaultWorkboardFilterState,
  workboardDepartments,
} from "./filter-state";
import { WorkboardKanban } from "./kanban/WorkboardKanban";
import { WorkboardTable } from "./table/WorkboardTable";
import { WorkboardToolbar } from "./toolbar/WorkboardToolbar";

/**
 * Props for {@link WorkboardScreen}.
 *
 * The screen self-provides its data (it IS the live route), so the only prop is
 * the repository SEAM — optional, defaulting to the shared module singleton.
 * Injecting it lets tests drive the screen against a controlled fixture store
 * without touching that singleton.
 */
export interface WorkboardScreenProps {
  /** Repository to read/write through; defaults to the shared module singleton. */
  repository?: WorkItemRepository;
}

/**
 * Workboard SCREEN — the live composition of the Toolbar + Table + Editor over
 * the data seam (DESIGN §2 / §4).
 *
 * Owns the shared {@link defaultWorkboardFilterState | WorkboardFilterState}: the
 * toolbar mutates it (search, facet filters, group-by, columns, selection) and
 * the screen derives the Table's already-filtered `rows` from it — the Table
 * never filters, so the two surfaces can never desync. A table row activation
 * opens the editor Sheet; saves and inline/bulk edits all flow through the hook's
 * optimistic `update` (one store, never desynced). The New button creates through
 * the hook's `create` and opens the editor on the fresh item.
 *
 * §4 states: the Table owns its loading skeleton and error panel. The screen
 * adds two distinct empty states — "no work items at all" vs. "filters hide
 * everything" (with a one-click clear that resets search AND facets so the user
 * is never stranded in a no-match view).
 *
 * Tasks are read once from the repository (the hook surfaces only rows +
 * projects + owners) and passed whole to the editor, which filters them per item
 * — one deterministic fetch, no per-selection race.
 */
export function WorkboardScreen({
  repository,
}: Readonly<WorkboardScreenProps> = {}) {
  // Stabilize the repository for the lifetime of the screen so the hook and our
  // own task read share ONE store (the hook captures its repo once, on mount —
  // a fresh instance per render would silently desync the two). With no injected
  // prop we route through the SAME module singleton the hook defaults to, so
  // optimistic edits persist across navigation instead of resetting per mount.
  const [repo] = useState<WorkItemRepository>(
    () => repository ?? getDefaultRepository(),
  );

  const { items, owners, loading, error, update, create, refetch } =
    useWorkItems({ repository: repo });

  // Tasks for the editor (derived health + the read-only task list). Loaded once;
  // tasks do not change on a work-item save, so no refetch is wired.
  const [tasks, setTasks] = useState<ReadonlyArray<Task>>([]);
  useEffect(() => {
    let cancelled = false;
    repo
      .listTasks()
      .then((loaded) => {
        if (!cancelled) setTasks(loaded);
      })
      .catch(() => {
        // Tasks are supplementary to the editor; a failure simply yields an
        // editor with no task list / "on track" derived health. The table's
        // own error path covers the primary load.
      });
    return () => {
      cancelled = true;
    };
  }, [repo]);

  // The single shared toolbar ⇄ table view state.
  const [filterState, setFilterState] = useState(defaultWorkboardFilterState());

  // Department facet options + the already-filtered rows, both derived from the
  // live items. The Table renders exactly `rows`; it never filters.
  const departments = useMemo(() => workboardDepartments(items), [items]);
  const rows = useMemo(
    () => applyWorkboardFilters(items, filterState),
    [items, filterState],
  );

  // Editor selection. Typed `WorkItem` (not `WorkItemRow`) so `create`'s return
  // value assigns directly; a `WorkItemRow` from a table activation is assignable
  // to `WorkItem`, so both paths type-check.
  const [selected, setSelected] = useState<WorkItem | null>(null);

  const handleSelectItem = useCallback((row: WorkItemRow) => {
    setSelected(row);
  }, []);

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) setSelected(null);
  }, []);

  const handleSelectionChange = useCallback((next: Set<string>) => {
    setFilterState((state) => ({ ...state, selection: next }));
  }, []);

  // Apply one patch to every selected row, then clear the selection. Sequential
  // awaits keep the optimistic store reconciling one row at a time; a per-item
  // rejection is swallowed (the hook already rolled that row back), mirroring the
  // inline-edit path so one bad write never aborts the batch.
  const handleBulkApply = useCallback(
    (patch: WorkItemPatch): void => {
      const ids = [...filterState.selection];
      const run = async (): Promise<void> => {
        for (const id of ids) {
          try {
            await update(id, patch);
          } catch {
            // Swallowed — the failed row's value simply never lands in `rows`.
          }
        }
        setFilterState((state) => ({ ...state, selection: new Set() }));
      };
      // Fire-and-forget: the handler is a void-returning click target; the
      // trailing .catch keeps it from floating a promise (no `void` operator).
      run().catch(() => undefined);
    },
    [filterState.selection, update],
  );

  // Create a fresh item and open the editor on it. The hook prepends the created
  // record to `items`, so `liveSelected` resolves it; `selected` is the
  // one-render fallback until that reflow lands.
  const handleNewItem = useCallback((): void => {
    // Fire-and-forget create + open the editor on the fresh item. create()
    // rejects only under a real backend (the mock never does); the trailing
    // .catch keeps this void-returning click handler from floating a promise.
    create({})
      .then((created) => setSelected(created))
      .catch(() => undefined);
  }, [create]);

  // Editor's onSave returns void; the hook's update returns the saved WorkItem.
  // Await + discard, and let rejections propagate so the editor keeps the Sheet
  // open and surfaces the error (the hook has already rolled back local state).
  const handleSave = useCallback(
    async (id: string, patch: WorkItemPatch): Promise<void> => {
      await update(id, patch);
    },
    [update],
  );

  // Keep the open Sheet's snapshot fresh after an inline/bulk edit reflows
  // `items`, so a re-opened/derived view never shows a stale row.
  const selectedId = selected?.id ?? null;
  const liveSelected = useMemo<WorkItem | null>(
    () =>
      selectedId === null
        ? null
        : (items.find((row) => row.id === selectedId) ?? selected),
    [items, selectedId, selected],
  );

  // Reset BOTH search and facets — a search string alone can hide every row, so
  // clearing only the facets would strand the user in the no-match state.
  const clearAllFilters = useCallback(() => {
    setFilterState((state) => ({
      ...state,
      search: "",
      filters: {
        type: new Set(),
        owner: new Set(),
        department: new Set(),
        phase: new Set(),
        priority: new Set(),
      },
    }));
  }, []);

  // Active view — Table (default) or Kanban. Both consume the same filtered rows
  // + handlers (action parity), so search/filters apply equally to both. The
  // Graph is its own full-page sub-board route, not an inline tab (it is an
  // unbounded canvas — see boards/workboard/graph/WorkboardGraphScreen.tsx).
  const [view, setView] = useState<"table" | "kanban">("table");

  // The table owns its column-width state (in useColumnWidths); it publishes its
  // reset into this ref so the toolbar's "Reset column widths" item can fire it.
  const resetColumnWidthsRef = useRef<(() => void) | null>(null);
  const handleResetColumnWidths = useCallback(() => {
    resetColumnWidthsRef.current?.();
  }, []);

  // §4 body states (the toolbar always renders so New/filters stay reachable):
  //  - loading || error → the active view owns the skeleton / error panel.
  //  - no items at all   → the teaching empty state.
  //  - items but no rows → filters hide everything → clearable no-match state.
  const showTable = loading || error !== null;
  const noItems = !showTable && items.length === 0;
  const noMatches = !showTable && items.length > 0 && rows.length === 0;

  // The active view (table or kanban) over the same filtered rows + handlers.
  // Resolved here so the body JSX below stays a single (non-nested) ternary.
  const activeView =
    view === "kanban" ? (
      <WorkboardKanban
        rows={rows}
        owners={owners}
        loading={loading}
        error={error}
        onRetry={refetch}
        onSelectItem={handleSelectItem}
        onUpdateItem={update}
      />
    ) : (
      <WorkboardTable
        rows={rows}
        owners={owners}
        loading={loading}
        error={error}
        onRetry={refetch}
        groupBy={filterState.groupBy}
        visibleColumns={filterState.visibleColumns}
        selection={filterState.selection}
        onSelectionChange={handleSelectionChange}
        onSelectItem={handleSelectItem}
        onUpdateItem={update}
        resetColumnWidthsRef={resetColumnWidthsRef}
      />
    );

  return (
    <section className="flex flex-col gap-4">
      <WorkboardToolbar
        value={filterState}
        onChange={setFilterState}
        view={view}
        onViewChange={setView}
        owners={owners}
        departments={departments}
        selectedCount={filterState.selection.size}
        onNewItem={handleNewItem}
        onBulkApply={handleBulkApply}
        onResetColumnWidths={
          view === "table" ? handleResetColumnWidths : undefined
        }
      />

      {noItems ? (
        <EmptyState
          title="No work items yet"
          description="Work items are the coalition hub — create one to plan, execute, and review work across departments."
          action={
            <Button size="sm" onClick={handleNewItem}>
              New work item
            </Button>
          }
        />
      ) : null}

      {noMatches ? (
        <EmptyState
          title="No matching work items"
          description="No work items match the current search and filters. Clear them to see everything again."
          action={
            <Button size="sm" variant="outline" onClick={clearAllFilters}>
              Clear filters
            </Button>
          }
        />
      ) : null}

      {!noItems && !noMatches ? activeView : null}

      <WorkItemEditor
        item={liveSelected}
        open={liveSelected !== null}
        onOpenChange={handleOpenChange}
        onSave={handleSave}
        tasks={tasks}
        owners={owners}
      />
    </section>
  );
}
