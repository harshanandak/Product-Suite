# Implementation Plan — The Rebuild (supersedes PR21–PR23 of the building-blocks plan)

Date: 2026-06-12
Contract: `DESIGN.md` (canonical) · acceptance reference: `docs/design/user-flow-wireframes.html` · stack: `docs/plans/tech-stack-evaluation-2026-06-12.md`

## Why this plan is fast AND safe

1. **The contract is the speed.** Every object, rule, route, seam, and screen is already decided and reviewer-hardened. Build streams — human or agent sessions — work in parallel against DESIGN.md without coordination overhead; disagreement is settled by the document, not meetings.
2. **Skeleton once, boards in parallel.** Foundations (shell, API, data plane, seams) are sequential and small; after them, the four boards are independent lanes.
3. **Strangler, never big-bang.** The old apps keep serving production. The new app grows on a Cloudflare preview domain; DNS cutover only at the parity gate. Nothing is ported — only API routes migrate, opportunistically, per lane.
4. **Quality gates are already running.** The pre-push suite + SonarCloud + Codex/CodeRabbit review every PR (proven on PR26: idempotency bug, schema gaps, IA drift — all caught on paper). Per-slice gates below add product acceptance.

## Repo topology (one monorepo, one application)

```
apps/platform-web      ← THE app: Vite + TanStack Router + Clerk; boards are route groups inside
apps/meeting-api       ← existing FastAPI container (Cloudflare Containers)
workers/platform-api   ← Hono: API, MCP gateway proxy, presign, invalidation pings
workers/realtime       ← partyserver Durable Objects: doc/chat/workspace rooms
workers/agent-worker   ← Node container (Containers): AI SDK runs, queue consumer
packages/ui            ← tokens + design system (Ladle catalog)
packages/contracts     ← zod schemas/types shared web↔api (extend existing)
packages/transport     ← RealtimeTransport interface + DO impl + node-ws impl (seam 2)
packages/jobs          ← queue/cron interface + CF Queues/Cron impl + pgmq impl (seam 5)
infra/supabase/migrations ← legacy (frozen with the old apps); F2 starts infra/db/ — host-neutral SQL on Neon, neutral runner + codegen
apps/roadmap-web, apps/meeting-web ← frozen (bugfix-only), deleted at cutover
```

Sub-applications = the boards = route groups in ONE app. No separate deployables per board, ever.

## Phase 0 — Foundations (sequential, the only serial part)

| Slice | Contents | Merge gate |
| --- | --- | --- |
| F1 Shell scaffold | platform-web (Vite/TanStack Router/Clerk/tokens) + `packages/ui` core components + shell chrome (dock, stable sidebars, Cmd+K stub, top bar) + Cloudflare preview deploy + CI wiring | Sign in works; chrome matches wireframes; deployed preview URL |
| F2 Data plane | Migration pack #1 per §11 **with pre-written migration specs** (projects, `product_tasks.project_id` + parent constraint, proposals w/ candidate-id idempotency, connections w/ scope, visibility, drop `work_items.status` mapping) + typed contracts + platform-api CRUD for the ladder. **Targets Neon from day one** (DESIGN §12 / tech-stack eval §7a): host-neutral SQL (no `auth`/`storage` schemas; app-layer authz instead of `auth.uid()` RLS), neutral migration runner + codegen replacing the Supabase CLI, meeting-api DB moved by connection string (PR20 runbook reversed) | API tests green; drift/type checks; rollback notes per spec; **new schema live on Neon** |
| F3 Seams | `packages/transport` (DO rooms + invalidation→TanStack Query) + `packages/jobs` (Queues HTTP-pull + Cron) wired end-to-end | Live-update demo test passes through the interface only |

## Phase 1 — Four parallel lanes (after F3)

Each lane = independent PRs by its own build stream, acceptance = the corresponding wireframe screens + DESIGN.md rules.

| Lane | Scope | Gate |
| --- | --- | --- |
| L1 Workboard | Table (TanStack Table v8 + Virtual, inline edit, bulk, group-by-department swimlanes) · Kanban (dnd-kit, phase columns, derived-health badges) · Graph view (React Flow + dagre, edge-drag = dependency) · item coalition page · projects + switcher | Board-grammar tests (columns=lifecycle), action parity (node click = row click), phase pill everywhere |
| L2 Meeting board | Upload/record → AssemblyAI webhook → summary/decisions → **the seam** (proposals → work items) → ask-meeting RAG (pgvector hybrid) — meeting-api keeps jobs, new UI consumes it | Flow 1 e2e (<5 min to first value) + Flow 2 e2e (meeting → accepted work item with provenance) |
| L3 Agents + MCP | agent-worker (AI SDK v6 + OpenRouter, resumable runs on `agent.runs`) · runs/threads UI · review queue · @agent mentions · **MCP gateway v1**: registry, 3 meta-tools w/ Hermes auto-mode, catalog sync with ~10 Tier-1 verified servers, connection scoping UI | Delegated run e2e: mention → run → proposal → approve → work item, audit attributed |
| L4 Home + Chat | Digest, overview cards, review-queue surface, unified threads (channels/DMs/object threads, live cards), notifications table + Resend digests | Return-visit flow renders real deltas; one inbox only |

Cross-lane rule: anything generated lands as a `proposals` row → review queue. One pipeline, all producers.

## Phase 2 — Convergence and cutover

Canvas board (React Flow freeform + TipTap docs; old BlockSuite docs readable-only first, then migrated) · Settings (members + skills/roles, departments, connections w/ scope badges) · old-route 302 compatibility layer · **parity gate = the five flows, NOT the old 13 tabs** · perf/a11y pass (DESIGN §8 floor) · DNS cutover · delete roadmap-web, meeting-web, BlockSuite + `patches/`, Vercel projects, Railway hocuspocus, **and the Supabase project** (legacy DB + Storage bucket + Edge Function retire with it — the platform DB has been on Neon since F2; see tech-stack eval §7a).

## Phase 3 — Deferred by decision (the scope shield)

Founder-deferred (2026-06-12): **native marketing/analytics dashboards (Meta/GA) — agents + MCP connections cover marketing in phase 1**; connectable dashboards for prominent solutions come later from the same snapshot cache. Also deferred: billing implementation (metering events ship in phase 1), RLS defense-in-depth, self-host compose packaging + BYO-Clerk docs, external Agent Access Surface + hosted MCP runner fleet, meeting bots (Recall), Vectorize/Electric upgrades, SVAR gantt features.

Anything not in phases 0–2 and not on this list requires a decision PR — that is what protects pace.

## Operating rhythm

- Trunk-based: lanes merge small PRs continuously; suite + bots on every push; preview deploy per merge.
- The wireframe is the acceptance test: every screen PR links its prototype screen; reviewer compares.
- Schema changes only with pre-written migration spec + rollback (per §11 discipline) — production data is still effectively empty; the preflight row-count check (PR17 rule) guards the assumption.
- Weekly: update this plan's checkboxes, re-run an evaluator pass on drift between code and DESIGN.md.

## Execution assignment — which model/agent owns which lane (decided 2026-06-12)

The plan is contract-driven, so lanes can be assigned to the model best suited to each, with CI as the shared safety net. Rule of thumb: **frontend/contract-sensitive lanes → Claude (Opus/Fable); backend/schema/infra lanes → GPT-5.5 (Codex) or equivalent frontier model.** Phase 0 foundations always use a frontier model regardless of family — a seam or schema mistake costs every lane built on it.

| Lane | Owner (default) | Why |
| --- | --- | --- |
| F1 Shell scaffold | **Claude** | Most contract-sensitive: matches wireframes + §5 component grammar (`PhasePill`/`HealthBadge`, tokens-not-values) |
| F2 Data plane (Neon) | **GPT-5.5 / Codex** | Migrations, host-neutral SQL, idempotency rules, contracts — backend correctness |
| F3 Seams | **GPT-5.5 / Codex** | `RealtimeTransport` + jobs interfaces — infra-shaped |
| L1 Workboard | **Claude** | Table/kanban/graph/coalition UI — frontend-heavy |
| L2 Meetings | **split** | FastAPI pipeline → Codex; new board UI → Claude |
| L3 Agents + MCP | **GPT-5.5 / Codex** | agent-worker, runs, MCP gateway meta-tools — backend/infra |
| L4 Home + chat | **Claude** | digest, review-queue surface, threads — frontend-heavy |
| Phase 2 Canvas | **Claude** | React Flow + TipTap surfaces — frontend-heavy |

**Crossed-review discipline (non-negotiable):** whoever writes a lane, a *different* model family reviews the diff before merge. The Codex bot already reviews every PR regardless of author (it caught the idempotency bug, schema gaps, and IA drift on PR26); for Codex-authored backend PRs, run a Claude pass over anything touching §11 schema rules or §12 seams. Diversity catches what self-review misses — this is why PR26 converged clean.

**Session bootstrap (any model, any shell):** start with `bd ready` → `bd show <id>` before writing code. The Beads issue notes now carry the binding constraints (Neon rules on F2, Tier B hardening on L3, component grammar everywhere), so even a cheaper model starts inside the contract instead of rediscovering it. DESIGN.md settles any dispute.

## Checkpoint — state as of this PR (2026-06-12)

What is on `main` right now, so the next lanes plan from reality, not from the original sketch:

- **PR #26 (`8406b71`, squash-merged):** the design contract — DESIGN.md, the clickable prototype + mental model, the tech-stack evaluation, the **Neon Postgres decision** (F2 onward), and the build-hygiene gate (`prepush-gate.mjs` + Vercel/Railway scoping).
- **PR #25 (`0579823`, merged after):** a **transitional `(platform)` route group inside the existing `apps/roadmap-web` Next.js app** — board placeholder pages (agents/canvas/meetings/roadmap/settings), workspace-scoped `w/[workspace]/...` routing, and layout/error/loading shells. **This is NOT the planned `apps/platform-web` Vite + TanStack app** — it consolidates the boards under one domain inside the current Next stack as a stopgap.
- **Beads:** `product-suite-7kl` (merge PR26) closed; **`product-suite-dlz` (F1) is the single ready issue**; F2→F3→lanes→Phase 2 chained behind it.

**Open decision to settle at the start of execution (the next PR, not this one) — the F1 fork:** PR #25 created an in-Next-app platform shell, while F1 as written calls for a fresh `apps/platform-web` on Vite + TanStack Router (DESIGN §10, repo topology above). Recorded here so it is not lost; the call is made when F1 execution begins. Two coherent paths:
  - **(A) Vite rebuild now, as planned** — treat PR #25's `(platform)` group as a throwaway demo of the IA; start `apps/platform-web` clean. Honors the stack decision; the route placeholders become a reference for routing structure only.
  - **(B) Evolve the in-Next shell, defer the Vite cutover** — keep building boards in the `(platform)` route group on Next for now, and schedule the Vite migration as its own later slice. Faster to first pixels; risks growing throwaway code against a stack we've decided to leave.

Recommendation: **(A)** — the whole rebuild rationale (DESIGN §10, tech-stack eval §7/§7a) is that Next-on-Vercel is an exit, not a destination; building lane UI on it now compounds migration debt. This stays a founder/architecture call for the execution PR — this PR only records the fork so it is decided deliberately, not by default.

> **Decision — RESOLVED (2026-06-16, founder sign-off):** **(A) Vite rebuild now.** F1 scaffolds a fresh `apps/platform-web` on Vite + React 19 + TanStack Router (library) + Clerk GA SDK with a new `packages/ui` seeded from `docs/design/tokens.css`. PR #25's Next `(platform)` route group is consumed as a routing-structure reference only — no new feature code is added to it, and it is deleted at the Phase 2 cutover with the rest of `roadmap-web`. The Vite + TanStack + Clerk + tokens skeleton rendered the signed-in shell well within the timebox with no blocking dependency, so the fallback to (B) does not apply. Mirrored in Beads `product-suite-dlz`. Built on branch `feat/f1-platform-shell` off `main`.

**Decision gate (so the next PR resolves this actively, never by drift):**
- **Checkpoint:** the F1 execution PR opens with the fork as its first item — founder sign-off on (A) or (B) **before any `apps/platform-web` or `(platform)`-lane code is written**. No board lane starts until the fork is recorded as resolved (a one-line decision note in this section + the F1 Beads issue).
- **Fallback criteria — what would justify (B) over the recommended (A):** the Vite + TanStack Router + Clerk + tokens skeleton fails to render a signed-in shell within a short timebox (≈3 days), OR a hard dependency (a library with no Vite/Workers story) blocks it. If (B) is taken, it is explicitly temporary: a dated Vite-migration slice is filed in Beads in the same PR, so "defer" never becomes "forget."
- **Throwaway validation (if (A) is chosen):** the reviewer of the F1 PR confirms PR #25's `(platform)` route group is consumed as a routing-structure reference only — no new feature code is added to it after the fork is set, and it is deleted at the Phase 2 cutover alongside the rest of `roadmap-web`.
