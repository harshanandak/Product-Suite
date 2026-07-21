import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useNavigate, useParams, useSearch } from "@tanstack/react-router";

import {
  Button,
  EmptyState,
  Skeleton,
  toast,
  type Phase,
  type Priority,
  type WorkItemType,
} from "@product-suite/ui";

import {
  getDefaultRepository,
  useItemChecks,
  useRepositoryContext,
  useWorkItems,
  type CreateWorkItemInput,
  type WorkItem,
  type WorkItemPatch,
  type WorkItemRepository,
  type WorkItemRow,
} from "@/data/work-items";
import { DEFAULT_WORKSPACE } from "@/env";

import { WorkItemEditor } from "./editor/WorkItemEditor";
import {
  FILTER_STORAGE_KEY,
  SAVED_VIEWS_KEY,
  applyWorkboardFilters,
  buildFacetOptions,
  currentViewConfig,
  defaultWorkboardFilterState,
  parsePersistedView,
  parseSavedViews,
  serializePersistedView,
  serializeSavedViews,
  toggledSet,
  workboardTeams,
  type ColumnId,
  type PersistedView,
  type SavedView,
  type WorkboardFilterState,
  type WorkboardLayout,
} from "./filter-state";
import { GraphFilters } from "./graph/GraphFilters";
import { WorkboardKanban } from "./kanban/WorkboardKanban";
import { WorkboardTable, type ColumnFilter } from "./table/WorkboardTable";
import { WorkboardToolbar } from "./toolbar/WorkboardToolbar";

/**
 * The Graph layout is LAZY-loaded: `@xyflow/react` + dagre + the React Flow CSS
 * form a heavy chunk that should download only when the Graph layout is chosen —
 * keeping it out of the main List/Board bundle (verified by a separate chunk).
 */
const WorkboardGraph = lazy(() => import("./graph/WorkboardGraph"));

/** Announced skeleton shown while the lazy Graph chunk downloads. */
function GraphLoadingFallback() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="min-h-[420px] flex-1"
    >
      <span className="sr-only">Loading graph…</span>
      <Skeleton aria-hidden="true" className="h-full w-full rounded-lg" />
    </div>
  );
}

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
  /**
   * When set, the surface is scoped to a single team: rows are pre-filtered to
   * `team_id === teamId` BEFORE the user's search/facets apply, and the Team
   * toolbar facet is hidden (the scope is already fixed). Drives the
   * `/workboard/team/$teamId` route via {@link TeamItemsScreen}.
   */
  teamId?: string;
}

/**
 * Read the persisted view blob from localStorage, validated. NEVER throws:
 * SSR (no `window`) and a privacy-mode `getItem` throw both yield `null`, and a
 * malformed/absent payload is handled by {@link parsePersistedView}. Mirrors the
 * column-width precedent's guarded read (boards/workboard/table/useColumnWidths).
 */
function readPersistedView(): PersistedView | null {
  if (typeof window === "undefined") return null;
  try {
    return parsePersistedView(window.localStorage.getItem(FILTER_STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * Read the RAW saved-views blob from localStorage. NEVER throws (SSR + privacy
 * mode), mirroring {@link readPersistedView}; the caller pipes the result through
 * {@link parseSavedViews}, which tolerates `null` and malformed payloads.
 */
function readSavedViews(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SAVED_VIEWS_KEY);
  } catch {
    return null;
  }
}

/**
 * Hydrate a full {@link WorkboardFilterState} from a {@link PersistedView} config:
 * each present field wins over a fresh {@link defaultWorkboardFilterState}, the
 * `Set`s are CLONED (so a long-lived saved-view config is never aliased/mutated),
 * and `selection` is FORCED empty — stale row ids must never ride along with a
 * restored or applied config. Shared by the mount initializer (#48) and
 * {@link WorkboardScreen}'s apply-saved-view handler so both rehydrate identically.
 */
function hydrateFilterState(config: PersistedView): WorkboardFilterState {
  const base = defaultWorkboardFilterState();
  return {
    search: config.search ?? base.search,
    layout: config.layout ?? base.layout,
    groupBy: config.groupBy ?? base.groupBy,
    sortBy: config.sortBy ?? base.sortBy,
    tasks: config.tasks ?? base.tasks,
    filters: config.filters
      ? {
          type: new Set(config.filters.type),
          owner: new Set(config.filters.owner),
          team: new Set(config.filters.team),
          phase: new Set(config.filters.phase),
          priority: new Set(config.filters.priority),
        }
      : base.filters,
    visibleColumns: config.visibleColumns
      ? new Set(config.visibleColumns)
      : base.visibleColumns,
    selection: base.selection,
  };
}

/** Fallback counter for environments without `crypto.randomUUID` (rare). */
let fallbackViewIdCounter = 0;

/**
 * Generate a STABLE, collision-free id for a new saved view. Prefers the browser's
 * `crypto.randomUUID()` (present in every modern browser + jsdom); where it is
 * absent, falls back to a monotonic counter that is bumped past any id already in
 * `existing`, so it never collides — and never uses `Date.now()`/`Math.random()`.
 */
function generateViewId(existing: ReadonlyArray<SavedView>): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  const taken = new Set(existing.map((view) => view.id));
  let id = `view-${(fallbackViewIdCounter += 1)}`;
  while (taken.has(id)) id = `view-${(fallbackViewIdCounter += 1)}`;
  return id;
}

/**
 * Resolve the create-defaults for an UNSCOPED "New" item — team_id + department
 * only. The server assigns the initial status (kernel issue 648b180d); the
 * client never sends status_id/phase (the newest row can be a completed status).
 * Target team is chosen by a clear precedence so this stops being whack-a-mole:
 *
 *   1. the first row VISIBLE under the active filter — the team the user is
 *      looking at (correct even when the board is filtered to a team other than
 *      the newest row's);
 *   2. else, when a search/other facet hides EVERY row but the Team facet still
 *      pins one or more teams (it matches on the `department` name), the target
 *      is still knowable — use any loaded row in a pinned team. Dropping it to
 *      create({}) would 400 in a MULTI-team tenant, where the server refuses an
 *      omitted team_id (resolveDefaultTeamId → team_required_multiple);
 *   3. else nothing is derivable (empty board / no team pinned) — create({}) and
 *      let the server resolve the single-team default.
 */
function resolveUnscopedCreateDefaults(
  visibleRows: readonly Pick<WorkItem, "team_id" | "department">[],
  loadedItems: readonly Pick<WorkItem, "team_id" | "department">[],
  pinnedTeamNames: ReadonlySet<string>,
): CreateWorkItemInput {
  const firstVisible = visibleRows[0];
  if (firstVisible) {
    return {
      team_id: firstVisible.team_id,
      department: firstVisible.department,
    };
  }
  if (pinnedTeamNames.size > 0) {
    const pinned = loadedItems.find((item) =>
      pinnedTeamNames.has(item.department),
    );
    if (pinned) {
      return { team_id: pinned.team_id, department: pinned.department };
    }
  }
  return {};
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
 * The editor's read-only check list is fetched PER-ITEM on open (via
 * {@link useItemChecks}), not by reading every check on the board — so opening the
 * board never pulls the whole check set just to feed one item's editor (PR3).
 */
export function WorkboardScreen({
  repository,
  teamId,
}: Readonly<WorkboardScreenProps> = {}) {
  // Stabilize the repository for the lifetime of the screen so the hook and our
  // own check read share ONE store (the hook captures its repo once, on mount —
  // a fresh instance per render would silently desync the two). With no injected
  // prop we route through the SAME module singleton the hook defaults to, so
  // optimistic edits persist across navigation instead of resetting per mount.
  const contextRepo = useRepositoryContext();
  const [repo] = useState<WorkItemRepository>(
    () => repository ?? contextRepo ?? getDefaultRepository(),
  );

  // Row activation navigates to the item's detail PAGE — needs the router's
  // navigate + the current workspace param to build the typed target. Read the
  // param non-strictly (with a fallback) so this one screen serves BOTH the
  // /workboard and /workboard/team/$teamId routes (the BoardScreen precedent).
  const navigate = useNavigate();
  const { workspace } = useParams({ strict: false });
  const workspaceSlug = workspace ?? DEFAULT_WORKSPACE;

  // Optional `?layout=` deep-link seed (the legacy /workboard/graph redirect
  // lands here as `?layout=graph`). Read non-strictly so the team route — which
  // has no such search — is unaffected. It seeds the INITIAL layout only; once
  // mounted, the toolbar's Layout menu owns it.
  const search = useSearch({ strict: false }) as { layout?: WorkboardLayout };
  const layoutParam = search.layout;

  const {
    items,
    owners,
    dependencies,
    loading,
    error,
    update,
    pendingIds,
    create,
    refetch,
    addDependency,
    removeDependency,
  } = useWorkItems({ repository: repo });

  // The single shared toolbar ⇄ table view state. Lazily hydrated from the
  // persisted blob (merged OVER a fresh default, so any missing/invalid field
  // falls back) in the initializer — NOT a post-mount effect — so the first
  // render already shows the restored state instead of flashing defaults.
  // `selection` is FORCED empty: stale row ids must never survive a reload.
  const [filterState, setFilterState] = useState(() => {
    const persisted = readPersistedView();
    const base =
      persisted === null
        ? defaultWorkboardFilterState()
        : hydrateFilterState(persisted);
    // A `?layout=` deep link wins over the persisted/default layout for the
    // first render (the validated route search already dropped unknown values).
    return layoutParam ? { ...base, layout: layoutParam } : base;
  });

  // Once the `?layout=` seed has been consumed into the initial state, strip it
  // from the URL (replace — no history entry) so it doesn't linger and re-apply
  // on later navigation (Codex #114). The guard makes this inert on routes/loads
  // without the seed; after the strip, `layoutParam` becomes undefined so a
  // re-run is a no-op (never a redirect loop).
  useEffect(() => {
    if (layoutParam === undefined) return;
    void navigate({
      to: "/w/$workspace/workboard",
      params: { workspace: workspaceSlug },
      search: {},
      replace: true,
    });
  }, [layoutParam, navigate, workspaceSlug]);

  // The user's saved/named views (Rank 8b). Lazily hydrated from a SEPARATE
  // localStorage key (SAVED_VIEWS_KEY) on mount — independent of the single
  // last-applied config the #48 effect persists to FILTER_STORAGE_KEY.
  const [savedViews, setSavedViews] = useState<SavedView[]>(() =>
    parseSavedViews(readSavedViews()),
  );

  // Team scope (route-level): when a teamId is set, pre-filter to that team
  // BEFORE the user's search/facets apply, so the whole surface (rows, empty
  // states, facet options) sees only the team's items. Unscoped → all items.
  const scopedItems = useMemo(
    () =>
      teamId === undefined
        ? items
        : items.filter((item) => item.team_id === teamId),
    [items, teamId],
  );

  // The scoped team's display NAME, carried on the deprecated `department` field
  // (the only client-side name source today — see filter-state's seam notes).
  // Every scoped item shares this one team, so any sibling's `department` IS the
  // team name; derived from data already loaded rather than a separate teams
  // read (useTeams resolves the same name from the same `department` carrier, so
  // the sibling is equivalent and avoids a second hook). Used so a new item
  // created on the scoped page groups/labels under the correct Team — team_id
  // alone does not drive the client-side department-based grouping. `undefined`
  // on the unscoped route AND on an empty team (no sibling to read); the atomic
  // team_id → name mapping is deferred to issue 8a3c0d6b.
  const scopedTeamName =
    teamId === undefined ? undefined : scopedItems[0]?.department;

  // A prod-valid `status_id` for a scoped-route create. The production API
  // REJECTS a create without status_id AND verifies it belongs to the submitted
  // team_id (apps/platform-api domain/work-items). The mock hides this by
  // backfilling, but the network repo posts the raw input. Source the status
  // ONLY from a SAME-TEAM sibling — every scoped item shares this team, so its
  // status is a valid team status. NO cross-team fallback: borrowing another
  // team's status (e.g. items[0]) would fail the team↔status check and 400.
  // `undefined` when the scoped team has no sibling (empty team) → New is
  // disabled below rather than posting an invalid status (issue 8a3c0d6b).
  const scopedStatusId =
    teamId === undefined ? undefined : scopedItems[0]?.status_id;

  // Disable "New" while the initial list load is pending OR errored, OR on a
  // team-scoped route with no same-team sibling:
  //   - loading: until the first list resolves, `items` is empty, so a create
  //     would derive NO defaults (team_id/status_id) even on a NON-empty board
  //     and POST a bare payload the prod API rejects. Block the click until the
  //     data the derivation reads has actually loaded (Codex review, PR #105).
  //   - error: when the list load REJECTS, the hook clears `loading` and sets
  //     `error`, but `items` is still empty — the board is NOT known-empty, so a
  //     create({}) here would again post a bare payload against a real backend.
  //     Stay disabled until a SUCCESSFUL load establishes what the board holds
  //     (CodeRabbit review, PR #105).
  //   - scoped empty team: there is no valid team status to source, and the API
  //     would reject a cross-team/missing status. "Can't do it correctly yet →
  //     don't offer it" (mirrors the read-only Team field + disabled kanban
  //     team-drag).
  // A truly-empty board AFTER a SUCCESSFUL load stays enabled (loading false,
  // error null, teamId undefined), so a fresh workspace can still create its
  // first item via create({}) — the server resolves the team default.
  const newItemDisabled =
    loading ||
    error !== null ||
    (teamId !== undefined && scopedStatusId === undefined);

  // Team facet options + the already-filtered rows, both derived from the
  // (team-)scoped items. The Table renders exactly `rows`; it never filters.
  const teams = useMemo(
    () => workboardTeams(scopedItems),
    [scopedItems],
  );
  // On a team-scoped route the Team facet is hidden (the route fixes the scope),
  // so a persisted `filters.team` from the unscoped board is stale AND
  // unclearable. Left applied it can filter the scoped rows to EMPTY (a prior,
  // different-team selection matches nothing here). Normalize it to an empty set
  // before filtering so the scoped view ignores the persisted team facet.
  const effectiveFilterState = useMemo(() => {
    if (teamId === undefined || filterState.filters.team.size === 0) {
      return filterState;
    }
    return {
      ...filterState,
      filters: { ...filterState.filters, team: new Set<string>() },
    };
  }, [filterState, teamId]);
  const rows = useMemo(
    () => applyWorkboardFilters(scopedItems, effectiveFilterState, owners),
    [scopedItems, effectiveFilterState, owners],
  );

  // The five facet option lists, derived once from the live owners/teams.
  const facetOptions = useMemo(
    () => buildFacetOptions(owners, teams),
    [owners, teams],
  );

  // Per-column header filters (Type / Phase / Priority / Owner) for the Table.
  // Each mirrors exactly what the toolbar facet did — the live `selected` set
  // plus an `onToggle` / `onSetSelected` that splice a fresh `Set` into the
  // shared filter state (functional updates, so they read the latest state and
  // never go stale). Department has no column, so it stays a toolbar facet.
  const columnFilters = useMemo<Partial<Record<ColumnId, ColumnFilter>>>(() => {
    const { filters } = filterState;
    return {
      type: {
        options: facetOptions.type,
        selected: filters.type,
        onToggle: (value: string) =>
          setFilterState((state) => ({
            ...state,
            filters: {
              ...state.filters,
              type: toggledSet(state.filters.type, value as WorkItemType),
            },
          })),
        onSetSelected: (next: Set<string>) =>
          setFilterState((state) => ({
            ...state,
            filters: { ...state.filters, type: next as Set<WorkItemType> },
          })),
      },
      phase: {
        options: facetOptions.phase,
        selected: filters.phase,
        onToggle: (value: string) =>
          setFilterState((state) => ({
            ...state,
            filters: {
              ...state.filters,
              phase: toggledSet(state.filters.phase, value as Phase),
            },
          })),
        onSetSelected: (next: Set<string>) =>
          setFilterState((state) => ({
            ...state,
            filters: { ...state.filters, phase: next as Set<Phase> },
          })),
      },
      priority: {
        options: facetOptions.priority,
        selected: filters.priority,
        onToggle: (value: string) =>
          setFilterState((state) => ({
            ...state,
            filters: {
              ...state.filters,
              priority: toggledSet(state.filters.priority, value as Priority),
            },
          })),
        onSetSelected: (next: Set<string>) =>
          setFilterState((state) => ({
            ...state,
            filters: { ...state.filters, priority: next as Set<Priority> },
          })),
      },
      owner: {
        options: facetOptions.owner,
        selected: filters.owner,
        searchable: true,
        onToggle: (value: string) =>
          setFilterState((state) => ({
            ...state,
            filters: {
              ...state.filters,
              owner: toggledSet(state.filters.owner, value),
            },
          })),
        onSetSelected: (next: Set<string>) =>
          setFilterState((state) => ({
            ...state,
            filters: { ...state.filters, owner: next },
          })),
      },
    };
  }, [filterState, facetOptions]);

  // Prune the shared selection down to the CURRENTLY-VISIBLE rows whenever the
  // filtered `rows` change, so the toolbar's "N selected" count and every bulk
  // action only ever see ids the user can actually see. Without this, ids hidden
  // by the active search/filters would linger in `selection` — inflating the
  // count and letting `handleBulkApply` mutate filtered-out items (#2). The
  // functional update returns the PRIOR state ref untouched when nothing is
  // pruned, so React bails out and `rows` (memoized on `[items, filterState]`)
  // stays stable — no re-prune, no render loop.
  useEffect(() => {
    setFilterState((state) => {
      if (state.selection.size === 0) return state;
      const visibleIds = new Set(rows.map((row) => row.id));
      const pruned = new Set<string>();
      for (const id of state.selection) {
        if (visibleIds.has(id)) pruned.add(id);
      }
      if (pruned.size === state.selection.size) return state;
      return { ...state, selection: pruned };
    });
  }, [rows]);

  // Editor selection. Typed `WorkItem` (not `WorkItemRow`) so `create`'s return
  // value assigns directly; a `WorkItemRow` from a table activation is assignable
  // to `WorkItem`, so both paths type-check.
  const [selected, setSelected] = useState<WorkItem | null>(null);

  // Checks for the OPEN editor only (its read-only list + derived health),
  // fetched per-item on open — never the whole board's checks (PR3). The editor
  // is reserved for the New flow here, so this is empty until an item is opened;
  // the hook's own list-level check read (board health/counts) is unaffected.
  const { checks: editorChecks } = useItemChecks({
    repository: repo,
    workItemId: selected?.id ?? null,
  });

  // Row activation (table + kanban) opens the full detail PAGE — a durable,
  // linkable home. The editor Sheet is reserved for quick-edit: the New flow
  // (below) and the detail page's own "Edit" button. Inline cell edits on the
  // table remain, so quick field edits from the board are never lost.
  const handleSelectItem = useCallback(
    (row: WorkItemRow) => {
      // Fire-and-forget navigation; trailing .catch keeps this void-returning
      // click handler from floating a promise (the file's convention — no `void`).
      navigate({
        to: "/w/$workspace/workboard/item/$itemId",
        params: { workspace: workspaceSlug, itemId: row.id },
      }).catch(() => undefined);
    },
    [navigate, workspaceSlug],
  );

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) setSelected(null);
  }, []);

  const handleSelectionChange = useCallback((next: Set<string>) => {
    setFilterState((state) => ({ ...state, selection: next }));
  }, []);

  // Apply one patch to every selected row. Sequential awaits keep the optimistic
  // store reconciling one row at a time; one bad write never aborts the batch.
  // SUCCEEDED ids are cleared from the shared selection while FAILED ids stay
  // selected so the user can retry exactly them, and any failure is surfaced as a
  // toast (an aria-live announcement) instead of being silently swallowed.
  const handleBulkApply = useCallback(
    (patch: WorkItemPatch): void => {
      const ids = [...filterState.selection];
      if (ids.length === 0) return;
      const run = async (): Promise<void> => {
        const succeeded: string[] = [];
        const failed: string[] = [];
        for (const id of ids) {
          try {
            await update(id, patch);
            succeeded.push(id);
          } catch {
            // The hook already rolled this row back; keep it to retry.
            failed.push(id);
          }
        }
        // Reconcile the selection in one update: drop succeeded ids and RE-ADD
        // the failed ones. Re-adding (not merely retaining) is load-bearing — a
        // bulk patch that moves a row OUT of the active filter is applied
        // optimistically, so the prune effect (#2) can drop that id from
        // `state.selection` BEFORE the write rejects; adding it back restores the
        // toast's promise that failed items "stay selected to retry".
        setFilterState((state) => {
          const next = new Set(state.selection);
          for (const id of succeeded) next.delete(id);
          for (const id of failed) next.add(id);
          return { ...state, selection: next };
        });
        if (failed.length > 0) {
          toast.error(
            `Couldn't update ${failed.length} of ${ids.length} ${
              ids.length === 1 ? "item" : "items"
            } — they stay selected to retry`,
          );
        }
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
    // Guard: never POST a scoped create without a valid same-team status. The
    // action is disabled in the UI on an empty scoped team, but guard here too
    // so no invalid/cross-team-status create can ever fire.
    if (newItemDisabled) return;
    // Derive the create defaults CLIENT-SIDE. The SERVER is authoritative for a
    // team's INITIAL status: #108 landed server-side resolution of the team's
    // default status (lowest-position non-triage status) whenever `status_id` is
    // omitted from the create (kernel issue 648b180d).
    //
    // Scoped route (teamId set): thread the route's teamId so the new item
    // lands on THIS team — without it the repo backfills team_id from a default
    // and the fresh item can vanish from the scoped list. Carry the team's
    // `department` NAME (when a sibling supplies it) so the item GROUPS/LABELS
    // under the correct Team column, plus a same-team `status_id` sourced from a
    // SAME-TEAM sibling — see `scopedTeamName` / `scopedStatusId`.
    //
    // Unscoped route: supply ONLY team_id + department (for MULTI-TEAM
    // disambiguation — a mixed board needs a target team, and the Team
    // grouping/facets read `department`) and let the SERVER assign the initial
    // status (kernel issue 648b180d). We NEVER borrow the row's `status_id`/
    // `phase`: the newest row (`items` is ordered `updated_at desc`) can be a
    // COMPLETED status, so sending it would BIRTH a brand-new item in a done
    // column. `resolveUnscopedCreateDefaults` picks the target team by a clear
    // precedence — visible row → pinned Team filter → create({}) — see its doc.
    const input: CreateWorkItemInput =
      teamId === undefined
        ? resolveUnscopedCreateDefaults(
            rows,
            items,
            effectiveFilterState.filters.team,
          )
        : {
            team_id: teamId,
            ...(scopedTeamName === undefined
              ? {}
              : { department: scopedTeamName }),
            ...(scopedStatusId === undefined
              ? {}
              : { status_id: scopedStatusId }),
          };
    // Fire-and-forget create + open the editor on the fresh item; the trailing
    // .catch keeps this void-returning click handler from floating a promise.
    create(input)
      .then((created) => setSelected(created))
      .catch(() => {
        // Surface the failure — never swallow it. A rejected create (e.g. a
        // payload the API refuses) must be visible, not an invisible no-op.
        toast.error("Couldn't create the work item — please try again.");
      });
  }, [
    create,
    teamId,
    rows,
    items,
    effectiveFilterState,
    scopedTeamName,
    scopedStatusId,
    newItemDisabled,
  ]);

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
        team: new Set(),
        phase: new Set(),
        priority: new Set(),
      },
    }));
  }, []);

  // The active Layout (List / Board / Graph) is driven from the shared filter
  // state (DESIGN §B — Layout is a display option, not a separate route or tab).
  // All three renderers consume the SAME filtered rows + handlers (action
  // parity), so search/filters/sort apply equally to each; the toolbar's Layout
  // menu mutates `filterState.layout` through the shared `onChange` setter.

  // Persist the view state on every change. Keyed on [filterState]; the
  // serializer OMITS `selection`, so a selection-only change re-writes a
  // byte-identical blob (never leaking stale ids to the next reload). Guarded
  // for SSR + privacy-mode throws, like the column-width writer.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        FILTER_STORAGE_KEY,
        serializePersistedView(filterState),
      );
    } catch {
      /* ignore quota / privacy-mode throws — the state still lives in memory */
    }
  }, [filterState]);

  // Persist the saved-views list to its own key on every change. Separate from
  // the #48 effect above (different key, different concern), guarded for SSR +
  // privacy-mode throws the same way.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        SAVED_VIEWS_KEY,
        serializeSavedViews(savedViews),
      );
    } catch {
      /* ignore quota / privacy-mode throws — the list still lives in memory */
    }
  }, [savedViews]);

  // Snapshot the CURRENT view config under a name and append it. The id is stable
  // and collision-free (crypto.randomUUID, guarded) — never Date.now/Math.random.
  // currentViewConfig excludes selection, so a saved view never carries row ids.
  const handleSaveView = useCallback(
    (name: string): void => {
      const config = currentViewConfig(filterState);
      setSavedViews((views) => [
        ...views,
        { id: generateViewId(views), name, config },
      ]);
    },
    [filterState],
  );

  // Apply a saved view: rehydrate the live filter state from its config (the
  // shared #48 hydrate path, selection forced empty). The layout now rides
  // inside the config, so hydrateFilterState restores it too. Cloning inside
  // hydrateFilterState means applying never mutates the stored saved view.
  const handleApplyView = useCallback((saved: SavedView): void => {
    setFilterState(hydrateFilterState(saved.config));
  }, []);

  // Remove a saved view by id; the persist effect mirrors the new list to storage.
  const handleDeleteView = useCallback((id: string): void => {
    setSavedViews((views) => views.filter((view) => view.id !== id));
  }, []);

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
  const noItems = !showTable && scopedItems.length === 0;
  const noMatches = !showTable && scopedItems.length > 0 && rows.length === 0;

  // The active Layout (List / Board / Graph) over the SAME filtered rows +
  // handlers. Resolved here so the body JSX below stays a single (non-nested)
  // ternary. Graph folds in the ex-standalone canvas as the third renderer.
  const activeView =
    filterState.layout === "board" ? (
      <WorkboardKanban
        rows={rows}
        owners={owners}
        loading={loading}
        error={error}
        onRetry={refetch}
        groupBy={filterState.groupBy}
        onSelectItem={handleSelectItem}
        onUpdateItem={update}
      />
    ) : filterState.layout === "graph" ? (
      // The graph is a React Flow canvas whose root is `h-full`; it renders
      // nothing unless an ancestor gives a DEFINITE height (the ex-standalone
      // screen got it from the full-height route). Folded into the in-flow Items
      // surface, this wrapper supplies that height so the canvas fills the
      // viewport below the top bar + toolbar.
      <div
        data-testid="workboard-graph-frame"
        className="h-[calc(100vh-13rem)] min-h-[480px]"
      >
        <Suspense fallback={<GraphLoadingFallback />}>
          <WorkboardGraph
            rows={rows}
            dependencies={dependencies}
            owners={owners}
            loading={loading}
            error={error}
            onRetry={refetch}
            onSelectItem={handleSelectItem}
            onUpdateItem={update}
            onAddDependency={addDependency}
            onRemoveDependency={removeDependency}
            filters={
              <GraphFilters
                value={filterState}
                onChange={setFilterState}
                owners={owners}
                departments={teams}
              />
            }
          />
        </Suspense>
      </div>
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
        pendingItemIds={pendingIds}
        resetColumnWidthsRef={resetColumnWidthsRef}
        columnFilters={columnFilters}
      />
    );

  return (
    <section className="flex flex-col gap-4">
      <WorkboardToolbar
        value={filterState}
        onChange={setFilterState}
        owners={owners}
        teams={teams}
        hideTeamFacet={teamId !== undefined}
        selectedCount={filterState.selection.size}
        onNewItem={handleNewItem}
        newItemDisabled={newItemDisabled}
        onBulkApply={handleBulkApply}
        onResetColumnWidths={
          filterState.layout === "list" ? handleResetColumnWidths : undefined
        }
        columnFilters={columnFilters}
        savedViews={savedViews}
        onApplyView={handleApplyView}
        onSaveView={handleSaveView}
        onDeleteView={handleDeleteView}
      />

      {noItems ? (
        <EmptyState
          title={teamId === undefined ? "No work items yet" : "No items in this team yet"}
          description={
            teamId === undefined
              ? "Work items are the coalition hub — create one to plan, execute, and review work across teams."
              : newItemDisabled
                ? "Creating in an empty team needs team status setup — coming soon."
                : "This team has no work items yet — create one to start tracking its work."
          }
          action={
            <Button
              size="sm"
              onClick={handleNewItem}
              disabled={newItemDisabled}
              title={
                newItemDisabled
                  ? "Creating in an empty team needs team status setup (coming soon)"
                  : undefined
              }
            >
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
        checks={editorChecks}
        owners={owners}
      />
    </section>
  );
}

/**
 * Thin route wrapper for `/workboard/team/$teamId`: reads the team id from the
 * URL and renders the shared {@link WorkboardScreen} scoped to that team.
 */
export function TeamItemsScreen() {
  const { teamId } = useParams({ strict: false });
  return <WorkboardScreen teamId={teamId} />;
}
