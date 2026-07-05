# Work Item Model — RECOMMENDED (two-axis) — 2026-07-01

> **⚠️ Superseded — exploratory design, not the shipped model.** Kept for design
> history. The build follows
> [`2026-07-05-work-item-port-plan.md`](2026-07-05-work-item-port-plan.md), which
> deliberately ships a lean subset (flat tasks + phase lifecycle; **no** nested
> containers, OKR/KeyResult, or KPI entities). The entities and invariants below are
> exploration, not a build contract.

Grounded in the reevaluation (`2026-07-01-work-item-model-reeval.md`) + web-verified tool research
(Linear, Jira, Shortcut, GitHub Projects, Azure DevOps). **Supersedes** the nested proposal
(`2026-07-01-work-item-nested-model.md`), which the reevaluation found low-ROI and internally broken.

## Persona
Core customers = **product development teams, software-first** (physical product secondary). The model is
optimized for them; the non-engineering path is graceful degradation, not a design driver.

## Design principles (govern everything below)
1. **Graspable by default.** The out-of-box experience must be understood in seconds and worked
   immediately — **tasks + status + one grouping**. Every other axis (cycle/sprint, version scope,
   milestones, OKRs) is **OFF by default**, layered in only when a team needs it. Simplicity is the product.
2. **Flexibility via AI, not settings sprawl.** Teams customise how they work by *telling the AI*
   ("we run 2-week sprints toward quarterly releases") — the AI writes/tweaks their **Config** (which axes,
   cadence, defaults, field visibility). Power is reached through natural language, not a complex settings UI.
   This is what lets the model be flexible AND stay simple — and it is the concrete answer to the
   reevaluation's "opt-in mechanism is unmodeled" critical.

## The decisive requirement
**A task must live in a release AND a sprint at the same time.** Every mature software tool models
**SCOPE** (version/release/project) and **TIME** (cycle/sprint) as two *orthogonal* references a task
carries at once — you change focus by switching the **view**, never by moving/re-parenting the task.

## The model (HYBRID: kinded scope container + separate time axis)
- **Task** — stays the flat, atomic unit. Manual status `todo → doing → done` (**Option B, untouched**),
  owner, derived health, and a **`kind`** (`build / plan / research / review / bug / chore`). Add exactly
  **two nullable references**, independent of each other:
  - `scopeId` → the scope container it belongs to
  - `cycleId` → the cycle it's being worked in
- **Work Item** = the **scope container, KINDED**. `kind = version | release` in v1; `project | initiative`
  are future *kind values on the same table*, not new tables. Carries completion %, target date, status.
  **This is your "consolidation unit."**
- **Milestone** = optional one-level subdivision *inside* a version (Alpha / Beta / GA), own target date +
  task subset. Named **"Milestone" (NOT "Phase")** to avoid colliding with Option B's task-level lifecycle.
- **Cycle** = a **separate time container** (not a work-item kind): repeating timebox with start/end,
  auto-create, auto-rollover of unfinished tasks. Cross-cuts all work items. **Opt-in per team.**
- **Config (workspace/team mode)** — a first-class settings record: which axes/features are enabled
  (cycle on/off, scope kinds in use, OKR on/off), cadence, and field visibility. **Default = simplest**
  (tasks + status + one grouping). **The AI reads and writes it from natural language** — this is the
  customization layer and resolves the reevaluation's unmodeled-opt-in critical. Users never hand-tune a
  settings maze; they describe how they work and the AI configures the axes.

The one correction to the original proposal: **cycle cannot be a `kind` in the same slot as version** — a
single-slot kinded container forces "version OR sprint," which breaks release+sprint. Cycle is a second,
independent axis.

### Plan & Review — kinds of work, not phases
Plan and review are **NOT lifecycle phases** (there is no plan → execute → review → done gate). They are
**kinds of work you do at any point:**
- A "plan" or a "review" is just a **task of that `kind`**, added whenever it's needed — no ordering enforced.
  Planning artifacts (sources / documents / files) accumulate on the work item (or on the plan task).
- The **item lifecycle collapses to `open → done`** (owner closes when its tasks are done) — no plan/accept
  gates. The **task status stays the triad `todo → doing → done`** — no separate "in review" state; a review
  is its own task, assignable and trackable.

- **Optional planning gate (when clarity is lacking):** planning can still *restrict* execution — not as a
  forced phase, but via **dependency**. Make the execution tasks **depend on** a plan/research task; they are
  then blocked until the plan is done. **Opt-in per item/task** — add the dependency only when the work is
  unclear; otherwise execution just starts (the simple default). This also **defines the derived `blocked`
  health base case** (a task is `blocked` when it has an incomplete dependency) — resolving a gap the
  reevaluation flagged, and letting the UI warn if someone starts blocked work early.

This is the simplest shape, resolves the *original* "phase feels too complex" doubt that started this
rethink, and matches the reevaluation's cut list (Plan-phase, In-review state, Accept gate all removed).

## How a software team runs a release AND a sprint over the same work
Create Version `v2.3` (scope) and Cycle `Sprint 14` (time). Tag task **T** with `scopeId=v2.3` AND
`cycleId=Sprint14`. **Focus the sprint** → Cycle view (filter `cycleId`, board by task status, unfinished
rolls forward) = daily execution. **Focus the release** → Version view (filter `scopeId`, completion %,
milestones, ship date) = readiness. Same task, two lenses; the task never moves.

## Non-engineering degradation (subset, not a compromise)
Leave `cycleId` empty and don't create versions → the model collapses to **Work Items (kind=project) +
task status**. No sprint/velocity/rollover machinery is forced on marketing/ops. One axis instead of two.

## Relation to the reevaluation + Option B
- **Additive to Option B, which ships unchanged NOW** — execute-by-default, one manual task status,
  owner-closes-when-done, derived health — all at the task layer this proposal doesn't touch.
- **This is NOT the deferred nested rewrite.** The task spine stays **flat** (tasks are never children in a
  parent chain). Nesting exists only *between containers*, one level (Milestone → Version). Containers are
  rollup targets/tags, not a hierarchy the task lives in.
- **Dodges the reeval's criticals:** no "one-shape" claim to break (task and container are honestly
  different types); no cross-level containment deadlock (task spine is flat); no low-ROI foundation rewrite
  (just two nullable fields + two lightweight container tables). Pre-production ⇒ cheap, no migration.

## Strategy, Alignment & AI (post-foundation — the product differentiator)
Above execution sits the org-alignment layer — the "why" and the guardrails that stop teams drifting:
- **Strategy / roadmap** — objectives (OKRs) + the company roadmap of how work is sequenced and prioritised.
- **Decision log (first-class, with reasoning)** — decisions + the reasoning behind them, attachable at ANY
  level (strategy / project / work item / task / person). The alignment backbone: decisions are visible and
  reasoned, so one team's choices don't blindside another and communication gaps close. Decisions are
  **living / versioned** — revised with new reasoning over time, keeping the history of *why it changed*.
- **AI Oversight (a capability, not a data level)** — agents continuously read across strategy + decisions +
  work + dependencies + ownership and emit **suggestions/alerts on any entity** (person → task → work item →
  project → strategy) when something is off: a conflicting decision, an off-strategy/​off-roadmap task, an
  unflagged cross-team dependency, a communication gap. Same AI-woven DNA as Config: AI *configures* the
  workflow AND *watches* it.
- **Flag → resolve loop (advisory, never a block):** an AI flag is a prompt, not a gate. The user resolves it
  by acting, OR by **overriding with new reasoning** — which updates the (versioned) decision, clears the
  flag, and re-propagates the new alignment so other teams see the change and its rationale. Decisions
  iterate on the go; the *why it changed* is always captured. This keeps AI oversight helpful (human decides)
  and keeps the org aligned *through* change instead of drifting silently.
- **Launchable agents (on-demand — the "do it" mode):** users can **spin up agents** to plan, review, or act
  on any target (work item / task / plan) and **across the app's Connections** (integrations: GitHub PRs &
  checks, ERP, ad campaigns, docs). Agents can also **draft/plan the work itself**; their output flows back as
  **artifacts** (sources/docs) on the work item. Adds two modeled concepts: **Connection** (an external-system
  link — the wireframe's "Connected") and **Agent run** (a launched agent on a target, producing artifacts) —
  the real version of the wireframe's "Agent conversations / Launch research run".
- **AI is woven in THREE modes:** *Config* (AI sets up your workflow) · *Oversight* (AI watches + flags) ·
  *Agents* (you launch AI to plan/review/act). All deferred above the foundation; all consumers of the clean model.

**Deferred, but shapes the model now.** AI oversight is a *consumer* of the clean model — it only works
because the model records decisions+reasoning, alignment (work→objective), cross-team dependencies, and
ownership. So it justifies making **Decision + reasoning first-class** in the strategy axis, but it sits ON
TOP and is built AFTER the foundation. It must never complicate the graspable default.

## Open questions (recommended defaults)
1. **Cycle cardinality** — single `cycleId` + rollover moves the ref (Linear), vs multi (Jira). → **single**.
2. **Scope cardinality** — single `scopeId` vs multi-value Fix-Version (Jira). → **single for v1**.
3. **"Phase" disambiguation** — confirm the user's "phase" = in-version **Milestone** (Alpha/Beta/GA), not
   the task-level lifecycle. → adopt **"Milestone"** as the name.
4. **"project" kind for v1?** — Linear collapses version=project. → **Version + Cycle only for v1**.
5. **Cycles per-team or global?** — determines whether `cycleId` needs a team scope.
6. **Health rollup** — roll up to Work Item / Cycle, or stay strictly per-task in v1? → **per-task v1**.

## Build sequence
1. **Option B (refined)** — task-lifecycle on the flat model: items `open → done`, tasks `todo → doing → done`,
   **plan/review as task kinds (not phases)**, execute-by-default, owner-closes-when-done, derived health.
   *(now; the real ~80% win)*
2. **Two-axis layer** — kinded Work Item (scope) + Cycle (time) + the two nullable task refs. *(additive)*
3. **Work Item detail page** — the original task — built on this model.
4. **Strategy & Alignment** — OKRs + first-class **Decision log** (with reasoning), attachable at any level. *(deferred)*
5. **Connections + AI layer** — integrations (GitHub/ERP/ads) + the AI trio: Config, Oversight (monitor/flag),
   launchable Agents (plan/review/act). *(deferred; consumes 1–4)*
