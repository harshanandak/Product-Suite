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
