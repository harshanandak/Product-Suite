# L1 Workboard — Graph View (design)

**Bead:** product-suite-97f (Phase 1/L1 Workboard) · **Increment:** Graph view (peer of Table + Kanban)
**Date:** 2026-06-24 · **Branch:** feat/l1-workboard
**Status:** proposed — awaiting approval before implementation

---

## 1. Goal & binding constraints

Add the **Graph view** as a third peer in the Workboard view switcher (`table | kanban | graph`),
built on **React Flow (`@xyflow/react` v12) + dagre** — the stack DESIGN §10 decided
(2026-06-12, six-agent-verified; BlockSuite is exiting and must not be used in new code).

Binding constraints (DESIGN §3 principle 7, §10):

- **Full action parity.** A node click opens the *same* `WorkItemEditor` sheet a table row /
  kanban card opens. A view that can only read is incomplete.
- **Gestures are real mutations on the one record — never canvas-local state.** This is the
  documented prior-failure trap (§10 line 169: the old React Flow attempt stored task data in
  component state). Every gesture flows through the repository seam:
  - **drag an edge between two nodes → create a dependency** (`addDependency`)
  - **drop a node into a phase band → change phase** (`update(id, {phase})`)
- **Nodes = work items; edges = existing dependency records.** Edges are persisted records, not
  decoration.
- **Phase on items only**, status on tasks only; **health is derived, never an axis** (§1/§3).
- **Auto-layout via dagre**; no canvas-owned storage beyond optional pinned positions (deferred).

## 2. Data-seam extension — dependencies

Edges require a dependency record the seam does not yet have. **Do not invent the shape** —
ground it in the **closest existing precedent**, the legacy `linked_items` table
(`infra/supabase/migrations/20250101000000_initial_schema.sql:30`), so the seam tracks something
real. Caveat: `linked_items` is keyed to `timeline_items` (the legacy object), so this is a
*precedent*, not a guarantee — F2 may rename/rekey for `work_items`; grounding here just keeps the
eventual adapter swap small.

`linked_items` columns: `id, source_item_id, target_item_id, relationship_type
('depends_on'|'blocks'|'complements'|'conflicts'|'extends'), reason, direction, created_at,
UNIQUE(source_item_id, target_item_id)`.

New frontend model (`data/work-items/types.ts`):

```ts
export interface WorkItemDependency {
  readonly id: string;
  source_item_id: string;          // the dependent work item
  target_item_id: string;          // the prerequisite work item ("source depends on target")
  relationship_type: DependencyRelationship; // v1 default: "depends_on"
  readonly created_at: string;
}
export type DependencyRelationship = "depends_on" | "blocks" | "complements";
```

- Drop legacy `direction` — redundant for a directed `source → target` edge.
- `reason` omitted in v1 (no UI for it yet); add later without breaking the shape.
- Edge semantics for the graph: `source_item_id` **depends on** `target_item_id`; arrow points
  source → target (toward the prerequisite). One relationship_type rendered in v1 (`depends_on`);
  the type is on the record so other kinds drop in later.

Repository interface additions (`repository.ts`), mock-backed, each async (seam rule):

```ts
listDependencies(): Promise<WorkItemDependency[]>;
addDependency(input: { source_item_id: string; target_item_id: string;
  relationship_type?: DependencyRelationship }): Promise<WorkItemDependency>;
removeDependency(id: string): Promise<void>;
```

Mock invariants (reject, do not silently no-op):
- unknown `source`/`target` id → reject
- **self-edge** (`source === target`) → reject
- **duplicate** (existing `source → target`) → reject (mirrors the UNIQUE constraint)
- **cycle** (the new edge would close a directed cycle) → reject (dagre needs a DAG)

Fixtures (`fixtures.ts`): ~4–6 dependency records across the seeded items so every view has real
edges to render and tests are realistic (mirrors how rows/tasks are seeded).

Hook (`use-work-items.ts`): surface `dependencies: WorkItemDependency[]` plus optimistic
`addDependency` / `removeDependency` mutators with rollback, mirroring the existing `update`
pattern (sync pre-edit capture via ref, `mountedRef` guard, re-throw on failure).

## 3. Performance strategy — built for thousands of nodes

This is the core requirement. Every lever below is grounded in the React Flow v12 docs
(reactflow.dev, verified 2026-06-24).

| Lever | What | Why |
|---|---|---|
| Module-level `nodeTypes`/`edgeTypes` | defined **outside** the component | recreating them each render forces a full remount — the #1 React Flow footgun |
| `React.memo` custom node (`WorkItemNode`) | memoize the node component | a node re-renders only when *its* data changes, not on every viewport move |
| `onlyRenderVisibleElements` | viewport culling | only nodes inside the viewport mount — the single biggest win at scale |
| Layout memoized on **topology**, not render | dagre runs only when node-id set / edge pairs / phases change | dagre is O(V+E) and synchronous; never re-run it on pan/zoom or a position drag |
| `useCallback`/`useMemo` for all prop fns/objects | `defaultEdgeOptions`, `fitViewOptions`, handlers | prevents prop-identity churn that defeats memoization |
| Bounded zoom + `fitView` | `minZoom`/`maxZoom`, `fitViewOptions={{ maxZoom: 1 }}` | a huge graph never zooms to a single node on open |
| Static edges | `defaultEdgeOptions` with a plain marker, **no `animated`** | animated edges repaint every frame — banned at scale |
| `nodeDragThreshold` | small px threshold | a click is never a drag (parity with Kanban's distance gate) |
| MiniMap gated | render only below a node threshold (or simple rects) | the minimap re-renders all nodes; it is a scale cost |
| **Lazy-load the view** | `React.lazy` + dynamic import of `WorkboardGraph` and `@xyflow/react` CSS | the heavy library + CSS load only when the Graph tab opens — Table/Kanban stay lean |
| **LOD tiers** (§3a) | graph-level zoom→tier→`node.data.lod`; nodes memoized on tier | far-out nodes render cheap; full detail only when zoomed in |
| **Clustering** (§3a) | aggregate nodes when zoomed out; dagre lays out clusters, not members | the only lever that actually cuts dagre's synchronous O(V+E) cost |
| **Focused neighborhood** (§3a) | seed from `focusId` + k-hop; expand frontier on pan/zoom | small initial set; never a full-graph load up front |

### 3a. Seamless level-of-detail (the scale strategy — decided with the user)

No hard "you have too many items" wall. Instead, the graph stays fluid at thousands of nodes via
**level-of-detail (LOD)** keyed to zoom + a **focused neighborhood** entry — render little, hydrate
on demand, aggregate when far.

**The footgun this design avoids.** `useViewport()`/`useStore(zoom)` re-render their subscriber on
*every* viewport delta. If each node subscribed to zoom, panning would trigger a re-render storm —
the opposite of fast. **Fix:** one subscription at the graph level reads zoom, **discretizes it to a
tier** (an integer), and writes that tier into each node's `data.lod`. Nodes are `React.memo`'d on
`data` → they re-render only when their tier **crosses a boundary**, not on every zoom delta. The
zoom→tier read is throttled (rAF/trailing) so even the graph-level recompute is bounded.

**Three LOD tiers (zoom thresholds are named constants):**

| Tier | Zoom | Node renders | Cost |
|---|---|---|---|
| **0 — far** | zoomed out | **clusters**: groups collapse into one aggregate node ("12 items", phase-tinted) | very low — few nodes to lay out |
| **1 — mid** | medium | **compact**: title + phase pill only; no badges/owner/tags/provenance | low |
| **2 — near** | zoomed in | **full**: type/priority/health badges, owner, due, tags, provenance | full, but few are on-screen |

"Don't load node info until they zoom in / tap" = tiers 0→1→2. Tier-2 detail mounts only for the
handful of nodes actually near the viewport (with `onlyRenderVisibleElements` culling the rest).

**Clustering on zoom-out (tier 0) is the real scale lever.** `onlyRenderVisibleElements` culls the
**DOM** but does **not** reduce dagre's cost — dagre is synchronous, O(V+E) over *every* node, and
blocks the main thread. Clustering cuts that at the root: at tier 0 we lay out **aggregate** nodes
(one per cluster), not the thousands underneath. Cluster key = **phase** (Phase mode) or
**project / connected-component** (Dependencies mode). Tapping a cluster, or zooming into it,
expands it (drills into its members). This keeps dagre operating on tens of nodes, not thousands.

**Focused-neighborhood entry ("load from where the user came").** The view accepts an optional
`focusId` (e.g. the work item the user navigated from, or the selected row). When set, it seeds with
that node + its **k-hop dependency neighborhood** and centers there; panning/zooming toward the
frontier expands outward (load-more frontier), so the user never waits on a full-graph load.

- **Seam shape:** add `listGraph({ focusId?, depth? })` to the repository (returns nodes + edges for
  a neighborhood). The **mock slices client-side** from its fixtures — honestly simulated, since the
  fixture set is tiny; the value now is that the *interface* exists so F2's server-driven
  neighborhood query drops in without touching the view. Full server-side incremental loading lands
  with F2 (called out in §8).

**Net:** DOM culling (`onlyRenderVisibleElements`) + LOD tiers (cheap nodes far out) + clustering
(few nodes for dagre) + focused neighborhood (small initial set) = seamless at thousands, with no
blocking wall. All thresholds are named constants; nothing is silently truncated (a collapsed
cluster always shows its member count).

## 4. Layout — switchable Dependencies ⇄ Phase (decided)

A one-click toggle switches the major axis. Phase-position and dependency-rank cannot both be the
major axis at once (dagre ranks by dependency depth; making phase the axis reduces dagre to
within-band packing), so they are **separate modes**, faithful to §10's "organize by dependency
order, phase, or assignee". Both are pure functions in `layout.ts`, unit-tested without React Flow.

- **Dependencies mode (default).** dagre `rankdir="LR"`, ranking nodes by what-blocks-what — the
  graph's distinct value over Kanban. Phase is shown as a pill on each node; **change phase by
  inline-editing the pill** (full parity, same as the table's inline phase edit). Edge-drag creates
  a dependency. No phase-band drop target in this mode (there are no bands).
- **Phase mode (swimlanes).** Four lanes `plan → execute → review → done` as background regions;
  dagre packs nodes within each lane. **Drop a node into another lane → change phase** — the literal
  §10 gesture. On `onNodeDragStop`, a pure `resolvePhaseFromPosition(centerX|Y, lanes)` helper
  (analogue of Kanban's `resolvePhaseChange`) resolves the lane → if changed, fire
  `update(id, { phase })`. Edge-drag still creates dependencies (drawn across lanes).

Common to both: a one-click **Auto-layout** re-runs the active layout (presentation only — never a
data change); phase-pill inline edit and edge-drag work in both modes. The toggle is local view
state (not persisted in v1).

## 5. Edge cases (explicit)

- **Cycle creation** → `isValidConnection` runs a DFS over the **full** dependency set (NOT the
  visible-filtered edges — otherwise a user could close a cycle through a hidden node and crash
  dagre) and rejects any connect that would close a cycle; the mock repo rejects too (defence in
  depth). dagre also gets `acyclicer: "greedy"` so a pre-existing bad edge can't crash layout.
  Note the asymmetry: **validate against all dependencies; render only the visible subset.**
- **Self-loop** (`source === target`) → `isValidConnection` returns false; no edge offered.
- **Duplicate edge** → rejected at both validation and repo layers.
- **Edge to a filtered-out node** → edges are computed only between *visible* node ids; a dependency
  whose endpoint is hidden by the current filter is dropped (no dangling edge to nowhere).
- **Orphan nodes** (no edges) → still laid out (placed within their phase band).
- **Empty / loading / error** → mirror Kanban exactly: skeleton (`role=status aria-busy`),
  `ErrorState` + Retry, `EmptyState`.
- **Read-only mode** (mutators absent) → nodes not draggable, connect handles hidden — mirrors
  Kanban's `draggable` gating.
- **Optimistic failure** → dep add/remove and phase change roll back via the hook; a failed gesture
  simply never appears in the next render.
- **Archived nodes** → de-emphasized (opacity) but shown, consistent with Kanban.
- **Long titles** → truncated in the node.
- **Layout determinism** → dagre seeded deterministically so the graph does not reshuffle on every
  open; pinned positions are deferred (DESIGN allows "optional pinned positions" later).
- **a11y** → nodes carry `aria-label`; React Flow's built-in keyboard nav is kept; node activation
  works by keyboard (Enter/Space → open editor).
- **jsdom/tests** → React Flow needs `ResizeObserver` + element dimensions jsdom lacks. Strategy:
  put the **bulk of test value in pure helpers** (cycle check, phase-from-position, dagre layout
  fn, visible-edge filtering) tested without rendering React Flow; the component test shims
  `ResizeObserver` + a sized container and asserts parity (node click → onSelectItem) and the
  guard/empty/error/read-only states.

## 6. Files

**Data seam**
- `apps/platform-web/src/data/work-items/types.ts` — `WorkItemDependency`, `DependencyRelationship`
- `…/repository.ts` — interface methods + mock impl + invariants
- `…/fixtures.ts` — dependency fixtures
- `…/use-work-items.ts` — surface `dependencies` + optimistic mutators
- `…/index.ts` — export the new type(s)

- `…/repository.ts` — also `listGraph({ focusId?, depth? })` (neighborhood; mock slices fixtures)

**Graph view**
- `apps/platform-web/src/boards/workboard/graph/WorkboardGraph.tsx` — the view (lazy-loaded);
  owns the zoom→LOD-tier subscription, layout-mode toggle, focus/frontier state
- `…/graph/WorkItemNode.tsx` — `React.memo` custom node; renders by `data.lod` (compact ↔ full)
- `…/graph/ClusterNode.tsx` — `React.memo` aggregate node ("N items", phase-tinted; tap → expand)
- `…/graph/layout.ts` — **pure**: dagre DAG (Dependencies mode) + swimlane packing (Phase mode),
  topology signature, cycle detection (full set), `resolvePhaseFromPosition`, visible-edge filtering
- `…/graph/cluster.ts` — **pure**: cluster-by-key, aggregate-node build, expand/collapse resolution
- `…/graph/lod.ts` — **pure**: `zoomToTier(zoom)` + tier constants
- `apps/platform-web/src/boards/workboard/WorkboardScreen.tsx` — extend view union → add `graph`
  tab + lazy `Suspense`; pass `dependencies` + mutators + optional `focusId`

**Tests** (Vitest + Testing Library, repo convention)
- `…/data/work-items/repository.test.ts` — dependency CRUD + invariants + `listGraph` (extend)
- `…/data/work-items/use-work-items.test.ts` — optimistic add/remove + rollback (extend)
- `…/graph/layout.test.ts`, `cluster.test.ts`, `lod.test.ts` — all pure helpers (bulk of coverage)
- `…/graph/WorkboardGraph.test.tsx` — render parity, mode toggle, empty/error/read-only

**Deps** (`apps/platform-web/package.json`)
- `@xyflow/react` (v12), `dagre`; dev: `@types/dagre`

## 7. Sequencing — two stacked slices (clean to review/land)

**Slice A — graph view + parity (a complete, usable view):**
1. Dependency seam: types → repository (CRUD + invariants + `listGraph`) → fixtures → hook, tested.
2. Pure `layout.ts` (both modes) + tests.
3. `WorkItemNode` (full detail) + `WorkboardGraph` (lazy) + switchable layout, wired into
   `WorkboardScreen`; parity gestures (click→editor, edge-drag→dependency, drop→phase, pill edit).
4. Component test (parity + mode toggle + empty/error/read-only).
5. Full gate green (lint, types, tests, SonarCloud new-code clean).

**Slice B — seamless at scale (stacked on A):**
6. `lod.ts` + `cluster.ts` (pure) + tests.
7. LOD tiers wired (zoom→tier→`node.data.lod`; compact rendering), `ClusterNode`, focus/frontier.
8. Component/perf tests for tiering + clustering; full gate green.

Each slice is its own PR. Slice A delivers a working graph; Slice B makes it fluid at thousands.

## 8b. Slice A — built (status + deviations, 2026-06-24)

Slice A is implemented and verified green: `tsc --noEmit` ✅, `eslint` ✅, **214 tests** ✅
(`layout.test.ts` 27 + `WorkboardGraph.test.tsx` + the seam/table/kanban suites), and
`vite build` ✅ — which **proves the lazy-load**: a separate `WorkboardGraph` chunk
(~234 kB JS + ~16 kB CSS for React Flow + dagre) is emitted, so the canvas stack stays out of the
main bundle until the Graph tab opens.

Files delivered: `graph/layout.ts` (+ test), `graph/WorkItemNode.tsx`, `graph/WorkboardGraph.tsx`
(+ test); `WorkboardScreen.tsx` wired (lazy `graph` tab + dependency mutators). The data seam from
step 1 is unchanged.

**Deviations from the plan above (so the doc stays truth):**
- `resolvePhaseFromPosition(centerX, lanes, currentPhase)` — gained a third `currentPhase` param.
  The "same-column drop → null" rule is unsatisfiable from `(coord, geometry)` alone; this matches
  the named analogue, Kanban's `resolvePhaseChange(fromPhase, overId)`.

**Hardening pass — done (2026-06-24, user chose full hardening + vertical columns):**
- **Phase lanes flipped to VERTICAL columns** (Plan │ Execute │ Review │ Done, Kanban grammar),
  matching the approved preview. `layoutPhase` packs top-to-bottom per column; columns are placed
  left-to-right; `resolvePhaseFromPosition` resolves on `centerX`; the drag handler uses
  `node.position.x + NODE_WIDTH/2`. Lane tests updated.
- **SonarCloud decomposition done:** extracted `GraphToolbar` + a `useGraphElements` hook, so
  `WorkboardGraphInner` is now a thin (~90-line) assembly — well under `S138`. Also folded the
  double `layoutPhase` call into one memoized `phaseLayout`.
- **Gesture-decision tests added** (`gestures.ts` + `gestures.test.ts`): `canCreateDependency`
  (rejects self/duplicate/cycle, validates against the FULL set incl. hidden nodes) and
  `connectionToDependencyInput`. The view's `isValidConnection`/`onConnect` are now thin wrappers.

**Verification status:** `tsc` ✅, `eslint` ✅, `vite build` ✅ (lazy chunk emitted). After a
machine restart the **full workboard + seam suite is green: 224/224** (16 files, ~30s). The earlier
timeout-only failures were confirmed to be local machine resource exhaustion (a VS Code file-watcher
kept spawning hung `bun test` workers; RAM ~3 GB) — NOT a code defect; they vanished on a fresh box.

**Visual smoke test — DONE (2026-06-25):** rendered the Graph tab in a real browser via a temporary
standalone entry (deleted after) + Playwright. Both modes verified by screenshot. It caught two real
bugs the jsdom tests structurally could not, both fixed:
1. **Nodes overlapped** in Dependencies mode — `NODE_HEIGHT` (120) under-declared the real card to
   dagre; measured the live card at ~203 px and set the footprint to 240×210 (+ `RANK_SEP` 120,
   `NODE_SEP` 48, `LANE_NODE_GAP` 40). Cards now have a clear gutter.
2. **Phase columns misaligned** — lane backgrounds rendered in container space while nodes live in
   the pan/zoom-transformed viewport, so after `fitView` every card sat one column off its header.
   Fixed by wrapping `PhaseLanes` in React Flow's `<ViewportPortal>` (shared coordinate system).
   Re-verified: Plan/Execute/Review/Done cards now sit under their correct column headers.

## 8c. Graph moved to its own sub-board + summary removed (2026-06-25, user UX feedback)

Two UX changes after reviewing the live build:

1. **Workboard summary strip removed.** The phase/health distribution charts did not belong on the
   work-items table page. `WorkboardSummary` (component + test) deleted; `WorkboardScreen` no longer
   renders it. The work-items page is now header → Table|Kanban tabs → toolbar → table.

2. **Graph is its own full-page sub-board, not an inline tab.** It is an unbounded canvas, so it
   gets its own route + sidebar item rather than a cramped slice under the table:
   - Route `/w/$workspace/workboard/graph` → `WorkboardGraphScreen` (full-page; lazy-loads the graph
     so `@xyflow/react` stays a separate chunk; reuses the editor for node-click parity).
   - Sidebar: a **Graph** item (Network icon) under Workboard in `shell/boards.ts`.
   - `WorkboardScreen` view union reverted to `table | kanban` (no Graph tab).
   - **Full-bleed canvas** — no border/frame and **no page header**; the canvas owns the whole
     content area (flex chain: section `h-full` → `flex-1` → canvas `flex-1`), verified in a browser.
   - **All controls float INSIDE the canvas** via React Flow `<Panel>`s: **view controls top-right**
     (Dependencies/Phase toggle + Auto-layout — bare ghost buttons, no card/border), **filters
     top-left** (see below).
   - **In-canvas filters** (`GraphFilters`): a floating cluster with Search + the five facet menus
     (Type / Owner / Department / Phase / Priority) + Clear. Reuses the Table's `FacetFilterMenu`
     (extracted to a shared module) and the shared `buildFacetOptions` + `toggledSet`, and the same
     `applyWorkboardFilters` engine — so the graph and the Table filter identically. The screen owns
     the `WorkboardFilterState` and renders only the matching rows (search narrows the graph,
     verified by test). Owner facets are still `outline` buttons (consistent with the Table).

   Tests: new `WorkboardGraphScreen.test.tsx` (render, node-click parity, search-narrows-graph,
   error) + `GraphFilters` via that screen; `router.test`/`boards.test` extended for the route +
   sidebar item. Project scoping + focused-neighborhood load remain the Slice B scale layer.

**Test-infra fix:** raised vitest `testTimeout`/`hookTimeout` to 15s (`vitest.config.ts`). The 5s
default flaked as timeouts on this suite's heaviest userEvent + React Flow + Radix tests under load
(matching the project's own `bun test --timeout 15000` watcher). Verification: every file passes in
isolation (graph 49/49, table 33/33, boards/router green); the full parallel run is 258/259 with the
lone failure a peak-contention timeout (never an assertion).

## 8. Out of scope (named, not silent)

- **Full server-driven incremental loading.** Slice B builds the `listGraph` seam + frontier
  wiring, but the mock slices fixtures client-side; true server-paged neighborhood loading lands
  with F2 (which owns the query shape).
- **Assignee** organize mode (§10 lists it; Dependencies + Phase cover v1).
- Persisted layout-mode toggle and pinned/persisted node positions (DESIGN "optional" — later).
- Edge **deletion** UI beyond select+Delete (kept minimal in v1).
- Relationship types other than `depends_on` in the UI (the record supports them; rendering one).
- §11 task parenting (already deferred on the bead to the task-model slice).
- The freeform planning canvas (separate surface; shares the React Flow stack later).
