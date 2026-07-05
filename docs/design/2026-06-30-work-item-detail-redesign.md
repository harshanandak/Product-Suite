# Work Item Detail Page — Redesign Spec

> **⚠️ Superseded — exploratory design, not the shipped model.** Kept for design
> history. The build follows
> [`2026-07-05-work-item-port-plan.md`](2026-07-05-work-item-port-plan.md), which
> deliberately ships a lean subset (flat tasks + phase lifecycle; **no** nested
> containers, OKR/KeyResult, or KPI entities). Notably the canonical route shipped as
> `workboard/item/$itemId`, not the `/work-items/$id` sketched below.

Status: DRAFT for review · 2026-06-30 · app: `apps/platform-web`

## Goal
A dedicated per-work-item **detail page** (the "hub" for one work item), grounded in the platform-web wireframe `docs/design/user-flow-wireframes.html#item`. Rethink/trim, not a port of `roadmap-web`'s 10-tab page. The current right-side quick-edit **Sheet** (`WorkItemEditor`) stays; the page is the deep view.

## Decisions (agreed)
1. **Grounding:** the `#item` wireframe (curated single page, not roadmap-web's 10 tabs).
2. **Presentation:** a new **route** `/work-items/$id`, deep-linkable. **Keep the Sheet** for fast inline edits from the board; the page is for depth. Board Name-cell click → Sheet (quick); row-actions "Open full page" / direct URL → the page.
3. **Scope:** lay out the **full hub** now; render real data where it exists, and **clean placeholder empty-states** for sections whose data entities don't exist yet — so the whole structure + the path forward is visible, kept clean and on-point.
4. **Layout:** wireframe-faithful — breadcrumb top bar; two-column body = scrolling **main** (section cards) + fixed **~230px metadata rail**.

## Layout
```text
┌────────────────────────────────────────────────────────┐
│ Workboard / <Title>                                  ⌘K │  breadcrumb
├──────────────────────────────────────┬─────────────────┤
│ <Title>  ·phase segs·  ⚠ derived health│  METADATA RAIL  │
│ [N tasks · N meetings · N agents · …]  │  Type           │
│ ┌ Description ───────────────────────┐ │  Health · why?  │
│ ┌ Evidence (placeholder) ───────────┐ │  Priority       │
│ ┌ Connected (placeholder) ──────────┐ │  Owner          │
│ ┌ Plan (placeholder) ───────────────┐ │  Due            │
│ ┌ Linked tasks ─────────────────────┐ │  Department     │
│ ┌ Meetings (placeholder) ───────────┐ │  Tags           │
│ ┌ Agent conversations (placeholder) ┐ │  Project        │
│ ┌ Comments (placeholder) ───────────┐ │  Phase          │
│              (scrolls) ↕             │ │  Source         │
│                                       │ │  Depends-on →   │
└──────────────────────────────────────┴─────────────────┘
```

## Per-section plan
**REAL (v1, data exists or one small field add):**
- **Header** — title, phase segments, **derived** health pill (DESIGN.md §11: never hand-set), counts strip (real counts: tasks, dependencies; others show 0/placeholder).
- **Description** — NEW: add `description?: string` to `WorkItem` + `WorkItemPatch` + mock repo/fixtures. Inline-editable on the page.
- **Linked tasks** — real (`Task` entity): list with status, add-task. 
- **Dependencies** — real (`WorkItemDependency`): depends-on / blocks / complements, link to graph.
- **Metadata rail** — real: Type, Health (+ "why?" popover), Priority, Owner, Due, Department, Tags, Project, Phase, Source, Depends-on→graph. All editable inline with **action parity** (DESIGN.md §3.7 — edits reflect in board/kanban via shared data state).

**PLACEHOLDER (clean empty-state cards; wired in later phases):**
- **Evidence** (insights & inspiration), **Connected** (live connector bindings, project-kind-aware), **Plan** (milestones · risks · prerequisites), **Meetings**, **Agent conversations**, **Comments**. Rail: **Strategy alignment**, **Visibility**. Each placeholder states what it will hold + (where apt) a disabled CTA, so the roadmap is legible without dead clutter.

## Data-model / infra changes (v1)
- Add `description` to `WorkItem` + `WorkItemPatch` + `fixtures.ts` + mock repo `update`.
- New TanStack Router route `/work-items/$id` (loader resolves the item via the existing hook/repository); 404/empty + error states (`EmptyState`/`ErrorState`).
- Entry points: row-actions "Open full page", a header link from the Sheet, deep-link URL. Board Name-click keeps opening the Sheet.

## Reusable UI + gaps (`@product-suite/ui`)
- Reuse: `Card`, `ScrollArea`, `Separator`, `Avatar`, `Badge`, domain badges/pickers (`PhaseSelect`/`PrioritySelect`/`WorkItemTypeSelect`/`AssigneePicker`/`TagInput`/`HealthBadge`/`ProvenanceChip`/`StatusPill`), `Tooltip`/`HoverCard` (health "why?"), `Button`, `EmptyState`.
- **Gaps to add:** `Breadcrumb` (top bar) and a `Collapsible`/`Accordion` (optional, for tidy placeholder sections) — neither is exported today.

## Phasing (after v1)
Wire placeholders as their domains land, suggested order: **Comments** (cheap, high-value) → **Plan** → **Meetings**/**Agent conversations** → **Evidence** → **Connected** (needs connector integrations). Each becomes its own focused PR.

## Non-goals (v1)
No new connector integrations, no meeting/agent/insight/feedback/comment entities yet, no versions/metrics/AI-copilot tabs (roadmap-web extras dropped). Strategy/Visibility deferred.

## Open questions
- Route path: `/work-items/$id` vs nested under a board (`/boards/workboard/items/$id`)?
- Add `Breadcrumb` to `@product-suite/ui` (shared) or a local component?
- Placeholder style: inline empty cards vs one collapsed "Planned" group (current plan: inline, in-position).
