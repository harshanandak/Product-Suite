# Product-Suite — Vision & Architecture (canonical)

**Date:** 2026-07-10
**Status:** CANONICAL. This is the single reference the team builds against. It captures a set of
FINAL founder decisions and, where it conflicts with earlier plans, it wins. It integrates and
extends — it does not replace — the companion docs:
[build-vs-leverage-map](2026-07-07-build-vs-leverage-map.md),
[module-parallelization-roadmap](2026-07-05-module-parallelization-roadmap.md),
[tech-stack-evaluation](tech-stack-evaluation-2026-06-12.md), and
[mastra-vs-ai-sdk-reevaluation](mastra-vs-ai-sdk-reevaluation-2026-06-18.md).

> **Two deltas vs. earlier docs, decided by the founder and binding here:**
> 1. **Graph and Canvas are two DIFFERENT surfaces — this is not a reversal.** The workboard's
>    dependency **graph** (work items as nodes, dependencies as edges) stays on **React Flow** — the
>    earlier "exit BlockSuite → React Flow" (2026-06-12 stack doc; roadmap §1.13) was scoped to the
>    *graph* and still holds. The freeform **Canvas** is a *separate* surface built on **BlockSuite**
>    (blocks + collab). Two surfaces, two right tools. Keep the `packages/ui-canvas` boundary (own
>    the seam, rent the engine); confirm BlockSuite's exact license before locking.
> 2. **The agent plane is now spelled out** as CopilotKit (MIT) + AG-UI + MCP + Forge-skills-as-tools
>    + a model router + memory (ctx), most of it assembled from open standards.

---

## 1. Vision — one surface, one login

**One product, one app, one login.** A Vite SPA (TanStack Router, Clerk auth) served on Cloudflare,
backed by a Hono API on Cloudflare Workers and Neon (Postgres + pgvector). Every module — Workboard,
Meeting, Roadmap, Canvas, and future Marketing — is a **tightly integrated surface inside the one
app**, not a federation of separate apps.

**Goal: get entirely OFF Railway.** The two container workloads that run there today
(`apps/meeting-api`, the agent-core runtime) are **rebuilt in TypeScript on Workers**, not ported.
End-state substrate: **Cloudflare + Neon + Clerk + pay-per-use model keys** — all usage-priced, zero
fixed floors.

Positioning: **a Jira / Linear / Notion alternative and a migration target** — teams import from
Jira/Linear (via their APIs) and move in.

## 2. Stack (accepted)

| Layer | Choice |
|---|---|
| Front end | **Vite SPA + React 19 + TanStack Router + TanStack Query** |
| Auth | **Clerk** (managed); Neon Auth / Stack Auth is the self-host minter behind one claims contract |
| Hosting | **Cloudflare Workers for everything** — the SPA served via **Workers Static Assets** (NOT Pages), **same-origin** with the **Hono API** so there is **no CORS** (one Worker serving assets + `/api/*`, or two Workers behind one domain); R2 storage; Durable Objects realtime |
| Data | **Neon** (Postgres + **pgvector**), host-neutral SQL; branch-per-PR DBs |
| Realtime / collab | one `RealtimeTransport` seam — Durable Objects (SaaS) / Hocuspocus (self-host); **Yjs** CRDTs |
| Canvas / blocks | **BlockSuite** (AFFiNE's editor framework) behind `packages/ui-canvas` — the freeform surface only |
| Dependency graph | **React Flow** (workboard graph view: nodes = work items, edges = dependencies) — distinct from the Canvas |
| Agent runtime | **Vercel AI SDK v6 + OpenRouter** loop; **CopilotKit (MIT) + AG-UI** for in-app agent UI |
| Meetings | LiveKit + STT provider behind an interface; extraction via OpenRouter models |
| Off-Railway | `meeting-api` + agent runtime rebuilt in TS on Workers |

The agent-loop-library choice (AI SDK v6, Mastra as fallback #1) is unchanged from the
[mastra-vs-ai-sdk re-eval](mastra-vs-ai-sdk-reevaluation-2026-06-18.md); this doc layers the CopilotKit/AG-UI/MCP
plane on top of that loop.

## 3. Leverage map — "own the model, rent the machinery"

Extends the [build-vs-leverage map](2026-07-07-build-vs-leverage-map.md). Three buckets:

| Bucket | What | Items |
|---|---|---|
| **ADOPT** (drop into our TS/web stack) | Composable libraries we wire behind our own seams | **BlockSuite** — native web components, React-interop, Yjs collab, includes a database/table block; license more permissive than AGPL (**confirm exact terms**) → Canvas + blocks. **TanStack / Hono / Drizzle / LiveKit.** **CopilotKit (MIT) + AG-UI protocol** — in-app agent runtime/UI: shared state, human-in-the-loop, built-in MCP support. **MCP (Model Context Protocol, Anthropic open standard — Tools / Resources / Prompts)** — the uniform agent↔capability layer. |
| **INSPIRE** (copy the model, not the code) | Reference designs for user-customizable data; we do not fork or link their code | **Teable** (AGPL) — real-Postgres flexible database, the reference for user-customizable data. **AppFlowy** (AGPL; Flutter/Rust — concepts only) — field types, DB views, templates. **NocoDB** — DB-agnostic patterns. |
| **BUILD** (the moat) | The differentiated ~30% that is ours | The agentic **orchestration/brain**; per-module **guard-railed MCP toolsets**; **tenancy/surface**; **memory** (ctx integration); the **model router**. |

Rule of thumb: rent the engines (editor, CRDT, AI streaming, UI kit, DB, auth, STT); own the domain
contracts, the guard rails, the cross-module reasoning, and the memory. Never fork a whole app.

## 4. Standard-vs-Canvas split

Two surface archetypes, deliberately different:

- **Standard modules (Workboard + friends) = FIXED, opinionated schema.** Customization happens at
  the **VIEW level** — filter, group, sort, display — never by mutating the schema. The backbone
  (`work_items`, tasks, dependencies, phases) stays fixed and typed in `packages/contracts`.
- **Canvas = the OPEN, do-anything surface.** BlockSuite blocks, including **flexible / database-style
  blocks** (Teable-inspired). This is where "add your own columns / reshape it" lives.

**The "reshape it yourself" USP lives on the Canvas, NOT by turning the Workboard schema-less.** This
resolves the tension between an opinionated PM tool and a flexible Notion-like tool: you get both, on
different surfaces, without weakening either.

## 5. Guard-railed flexibility (core design principle)

**A spectrum of flexibility, guard-railed at every point — freedom without footguns.** Tight rails
where opinion matters (Workboard); loose rails where freedom matters (Canvas); **always rails.**

Mechanisms (apply across the spectrum):

1. **Protected backbone** — the core fields/relationships that make a module work cannot be broken or
   removed. (The Workboard `work_items` schema is exactly this backbone.)
2. **Safe extension on top** — user additions layer over the backbone, never mutate it.
3. **Validation / invariants** — every change is checked against the module's rules (e.g. the cycle
   guard on dependencies).
4. **Presets** — curated starting configurations users adopt and then tune.
5. **Agentic guidance** — the agent proposes and acts **within bounds**, and **confirms risky moves**
   before executing.
6. **Toggles, not raw YAML** — configuration is a small set of safe switches, never hand-edited config.

## 6. Modes & inheritance (Jira / Linear / Notion strictness)

> **AMENDED 2026-07-10.** This section originally placed the mode preset at the **Project** level. That
> was wrong and is superseded by
> [2026-07-10-work-ontology-and-phasing-design.md](../design/2026-07-10-work-ontology-and-phasing-design.md) §3.
> Modes bundle workflow enforcement, cycles on-or-off and required fields — and **Team** owns exactly
> those. Placing them on Project broke twice: a project may span multiple teams (imposing one team's
> workflow on another team's items), and `project_id` is nullable (leaving unprojected items
> ungoverned). Amended text below.

**Strictness is a PRESET, applied at the TEAM level, with an ORG-level DEFAULT + optional ceiling.**
Resolution is inherit → override within bounds. **Project is a first-class cross-team OUTCOME container**
— status, lead, target date, milestones — and **does not own workflow**. Project-level overrides are
deferred.

A **mode is a bundle of guard-rail settings**:
- required fields
- workflow / phase enforcement
- sprints / cycles on-or-off
- task structure
- who-can-edit-shape
- **agent autonomy** (auto-do vs. confirm)

The three named presets:

| Preset | Rails | Role |
|---|---|---|
| **Jira** | tightest | maximum enforcement, required fields, strict workflow |
| **Linear** | medium | **the default sweet spot** |
| **Notion** | loosest | freeform, minimal enforcement |

Presets are **starting points a team further customizes** — not fixed tiers. A **Team becomes a
first-class thing** that carries its resolved mode/config, stored as **team settings resolved from the
org default** (org sets a default + optional ceiling; team inherits then overrides within bounds). This
mirrors Linear, where the Team — not the Project — owns workflow states, cycles, triage and the issue
prefix, and it makes Jira/Linear import map team→team losslessly.

**Implementation is ADDITIVE:** the fixed `work_items` backbone stays; `department` is promoted to a
`teams` table (`team_id NOT NULL`), `phase` is replaced by immutable status **categories** plus a
per-team `statuses` table, `parent_id` is added for sub-items, and a **per-team config/policy object
governs behavior** on top. The sub-item **depth cap is a mode policy, not a schema constraint** —
default 1 for native creation, bypassed by importers so migration stays lossless. No schema is torn up
to add modes.

**Naming model** — Team → Project → **Item** → **Task** → **Check**. `work_items` = an **Item**; a
`work_item` with a `parent_id` = a **Task** (owned child, native create); a checklist row = a **Check**.
Rule: *needs an owner → Task; just tick it → Check.* This entails renaming the `tasks` table → `checks`
and contract `Task` → `Check` (re-minting `Task` for the owned child) — a coordinated Forge **major**
bump, gated on verifying Forge's usage; see the ontology design doc §2.3. The additive schema changes
(teams, statuses, parent_id) ship first under a minor bump.

## 7. Forge ↔ Product-Suite integration

Two repos, one data spine:

- **Forge** (separate repo) = the **agentic plane** — the kernel engine + agent skills — syncing
  issues to a DB with a website layer.
- **Product-Suite** = the **surfaces** (workboard / website) over the same data.

**The enabler is ONE shared canonical issue / work-item contract** both repos depend on, so sync is
**mapping + reconciliation, not translation.** (This is the `packages/contracts` work-item model —
already the identified moat.)

- **Contract ownership + versioning:** `packages/contracts` is the single owner of the shared
  work-item shape. Forge consumes it as a **published, semver-pinned** dependency; a breaking schema
  change ships behind a **version bump + a migration/compat mapping**, never silently. "Mapping-only"
  reconciliation is valid only while both sides sit on a **compatible contract version** — a
  version-skew check gates sync so drift surfaces loudly instead of corrupting data.
- **Forge's skills are ALSO exposed as MCP tools**, so **one agent operates across Forge +
  Product-Suite** through the same uniform capability layer.
- **Positioning:** a Jira / Linear / Notion alternative and **migration target** — import from
  Jira/Linear via their APIs.

## 8. Scope (first release)

**Software / product-development teams FIRST.** Stay focused and opinionated.

**Procurement and logistics are adjacent facets of PRODUCT work, reachable by customization — NOT
separate verticals we pre-build.** We do not fan out into vertical editions; the flexibility spectrum
(Canvas + modes + agent-configured boards) is what reaches those adjacent workflows when a team needs
them.

## 9. Agent-first setup (templates are NOT the foundation)

**Correction to any "template library first" assumption:** a ready template library **does not exist**
and is hard to build / community-grown. So it cannot be the foundation.

**Default onboarding = "describe your project → the agent configures the board (mode + fields +
workflow) within guard rails."** This covers the **long tail** that no template library could.

- Curated / community **templates are ACCELERATORS layered on top**, not a dependency.
- **Config UX = a conversation + a few safe toggles**, never a 40-field form.

This is the natural payoff of guard-railed flexibility (§5) + modes (§6): the agent has a bounded space
to configure, so "describe it and go" is safe by construction. **Structural config changes (fields,
workflow, mode) are delivered as proposals the user reviews and approves** (per `DESIGN.md`), not
silent direct writes — the review step, not just "risky-move" confirmation, is the guard rail on setup.

## 10. Model router (efficiency — a first-class component of the agent plane)

**Classify each task by difficulty / stakes → dispatch to the cheapest CAPABLE model.**

- **Smart / frontier models** for high-stakes work: project setup, planning, hard reasoning.
- **Cheap / small models** for bulk / trivial work: extraction, formatting, status flips.
- **Orchestrator-and-workers, in-product:** a smart model can orchestrate cheaper ones for a task.
- **User-facing BUDGET↔QUALITY dial** at the org / project level — itself a guard-railed toggle.

This is a **genuine cost advantage** vs. tools that bill one flat model. It mirrors the founder's proven
OpenRouter model stack and folds into the per-task-kind routing policy already in the stack doc.

## 11. Agentic plane architecture (summary)

The plane is assembled from open standards, with the differentiated slice built by us:

- **MCP** — every module exposes **guard-railed Tools / Resources** (per-module toolsets).
- **AG-UI** — agent↔UI protocol: shared state, streaming.
- **CopilotKit (MIT)** — the in-app agent runtime, human-in-the-loop.
- **Forge skills-as-tools** — Forge capabilities surfaced as MCP tools so one agent spans both repos.
- **Model router** (§10) — cheapest-capable dispatch + budget/quality dial.
- **Memory** — ctx integration (bound to `contracts`, per the build-vs-leverage map's "memory is the
  fuel, contracts is the moat").

**~70% of the plumbing is assembled from open standards** (MCP + AG-UI + CopilotKit + AI SDK loop).
**The differentiated ~30% is ours:** the per-module tools, the guard rails, cross-module reasoning, and
memory.

## 12. What this changes about current work

- **The Workboard's fixed schema is the CORRECT protected backbone** (§4–§5), not a limitation to be
  "fixed" by making it schema-less. Keep it fixed; extend via views + Canvas + per-project config.
- **The next layer after the API cutover** (finish Neon/Clerk, move `meeting-api` + agent runtime off
  Railway into TS/Workers) is the **per-team mode/config object (§6, amended) + agent-first setup (§9)** —
  both additive on top of the existing backbone.
- **BlockSuite is the next big ADOPT — for the Canvas surface only** (§3, §4). It does **not** touch
  the workboard dependency **graph**, which stays on **React Flow** (the earlier "re-contract off
  BlockSuite" was about the graph and still holds — no reversal). Keep the `packages/ui-canvas`
  boundary and **confirm BlockSuite's license terms** before locking it in.
- Sequencing that still holds from the roadmap: consolidate onto Neon/Clerk and unify memory **before**
  building new modules; the model router and the CopilotKit/AG-UI/MCP plane are **core agent-plane
  components**, not add-ons.
