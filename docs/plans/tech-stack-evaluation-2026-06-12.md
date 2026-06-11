# Tech Stack Evaluation — Consolidated Decisions

Date: 2026-06-12
Method: six parallel research agents, each verifying current (June 2026) licenses, prices, versions, and maintenance status via web sources. Constraints applied uniformly: decided foundation (Vite + React 19 + TanStack Router, shadcn/Tailwind v4, Clerk, Cloudflare Workers/R2, Supabase Postgres, Bun monorepo, FastAPI on Railway), pre-revenue budget, open-source-first, agent-first architecture, fewest moving parts.

> **Status: recommended stack, pending founder sign-off.** Where this conflicts with older docs, this file + DESIGN.md §10 win.

## The one-line architecture

**Supabase Postgres is the only database; Cloudflare is the only realtime transport; Railway runs the two container workloads (FastAPI meetings, AI SDK agent workers); everything else is a library, not a service.**

Net new infrastructure: **zero servers** beyond what already runs.

## 1. Canvas, docs, and editors — resolves `TBD(canvas)`

| Need | Decision | License/Cost | Why |
| --- | --- | --- | --- |
| Dependency graph view | **React Flow (@xyflow/react 12.x) + @dagrejs/dagre** | MIT | Custom React nodes are first-class; healthy (12.11.0 June 2026); dagre suffices for DAGs, elkjs only if port routing ever needed (lazy-load — it's huge) |
| Freeform canvas board | **React Flow stretched to freeform** + `perfect-freehand` (ink, MIT, by tldraw's author) | MIT | One engine for both canvas surfaces; live work-item cards = plain React components; `onlyRenderVisibleElements` for perf |
| Rich-text docs | **TipTap core + y-prosemirror** | MIT (skip all paid Pro/Cloud) | y-prosemirror is the reference Yjs binding; React NodeViews = live object embeds; free Mention + suggestion-based slash menu |
| **BlockSuite** | **EXIT** — remove with its `patches/` | — | Still 0.x (v0.21, Apr 2026, "early stage"), web-component/React friction, we already patch it |
| tldraw | Rejected for now | ~$6k/yr commercial, production hard-gated by license key | Re-evaluate at funding via 100-day trial only if React Flow whiteboard ergonomics stall |
| Excalidraw | Rejected | MIT | canvas2d — cannot render live React shapes (open issue #8424) |

Rule: keep board/doc state in **our own Yjs schema**, never library-native formats — engine stays swappable.

## 2. Realtime — resolves the dual-transport convergence

**One transport: Cloudflare Durable Objects (partyserver, Cloudflare-owned since the PartyKit acquisition).** Retire BOTH the Hocuspocus-on-Railway service and Supabase Realtime.

| Room type | Mechanism |
| --- | --- |
| Doc rooms (canvas/doc) | Yjs in a DO (y-durableobjects or Hocuspocus v4-on-Workers); persistence in DO SQLite + periodic snapshots to Supabase/R2; presence = Yjs awareness |
| Channel/thread rooms | Message → Hono API → **Postgres (source of truth, agents are member rows)** → DO broadcast to room; live object cards hydrate via API |
| Workspace room | API mutations publish `{entity, id}` invalidation pings → SPA invalidates TanStack Query caches; polling fallback |

Cost: ~$5/mo Workers Paid, hibernation ≈ zero idle. Electric SQL / Zero (1.0 June 2026 — too fresh) are later upgrades if invalidation-ping granularity ever hurts. Migration: CRDTs make cutover trivial — load persisted updates into DOs, flip provider URL, dual-write snapshots a week, decommission Railway hocuspocus.

## 3. Agent runtime, automations, MCP

> **Revised 2026-06-12 (founder decision): model flexibility is a HARD requirement.** Claude Agent SDK rejected — the SDK is free but its main loop only drives Anthropic models, locking every agent-second to Claude pricing. OpenAI Agents SDK rejected on the same principle.

| Layer | Decision | Why |
| --- | --- | --- |
| Agent runtime (ALL runs) | **Vercel AI SDK v6 Agent + `@openrouter/ai-sdk-provider`** — same code in the Hono Worker (light calls) and Node workers on Railway (long runs) | Total model freedom: per-role routing via OpenRouter (cheap defaults — Kimi K2.5 / GLM / Gemini Flash — premium opt-in per run), proven by the founder's existing n8n pipeline; `needsApproval` HITL → proposals row; MCP client built in; type-safe `useChat` streaming |
| Resumability (we build it) | Run state persisted in `agent.runs` (messages + step cursor); pending gated tool → `proposals`; resume = rehydrate + continue loop | ~1–2 days on the pgmq spine; the price of zero model lock-in (Claude Agent SDK gave this free but Anthropic-only) |
| Python-side option | **Pydantic AI** inside FastAPI if agent logic ever belongs server-side in Python | Provider-agnostic, OpenRouter-ready, MIT |
| Named alternatives (not deps) | Mastra (AI-SDK-based, prebuilt memory/workflows, adds framework lock) · LangGraph **MIT library only** (platform billing was the rejection, not the library) | Revisit only if hand-rolled loop grows painful |
| Durable spine | **Supabase pgmq + pg_cron + `agent.runs`/`proposals` tables** | Zero new infra; cron + event triggers + retries + audit rows next to the data. Upgrade path: Trigger.dev v4 (Apache-2.0, real self-host) when orchestration outgrows pgmq; Inngest second option |
| Run flow | Hono/pg_cron enqueues pgmq → Railway worker claims, runs SDK session, streams to UI → gated tool writes proposal row, parks run `awaiting_approval` → approval re-enqueues resume | State in Postgres; SDK session is the resumable unit |
| MCP hosting | **Reuse official remote servers**: GitHub (`api.githubcopilot.com/mcp/`), Meta Ads (`mcp.facebook.com/ads`, 29 tools, free beta Apr 2026). GA: wrap official stdio server with FastMCP on Railway. Custom connectors: Cloudflare `McpAgent` + workers-oauth-provider | Zero hosting for the big two; replaces the custom FB n8n workflow |
| n8n | **Stays for founder back-office automations; is NOT the product engine** | Product automations must be agent-authored Postgres rows with audit trails |
| Rejected | LangGraph (platform billing), Temporal (ops burden), OpenAI Agents SDK/Mastra (weaker fit), Cloudflare Workflows as primary (can't execute Railway steps) | |

Model routing policy: OpenRouter is the single gateway (one key, all providers, fallbacks). Per-task-kind defaults live in workspace config — e.g. extraction/parsing → Gemini Flash or GLM-Flash; drafting/research → Kimi K2.5; judge/verify → GLM; premium models opt-in per run. This mirrors the founder's proven n8n model stack.

## 4. Meetings pipeline — ~$0.20 per meeting-hour

| Step | Decision | Cost |
| --- | --- | --- |
| Transcription + diarization | **AssemblyAI Universal async** (webhook) — diarization + word timestamps built in | ~$0.17/audio-hr |
| Extraction (summary/decisions/action-item proposals w/ confidence + timestamps) | **Gemini 3 Flash via OpenRouter**, JSON-schema structured output, Pydantic-validated, map-reduce >1.5 hr; Kimi K2.5 fallback | ~$0.03/meeting |
| "Ask this meeting" RAG | **pgvector (HNSW) + FTS hybrid on Supabase**, speaker-turn chunks (~600–800 tokens) with `start_ms/end_ms`; text-embedding-3-small | ~$0.0003/meeting |
| Meeting bots (future) | Browser `getDisplayMedia` first (free); Recall.ai at $0.50/recording-hr when bot-joins needed | scoped only |

Everything stays in the existing FastAPI/Railway service (jobs, webhook receiver, workers, chat endpoint). Keep the STT client behind an interface (Deepgram/gpt-4o-transcribe-diarize are drop-in swaps). Self-hosting GPUs only pays past ~300 audio-hrs/mo.

## 5. Platform services — Postgres-first, zero new servers

| Area | Decision | Cost |
| --- | --- | --- |
| Global search (Cmd+K) | **Postgres FTS (generated tsvector) + pg_trgm (typos) + pgvector, RRF hybrid** per Supabase guide; per-utterance transcript rows w/ GIN | $0 |
| Files | **Uppy (`@uppy/aws-s3`) → presigned R2 PUT**; previews via **Cloudflare Image Transformations on R2 origin** (5k free/mo — standardize 2–3 preset sizes); Worker presign enforces size/MIME + Clerk auth | ~$0 |
| Notifications | **Own `notifications` table + Supabase-side delivery + Resend email** (free 3k/mo). Novu rejected (MongoDB+Redis stack, second-inbox model), Knock rejected ($250/mo cliff). Digests = cron Worker + one template | $0 |
| Product analytics | **Own `events` table (PR23 contract) — Home IS the dashboard.** PostHog Cloud (1M events free) optional mirror later; self-host PostHog is hobby-only | $0 |
| Errors/observability | **Sentry free tier** (Workers + FastAPI SDKs); GlitchTip is the DSN-compatible escape hatch; upgrade trigger = second engineer seat ($26/mo) | $0 |

## 6. Work-management UI libraries

| Need | Decision | Note |
| --- | --- | --- |
| Table | **TanStack Table v8** (NOT v9 — beta) + TanStack Virtual | AG Grid disqualified (grouping = Enterprise); Glide rejected (canvas cells fight shadcn) |
| Kanban | **dnd-kit** (already in repo, active Apr 2026) | Best keyboard a11y; pin stable (experimental rewrite in flight) |
| Timeline/Gantt | **Build custom** (~2–3 days: divs/CSS grid + date scale + dnd-kit drag) | OSS field is weak: gantt-task-react dead, frappe-gantt non-React, SVAR open-core + styling clash. Adopt SVAR later only if critical-path features needed |
| Command palette | **cmdk** (shadcn `<Command>` foundation) | |
| Chat/transcript lists | **react-virtuoso** (reverse scroll, stable prepend) | TanStack Virtual stays for tables — split on purpose |
| Charts | **Keep recharts** (shadcn charts are recharts-based) | visx only for bespoke needs |

## Monthly cost picture (pre-revenue)

Fixed: Cloudflare Workers Paid $5 · Railway ~$10–20 (FastAPI + pooled agent workers) · Supabase existing plan · Clerk free tier · Resend/Sentry/AssemblyAI free tiers. **Fixed total ≈ $20–30/mo** + usage (≈$0.20/meeting-hr + LLM tokens). The only license risk avoided: tldraw $6k/yr.

## Build vs adopt (the short list)

**Build:** freeform-canvas ergonomics on React Flow (ink/marquee/snapping — timeboxed), custom Gantt lanes, run-queue worker, proposals UX, notifications table, events table, Yjs↔React Flow binding (transaction-origin filtering + scoped UndoManager).
**Adopt (all MIT/free):** React Flow, perfect-freehand, TipTap core, y-prosemirror, partyserver/y-durableobjects, AI SDK v6 + @openrouter/ai-sdk-provider, pgmq/pg_cron, FastMCP, official GitHub/Meta MCP servers, Uppy, TanStack Table/Virtual, dnd-kit, cmdk, react-virtuoso, recharts.
**Exit:** BlockSuite (+patches), Hocuspocus-on-Railway service, Supabase Realtime usage, custom FB n8n product workflow.

## 7. Portability and dependency posture (added 2026-06-12)

**AI SDK ≠ Vercel dependency.** The AI SDK is an Apache-2.0 library with no Vercel runtime coupling — it runs on Node, Bun, and Workers (Cloudflare maintains its own `workers-ai-provider` for it). Exposure is confined to the agent loop; all run state (runs, proposals, messages) is ours in Postgres, so the loop library is swappable (Mastra / LangGraph-lib / Pydantic AI) without touching data.

**Cloudflare dependency map — one real lock-in, by choice:**

| Piece | Lock-in | Exit |
| --- | --- | --- |
| Durable Objects (doc rooms, chat fanout, invalidation pings) | **Real — the only one** | Yjs CRDT updates are portable → Hocuspocus/y-sweet on a VM; chat truth is Postgres, only fanout needs rebuilding |
| Workers + Hono API | Low | Hono runs unchanged on Node/Bun/Railway |
| R2 | Low | S3-compatible → S3/MinIO (loses free egress) |
| Static hosting · Image Transformations · McpAgent | Trivial/low | Any static host · imgproxy · FastMCP on Railway |

Principle: **compute on Cloudflare is replaceable; all state (Postgres, S3-compatible R2, Yjs CRDTs) is portable.**

**Next.js exit = rebuild, not port.** New shell is born on Vite + TanStack Router (PR21a); old Next app serves on Vercel until parity, then DNS cutover and retirement. True migration work is only: ~30 Next API routes → Hono/Railway (opportunistically, per rebuilt surface); middleware auth → route guards + API-layer Clerk verification; public/marketing pages → separate static site.

**TanStack posture: libraries deep, Start deferred.** Adopt Router + **Query (the SPA's entire server-state layer: caching, optimistic updates, invalidation-ping consumer)** + Table v8 + Virtual. Deliberate exceptions: react-virtuoso (chat/transcripts reverse-scroll), react-hook-form (shadcn form primitives are RHF-based; revisit TanStack Form when battle-tested). TanStack Start remains a future non-breaking opt-in (builds on Router) — currently RC with a beta Clerk SDK, and a logged-in SPA needs no SSR. TanStack DB: watch-list only, too young.

## Top cross-cutting risks

1. React Flow-as-whiteboard ergonomics is the largest unknown — timebox the spike; tldraw trial is the named escape hatch.
2. Hand-rolled run resumability on AI SDK (messages + step cursor in `agent.runs`) — keep it boring; Mastra/LangGraph-lib are the named fallbacks if it grows hairy.
3. y-durableobjects is small/single-maintainer — partyserver (Cloudflare-owned) is the room layer; validate Hocuspocus-v4-on-Workers under load.
4. Hand-rolled pgmq durability — Trigger.dev v4 is the named upgrade, don't improvise a workflow engine.
5. Pricing churn (AssemblyAI/Recall cut prices this year) — keep vendor clients behind interfaces.
