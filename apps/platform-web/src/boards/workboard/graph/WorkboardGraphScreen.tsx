import { lazy, Suspense, useCallback, useMemo, useState } from "react";

import { useNavigate, useParams } from "@tanstack/react-router";

import { Skeleton } from "@product-suite/ui";

import {
  getDefaultRepository,
  useRepositoryContext,
  useWorkItems,
  type WorkItemRepository,
  type WorkItemRow,
} from "@/data/work-items";

import {
  applyWorkboardFilters,
  defaultWorkboardFilterState,
  workboardDepartments,
} from "../filter-state";
import { GraphFilters } from "./GraphFilters";

/**
 * The graph view is LAZY-loaded: `@xyflow/react` + dagre + the React Flow CSS
 * form a heavy chunk that should load only when this route is opened — keeping it
 * out of the main bundle (the split is verified by a separate build chunk).
 */
const WorkboardGraph = lazy(() => import("./WorkboardGraph"));

/** Announced skeleton shown while the lazy graph chunk downloads. */
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
 * Props for {@link WorkboardGraphScreen}. The screen self-provides its data (it
 * IS the live route); the optional repository SEAM lets tests drive it against a
 * controlled fixture store without touching the module singleton.
 */
export interface WorkboardGraphScreenProps {
  repository?: WorkItemRepository;
}

/**
 * Workboard GRAPH SCREEN — the full-page dependency/phase canvas (DESIGN §4/§10).
 *
 * Its OWN sub-board route (`/w/$workspace/workboard/graph`), not an inline tab:
 * the graph is an unbounded canvas, so it takes the whole content area rather
 * than a cramped slice beneath the work-items table. It reuses the data seam and
 * activating a node navigates to the item's detail PAGE — the SAME target a
 * table row / kanban card opens (action parity, §1) — while edge-drag / phase
 * changes flow through the seam mutators (gestures are real mutations, §10).
 *
 * The canvas renders ALL items (unfiltered) in v1; scoping (project switcher,
 * focused-neighborhood load) is the Slice B scale layer. The page is deliberately
 * lean — no table toolbar/filters — so the canvas stays uncluttered.
 */
export function WorkboardGraphScreen({
  repository,
}: Readonly<WorkboardGraphScreenProps> = {}) {
  const contextRepo = useRepositoryContext();
  const [repo] = useState<WorkItemRepository>(
    () => repository ?? contextRepo ?? getDefaultRepository(),
  );

  // Node activation routes to the item's detail PAGE (parity with the table +
  // kanban) — needs the router's navigate + the current workspace param.
  const navigate = useNavigate();
  const { workspace } = useParams({ from: "/w/$workspace/workboard/graph" });

  const {
    items,
    owners,
    dependencies,
    loading,
    error,
    update,
    refetch,
    addDependency,
    removeDependency,
  } = useWorkItems({ repository: repo });

  // Filter state for the in-canvas filter cluster. The graph renders only the
  // rows that pass the active search + facets (same engine the Table uses).
  const [filterState, setFilterState] = useState(defaultWorkboardFilterState());
  const departments = useMemo(() => workboardDepartments(items), [items]);
  const rows = useMemo(
    () => applyWorkboardFilters(items, filterState, owners),
    [items, filterState, owners],
  );

  // Node activation opens the item's durable detail PAGE (same target the table
  // + kanban use), not the quick-edit Sheet — the graph's own inline edit
  // affordances (phase pill, edge drag) still flow through the seam mutators.
  const handleSelectItem = useCallback(
    (row: WorkItemRow) => {
      // Fire-and-forget navigation; the trailing .catch keeps this void-returning
      // handler from floating a promise — and logs a transient router failure
      // instead of swallowing it silently (a dead click with no trace).
      navigate({
        to: "/w/$workspace/workboard/item/$itemId",
        params: { workspace, itemId: row.id },
      }).catch((error: unknown) => {
        console.error("[workboard graph] navigation to item detail failed", error);
      });
    },
    [navigate, workspace],
  );

  // No page header/chrome — the canvas is full-bleed and owns the whole content
  // area; the active sidebar item is the only "you are here" affordance needed.
  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col">
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
                departments={departments}
              />
            }
          />
        </Suspense>
      </div>
    </section>
  );
}

export default WorkboardGraphScreen;
