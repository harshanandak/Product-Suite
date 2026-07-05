# Work Item → real app: port plan & decisions

_2026-07-05. Porting the Work Item mockups (`docs/design/work-item-detail-v11.html`,
`work-item-board.html`) into `apps/platform-web`. This doc captures what shipped, the
decisions that shape the rest, and the PR-by-PR plan so nothing is lost between PRs._

## Context

- App: Vite + React 19 + **TanStack Router (code-based)** + **Tailwind v4 (CSS-first)** +
  shadcn/Radix. Data = a **mock in-memory repository** + the `useWorkItems` hook
  (`src/data/work-items`), **not** TanStack Query. Design tokens: `packages/ui` oklch
  tokens, consumed as **semantic Tailwind classes** (`bg-card`, `text-muted-foreground`),
  never raw `var(--)`.
- UI primitives already exist in `@product-suite/ui`: `Tabs`, `PhasePill`,
  `PriorityBadge`, `WorkItemTypeBadge`, `HealthBadge`, `StatusPill`, `ProvenanceChip`,
  `AssigneePicker`, `EmptyState`, etc. Compose these — do not re-invent.

## The load-bearing decision: model-reality

The mockups are **aspirational**. The real `WorkItem` model
(`src/data/work-items/types.ts`) is deliberately **lean** and tracks DESIGN §11 for a clean
future backend swap:

> `WorkItem` = phase (plan→execute→review→done) · type · priority · tags · source ·
> project_id · department · assignee_id · due_date · archived. Plus `Task` (status triad),
> `WorkItemDependency`, `Project`, `Owner`. Health is **derived, never stored**.

There is **no** milestone / OKR / KR / KPI / memory / meeting / activity / agent-run model.
So: **build the model in order; render UI last in each chain.** Do not build rich UI
(Goals, "thinking" Memory, agent hand-off) ahead of the data + runtime that make it real —
that is fake content, worse than an honest placeholder.

**Rank (what to model vs. defer vs. never):**
- **Model now:** a `description`/body field; an append-only `ActivityEvent` log.
- **Bridge (no new model):** Memory v0 = a filtered view over the existing `source`
  provenance (`meeting`/`agent`/`feedback`) + activity events.
- **Defer:** milestones (plausible, unvalidated).
- **Do NOT model yet:** OKR/KR trees and **connection-sourced KPIs** — vaporware until real
  integrations exist. The "thinking" Insights + recommendation→agent-run hand-off is blocked
  on a real **agent runtime + `AgentRun` record**, not on UI.

## PR 1 — Work Item detail page  ✅ shipped (this branch)

- Route `workboard/item/$itemId` → `src/boards/workboard/detail/WorkItemDetailScreen.tsx`
  (mirrors `WorkboardGraphScreen`: self-fetches via `useWorkItems`, `repository` seam for
  tests). Typed route params via `useParams({ from })`.
- Tabs **Overview · Tasks · Activity** (only tabs backed by real data ship; Goals/Memory are
  documented in the mockup but intentionally NOT shipped as dead tabs).
  - Overview: task-progress bar + tags (+ honest "no description yet" until the field lands).
  - Tasks: the real `Task` records with `StatusPill`.
  - Activity: honest placeholder (becomes real in PR 5).
- Right rail: Properties (type/phase/priority/health/owner/due/department/project/source/deps)
  + Tags. **Edit** button opens the existing `WorkItemEditor` Sheet, wired to `hook.update` —
  the page is a real read **and** edit surface.
- **Verified:** `tsc --noEmit` clean · full suite 455 tests still pass · new render test
  (`WorkItemDetailScreen.test.tsx`, 2 cases) + route-registration assertion, green.

## Next PRs (ordered)

1. **PR 2 — Entry point.** Make the page reachable: `WorkboardScreen.handleSelectItem`
   → `navigate({ to: "…/workboard/item/$itemId", params })` for table + kanban; the
   `WorkItemEditor` Sheet is demoted to quick-edit (row menu / detail "Edit"). **Blocker /
   scope reason it is its own PR:** no workboard-screen test sets up router context, so
   adding `useNavigate` there requires giving those tests a router wrapper first. Keep the
   board's inline-edit so editing is never lost.
2. **PR 3 — Task fetch seam.** `repository.listTasks(workItemId?)` — stop fetching ALL tasks
   and client-filtering (detail + graph + workboard screens). Do before a real backend
   inherits the fetch-everything contract.
3. **PR 4 — `description` field.** Add to `WorkItem` (+ `WorkItemPatch`, repo seed, the
   editor textarea, Overview rendering). Makes the Overview real.
4. **PR 5 — Activity log.** An append-only `ActivityEvent` emitted from repository mutations
   (create/update/dependency changes); render the real Activity tab from it.
5. **PR 6 — Memory v0.** A read-only view over `source` provenance + the activity log
   (Agent work / Meetings / Decisions fall out of existing data). No new model.
6. **PR 7 — Board Map view.** Add `"map"` to `WorkboardView` (`filter-state.ts`) beside
   table/kanban; render the Project ▸ Items ▸ Tasks hierarchy (`work-item-board.html` Map).
7. **Later (gated on real capability):** agent runtime + `AgentRun` record → the Insights
   "thinking" surface + recommendation→agent-run hand-off; milestones (if validated).
   OKR/KR/KPI only if/when integrations exist.

## References

- Mockups: `docs/design/work-item-detail-v11.html`, `work-item-board.html`,
  `work-item-architecture-visual.html`.
- Full IA + design decisions live in the design-system memory (mockups must match the real
  `packages/ui` tokens — never invent an aesthetic).
