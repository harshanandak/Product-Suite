# Work Item Detail — Information Architecture (grounded in the real audit)

Audited 2026-07-01 from `apps/platform-web/src/data/work-items/*` (types, fixtures, repository),
the three live surfaces (WorkItemEditor sheet, WorkboardTable, WorkItemNode), and the `#item` wireframe.
This replaces guesswork in the earlier mockups with what the data model actually carries.

## 1. What information we actually have — three tiers

### Tier 1 — REAL (backed by the data model today)
| Group | Fields | Notes |
|---|---|---|
| Identity / status | title, phase `plan→execute→review→done`, type `feature/bug/chore/research`, priority `critical/high/medium/low`, **health** `on_track/at_risk/blocked` | health is DERIVED (deriveHealth) + we know the exact rule → can show "why" |
| People / time | owner (assignee, nullable = dept queue), due_date (nullable), created_at, updated_at | timestamps shown NOWHERE today |
| Containment | project (nullable), department (name string) | **project_id has NO editing home on any surface today** |
| Labels / origin | tags[], source/provenance `manual/meeting/agent/feedback` | source is display-only, set once |
| Tasks | per task: title, status `todo/in_progress/completed`, due_date; counts taskCount/completedTaskCount (derived) | tasks are READ-ONLY on every surface today |
| Dependencies | edges `depends_on / blocks / complements` (only depends_on rendered), DAG-guarded | only the GRAPH shows these today |
| archived | boolean soft-archive | |

### Tier 2 — NEW, a single field to add
- **description** — genuinely absent from the model; the spec already approves adding it.

### Tier 3 — ASPIRATIONAL (the wireframe shows these; the data model does NOT back them)
Evidence/insights (relevance scores + insight-type taxonomy), Comments, Meetings (created-vs-discussed + timestamps), Agent conversations, Connected/live-bindings (ERP/GitHub/ads), Plan (typed milestone/risk/prerequisite rows), Strategy alignment (primary + secondary-with-strength), Visibility (workspace/dept/restricted), Feedback links.
> The wireframe "counts strip" (2 tasks · 2 meetings · 1 agent · 2 insights · 3 feedback) is **mostly fake** — only task and dependency counts are real; the rest need Tier-3 data we don't have.

## 2. Grouping — by what the user is trying to DO (not by data type)
1. **Orient** — "what is this, how's it going?" → hero: title, type, phase + ladder, health + why, priority, owner, due, task progress. *(all REAL)*
2. **The work** — "what's the deliverable?" → description (new), linked tasks (editable here). *(REAL + 1 new field)*
3. **Sequencing** — "what's it waiting on / blocking?" → dependencies + jump-to-graph. *(REAL)*
4. **Attributes rail** — inline-edit: type, priority, owner, due, department, tags, project, phase, source. *(REAL)*
5. **Context & alignment** — "why does this matter?" → strategy, origin. *(mostly Tier 3)*
6. **Collaboration & activity** — "what do others know / latest?" → comments, meetings, agents, evidence, connected, feedback. *(Tier 3)*

## 3. What makes it EASIER — the real interaction wins (true in any weighting)
- **Inline-edit every editable field IN PLACE**, reusing the table's ghost-select idiom — no separate Sheet round-trip. This is the page's reason to exist. Includes **project_id, which has no editing home anywhere today.**
- **Edit tasks here** — status / add / remove. Tasks are read-only on every current surface.
- **Health with its derivation reason** — we have the exact rule; make "why at-risk?" answerable.
- **Dependencies surfaced here** (not only in the graph), with jump-to-graph.
- **Reuse exact idioms** — PhasePill, HealthBadge, PrioritySelect, StatusPill, ProvenanceChip — so it reads as ONE app.
- **Ground on `@product-suite/ui`.** Real component gaps are only **Breadcrumb + Collapsible**. (Kibo is NOT used in the codebase — drop those labels.)
- **Drop the panel-management chrome** (drag/resize/collapse/maximize). This is a read+edit surface, not an IDE; scope is "trim, not port."

## 4. The open decision — how much Tier-3 aspiration to show (the weighting)
- **A — Lean & real:** Tier 1 + 2 only. No placeholder sections. Honest, fast, zero fake data. Add Tier-3 sections when their data lands.
- **B — Real core + honest placeholders:** the real core PLUS well-designed empty-states for Tier-3 (labelled "coming", no fabricated numbers), so the hub shape is visible.
- **C — Rich hub (port the wireframe):** revive the full wireframe richness (counts strip, evidence relevance, plan typed rows, two-level strategy) using mock data where the model can't back it.

This weighting is the axis the last two mockups guessed wrong — it's the user's call, not mine.
