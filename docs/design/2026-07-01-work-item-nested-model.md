# Work Item Model — Nested Architecture (PROPOSAL v2)

> **⚠️ Superseded — exploratory design, not the shipped model.** Kept for design
> history. The build follows
> [`2026-07-05-work-item-port-plan.md`](2026-07-05-work-item-port-plan.md), which
> deliberately ships a lean subset (flat tasks + phase lifecycle; **no** nested
> containers, OKR/KeyResult, or KPI entities). The entities and invariants below are
> exploration, not a build contract.

**Status: PROPOSAL — design consolidated, NOT approved for implementation.** See §0 decision gate.
Date: 2026-07-01. Would supersede the flat `Project → WorkItem → Task` model *if adopted*.

## 0. Decision gate (read first — still open)
This grew from a *detail-page redesign* into questioning the *data model*. It is a large change to a
**pre-production** app — confirmed: the data layer is an in-memory mock/fixtures repository built ahead of
the "F2" backend (not wired). **No production data exists → cost is UI + test rework, NOT a migration.**

Two ways forward — the user's call, not the doc's:
- **A — Redirect now.** Adopt this as the new foundation; the detail page waits; the shipped workboard
  (table/graph/deps/editor + tests, #47–#58) is reworked onto it. Defensible *because* it's pre-production.
- **B — Capture & return.** Keep this doc as the agreed direction; return to the detail page on today's
  model now, folding in only the separable phase-lifecycle win (§8).

**Do not implement until A or B is chosen.**

## 1. Core idea
A work item *is* a project-like container. **One nestable shape** covers "project," "work item," and
"task" — they differ by **depth, not type.** Methodology (scrum vs simple) is an **optional overlay** on
the same data, never a different schema. The mandatory core is tiny (§6); everything else is opt-in.

## 2. Objects
### Item — one recursive type, bounded depth
- `id, title, owner (nullable → queue), parent_id (nullable = top level), priority, tags, due_date, archived, created_at, updated_at`
- `children`: 0..N Items. **A leaf Item (no children) is a "task."**
- **Bounded nesting (~3 levels): Project / Work item / Task.** Not infinite (bounded is simpler and enough;
  Linear caps it deliberately). No separate `Project`/`Task` entity — both are Items at different depths.

### Dependency — any level
- Directed "X waits on Y" edge between **any two items, including leaf tasks** ("tasks are codependent").
  DAG-guarded (no cycles), as today, generalized beyond item-level.

### Attachment — research / planning artifacts (`kind: source | document | file`)
- **source** — a cited reference (title, url/origin, found-by/provenance, optional relevance note)
- **document** — a written artifact, either **authored in-app** (rich-text editor) **or uploaded** as a
  doc file (`origin: authored | uploaded`); e.g. a brief, spec, or contract draft
- **file** — a generic upload that isn't a document (image, asset, invoice) — filename, url, size, type
- **`tags: string[]`** on every attachment — categorize by *what it is* ("competitor-research",
  "pricing-data", "interview", "contract-draft", "invoice"). Reuses the existing item `tags` idiom
  (TagInput/TagList components), and **replaces the wireframe's rigid insight-type enum with flexible tags**.
  Makes the research workspace filterable/groupable by tag.
- Attaches at the **item** level, and **optionally at the task** level. The **Plan** phase is the
  research workspace where these accumulate; they persist into execution as the item's evidence trail.

### Milestone — dated goalpost on an item
- `name, target_date, description?`; **status DERIVED** (`upcoming → at risk → hit / missed`) from linked
  tasks' completion + dates (consistent with health — never hand-set).
- Tasks / sub-items optionally point to a `milestone_id`. Group-by-milestone is a *view*, not schema —
  that's how "reiterate tasks to match milestones" works: watch derived status, add/move/re-scope tasks.

### Objective + Key Result — OKRs (a goal hierarchy above the work tree)
- **Objective**: `title, description?, owner?, period? (e.g. Q3), status (derived from its KRs)`
- **KeyResult**: `objective_id, name, unit, start_value, current_value, target_value` → progress derived.
- **Alignment**: an Item optionally references the `objective_id` / `key_result_id` it serves.
- Chain: `Objective (KRs) ← Milestones ← Items / Tasks`. This is the real version of the wireframe's
  "Strategy" alignment. Optional — leadership/product use it; a simple checklist ignores it.

### Sprint — time-box (scrum overlay; model the hook now, build the board later)
- `id, name, start_date, end_date, goal?`; items/tasks assigned via nullable `sprint_id`.
- Pure overlay: only scrum-mode teams use it. The schema hook exists now; the sprint board/UI is a later pass.

### Owner — unchanged lookup (id, name, initials?)

## 3. Lifecycle — granularity matches the level
```text
Item (container):   [Plan] → In progress → [Accept] → Done
                      opt                     opt
Task (leaf):         To do → Doing → [In review] → Done
                                        opt
```
- **Task** carries the fine status (To do / Doing / Done); **In review** is an optional 4th state for work
  products that need checking (PR, draft, contract). Review lives primarily at the **task** level.
- **Item** is binary **In progress → Done** — largely **derived** from children (all tasks Done → owner is
  reminded to close; owner confirms). **Item-level "review" = optional Accept/sign-off gate** for formal teams.
- **Plan** (optional pre-step) holds artifacts + milestones + the tasks that chase them.
- **Health** stays **derived** (`on_track / at_risk / blocked`), rolls up (container at_risk if a child is).
- Net: the only *manual* status is at the task level. Phase can't go stale.

## 4. Methodology as overlay (not schema)
Same items/tasks; teams switch features on:
- **Scrum mode (product):** sprints (time-boxes items are assigned to), backlog, plan/review gates, OKRs, velocity.
- **Simple mode (marketing/other):** items + task checklists + board + due dates. No sprints, gates, or OKRs.
- **Principle: the schema never forks per team; only enabled features/views differ.**

## 5. Why it's better
- Three overlapping state axes (phase / task-status / health) → **one task-level status + derived health**.
- "Project vs work item vs task" → **one nestable shape**.
- Planning is real (artifacts + milestones + OKRs), not placeholder hand-waving.
- Complexity is opt-in; the phase can't go stale (owner-closes on real completion).

## 6. Mandatory vs optional (the simplicity guarantee)
- **Mandatory core:** an Item, its Tasks (To do → Doing → Done), close when done. *That's the whole minimum.*
- **Optional layers:** Plan, Review/Accept, Attachments, Milestones, OKRs, Sprints, Dependencies.
- A marketing team lives entirely in the mandatory core; a product team switches the layers on.

## 7. Blast radius (pre-production ⇒ rework, not migration)
Touches `types.ts` (one `Item` + `parent_id`, new small entities), `fixtures.ts`, the repository seam
(self-referential parent + recursive/tree queries), `useWorkItems` (tree rollups), the **Table** (flat rows
→ expandable tree), the **Graph** (item → any-level deps), the **Editor**, and their tests (~thousands).
**No production data to migrate** (F2 unwired). The repository **seam absorbs much of the change**.

## 8. Separable quick win (independent of A/B)
The phase-lifecycle simplification alone — **execute-by-default, optional plan/review, owner-closes-when-
tasks-done** — can ship on the **current flat model** with no nesting rewrite: the cheap ~80% of the UX win.

## 9. Resolved decisions
1. **Artifact attach level** — item level, **optionally per-task**. ✓
2. **Documents** — **both** in-app authored (rich-text editor) **and** uploaded doc files
   (`origin: authored | uploaded`). ✓
3. **Sprints** — **model the hook now** (`Sprint` entity + `sprint_id`); build the sprint board in a later pass. ✓

## 10. Next: whole-structure re-evaluation + proper plan
Model spec is complete. Next step (agreed) is to step back, re-evaluate the full structure end-to-end for
coherence/gaps, then write a proper implementation plan — *after* the A/B build-timing call in §0.
