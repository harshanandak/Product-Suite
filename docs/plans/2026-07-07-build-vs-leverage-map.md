# Build-from-scratch vs. leverage — the Product-Suite map

Date: 2026-07-07 · Question: our memory/AI/systems are the real USPs — so how much do
we actually build from scratch, and how much can we leverage (the way we already use
Affine's BlockSuite for the canvas)?

**Answer: leverage aggressively at the library/component level; build from scratch only
the differentiated core (memory model + AI orchestration + cross-module contracts). The
from-scratch surface is small today — and that is the healthy state.** This is the
companion to [fork-vs-build](../research/2026-07-07-fork-vs-build-huly-plane-affine.md):
the line is not "build vs. borrow," it is **compose commodity libraries, own your USP,
never fork a whole app.**

## The principle: "own the model, rent the machinery"

Rent the machinery (editor engine, CRDT transport, AI streaming, UI kit, DB, auth, STT).
Own the model (your domain contracts, your memory schema + recall policy, your agent
orchestration, your AI-native wiring). This even applies *inside* the things you build:
`agent-core` owns the state machine but the LLM/tool execution is injected; a memory
layer should own the schema + write/recall policy but **rent the store** (Neon+pgvector
or a temporal-KG lib), not hand-roll a vector DB.

## What we already leverage (verified in-repo, 2026-07-07)

| Concern | Leveraged library | Where |
|---|---|---|
| Block/rich-text/canvas editor | **Affine BlockSuite** `@blocksuite/{blocks,presets,store,affine-block-surface,affine-model}` `^0.19.5` | `apps/roadmap-web`, wrapped by hand-built `packages/ui-canvas` boundary |
| Realtime / CRDT | **Yjs** `^13.6` + **Hocuspocus** `@hocuspocus/{server,provider}` `^4` | `services/hocuspocus`, `apps/roadmap-web` |
| AI streaming / chat UI | **Vercel AI SDK v6** (`ai`, `@ai-sdk/react`) + `@assistant-ui/react` | `apps/roadmap-web`, `packages/ui-chat` |
| Model routing | `@openrouter/ai-sdk-provider`, `parallel-web` | `apps/roadmap-web` |
| Transcription (STT) | OpenAI Whisper (`OpenAIWhisperSpeechProvider`) | `apps/meeting-api/backend/server.py` |
| UI primitives | shadcn + ~30 `@radix-ui/*`, `cva`, `clsx`, `tailwind-merge`, `cmdk`, `lucide`, `sonner`, `vaul`, `@dnd-kit`, `motion` | all web apps, `packages/ui` |
| Flow / graph layout | `@xyflow/react`, `dagre`, `elkjs` | `roadmap-web`, `platform-web` |
| Data / state | `@tanstack/react-{query,router,table,virtual}`, `zustand` | `platform-web`, `roadmap-web` |
| Forms / validation | `react-hook-form` + `@hookform/resolvers` + `zod` | web apps |
| Charts | `recharts` | all web apps |
| Auth | **Clerk** `@clerk/clerk-react ^5` (target); Supabase still present in roadmap-web | `platform-web`; migration incomplete |
| DB | **Neon** `@neondatabase/neon-js`; Supabase + Upstash still in roadmap-web | `meeting-web`; migration incomplete |

## What is genuinely hand-built — the moat (verified)

- **`services/agent-core`** (zero deps) — a plan/step **orchestration state machine**:
  dependency-ordered execution (`getNextPendingStep` honoring `dependsOn`), retry limits,
  cancellation + timeout guards (`withExecutionGuards` via `Promise.race`/`AbortController`).
  Tool execution + LLM are **injected**. Legitimately differentiated; keep it.
- **`packages/contracts`** (zero deps, plain JS + `.d.ts`) — domain model + validators +
  auth policy: `work-items.js` (`deriveHealth`, dependency relationships, patch fields),
  `enums.js`, `auth.js`, plus `canvas`/`conversation`/`meeting`/`identity`. This is the
  **connective tissue** that lets meeting, workboard, and roadmap share one model. Own it.
- **`packages/ui-canvas` + `services/hocuspocus`** — thin hand-built **boundary/adapter**
  layers around BlockSuite/Yjs (persistence + realtime + permission hooks). Own the seam,
  rent the engine. Correct pattern.

## The gap that matters most — CORRECTED (Fable review, 2026-07-07)

**An earlier draft of this doc claimed "no memory subsystem exists yet." That is WRONG**
(the initial Explore pass only inspected `agent-core` + `contracts`). Memory already exists
in **two fragmented implementations, on the wrong stacks:**

- `apps/meeting-api/backend/alembic/versions/0002_summary_first_memory.py` — a
  "summary-first meeting memory" schema running `CREATE EXTENSION ... vector` (pgvector on
  Postgres); CI uses `pgvector/pgvector:pg16`.
- `apps/roadmap-web/src/lib/ai/` — a full hierarchical memory pipeline on **Supabase (the
  store being retired)**: `embeddings/embedding-service.ts` (text-embedding-3-large,
  pgvector formatting) + `document-processor.ts`, `compression/l2-summarizer.ts` /
  `l3-topic-clustering.ts` / `l4-concept-extractor.ts`, and `api/knowledge/{compression,
  context}` routes + BlockSuite RAG (`components/blocksuite/rag-types.ts`, `mindmap-chunker.ts`).

**So the honest answer is the opposite of the draft: the memory job is CONSOLIDATION, not
creation.** Building a third greenfield memory system would be the mistake — two would rot
on the wrong stacks while a new one is built. Instead: unify both into **one Neon+pgvector
schema, typed in `packages/contracts`**, consumable by `agent-core` and `meeting-api`.

**Defensibility — be blunt: raw cross-session RAG memory is table-stakes in 2026, not a
USP.** Every competitor has or can rent it. What is defensible is memory **bound to
`contracts`** — recall that spans meeting → workboard → roadmap through *one typed domain
model*. **The contracts package is the moat; memory is the fuel.** This doc (and the fork
doc) slightly overweight "memory" and underweight contracts — correct that emphasis.

**Build vs. rent for memory:** rent pgvector-on-Neon (Neon supports it natively;
meeting-api already assumes it) and rent embeddings (OpenAI / Workers AI). Rent nothing
else — no Pinecone / mem0 / Zep. Own the schema, the write/recall policy, and the L2–L4
compression hierarchy already prototyped in roadmap-web. **Cloudflare caveat:** L3/L4
clustering exceeds Worker CPU budgets — run it on Queues / Workflows / Cron, not inline.

## Port vs. salvage — DECIDED (traced 2026-07-08): SALVAGE-AND-REBUILD

Traced whether roadmap-web's `lib/ai/` memory pipeline is live or dead. Finding:
**app-layer logic is real and UI-wired, but its entire DB backend is absent from the repo.**

- Wired path: `components/knowledge/knowledge-dashboard.tsx` → `useKnowledgeGraph()`
  (`lib/hooks/use-knowledge.ts`) → `api/knowledge/*` + `api/documents/search` routes →
  `lib/ai/compression/job-runner.ts` → `l2-summarizer` / `l3-topic-clustering` /
  `l4-concept-extractor` + `embeddings/embedding-service.ts`. Real logic, not stubs.
- **Missing backend:** the code calls Supabase RPCs `search_documents` /
  `get_compressed_context` and writes embeddings/summaries/topics/concepts tables, but
  `apps/roadmap-web/supabase/migrations/` has only 6 migrations (multitenant, invitations,
  RLS, conversion-tracking, ai-model-tracking, tags) — **no pgvector, no memory tables,
  none of those RPCs exist in the repo.** It cannot run as committed.
- Stale: last `lib/ai/` commit `2026-05-19` (#13, a boundary refactor).

**Decision:** SALVAGE the TypeScript pipeline (L2–L4, embedding-service, chunker,
job-runner, dashboard UI); REBUILD the data layer fresh on **Neon + pgvector, typed in
`contracts`**, converging with `meeting-api` migration `0002`'s committed pgvector schema.
There is nothing to lift-and-shift on the DB side — it was never committed.

**Verified side-facts:** Neon package is `@neondatabase/neon-js@0.2.0-beta.1` (meeting-web)
— the earlier doc value was correct. Auth is currently split THREE ways — Clerk
(platform-web), Neon Auth `@neondatabase/auth`+`auth-ui` (meeting-web), Supabase
(roadmap-web); confirm Clerk is the single target before migrating.

## Auth decision — DECIDED (2026-07-08): provider-neutral wrapper, minter is a config axis

The `canonical-auth` wrapper (`apps/roadmap-web/src/lib/canonical-auth.ts`) already reads
provider-neutral `AuthClaims` from `@product-suite/contracts` via a signed `ps_auth_claims`
cookie, and already selects provider from `ROADMAP_CANONICAL_AUTH_PROVIDER` (default
`'neon'`). So the "Clerk vs Neon Auth" conflict is resolved by **not choosing globally** —
the minter is a **deployment config** behind the same claims contract:

- **Managed / hosted product → Clerk** (GA, battle-tested; already in platform-web). Auth
  is security-critical and Neon Auth's UI ships as `@neondatabase/auth-ui@0.1.0-alpha.11`
  (alpha) — do not make alpha the *only* path.
- **Open-source / self-host distribution → Neon Auth (Stack Auth, OSS + self-hostable).**
  Clerk is not self-hostable, so Stack Auth is the correct OSS minter. Default stays `'neon'`.

Both mint the same `ps_auth_claims`. This is the vindication of the "auth behind a wrapper,
in contracts" directive — the app never imports an auth SDK.

**Surface (measured 2026-07-08):** 199 files touch Supabase (127 auth-tagged, 188 with
`.from(`/`.rpc(`), 5 RLS policies, seams in `src/lib/supabase/{client,server,middleware}.ts`).
This is a multi-PR program. **De-risking key: ~120 read-sites are provider-agnostic** (they
just read canonical claims) and migrate WITHOUT the minter choice; only login/signup/callback
need the minter (wire Clerk first — copyable from platform-web).

## Stack direction — VERIFIED from repo (2026-07-08), not just memory

Earlier drafts asserted "Neon single / Supabase retired" from memory. Now verified against
git: `main` HEAD is `#62` (2026-07-06) recording the Neon+Clerk stack decision. A cluster of
**unmerged** branches — `feat/pr17-platform-auth-data-consolidation`,
`feat/pr19-unified-supabase-platform-schema`,
`feat/pr20-meeting-database-cutover-from-neon-to-supabase`,
`feat/pr21-single-domain-platform-shell` — took the **opposite (Supabase-consolidation)**
path but are dated **2026-05-22 → 06-14 (≈3 weeks EARLIER)** and sit 36–38 commits behind
main, never merged. **They are the abandoned pre-decision path; the Neon direction stands.**
roadmap-web's 199 Supabase files are legacy predating the decision.

**Salvage flag:** pr17 (auth-data-consolidation) and pr21 (single-domain-platform-shell)
likely contain auth-consolidation + platform-shell logic directly reusable for the
canonical-auth/Neon migration. Triage them before writing new migration code — do not
rebuild weeks of work that already exists on a branch (same salvage-vs-rebuild lesson as the
memory pipeline).

**Server-side auth seam already exists:** read-sites migrate by calling
`readCanonicalAuthClaimsFromCookieStore(await cookies())` (pattern live in
`apps/roadmap-web/src/app/page.tsx:9`) instead of `createClient().auth.getUser()`.

## Sequencing — the correct order of work

1. **Finish Supabase → Neon/Clerk in `roadmap-web` first.** The best memory prototype lives
   there on the dying store; you cannot consolidate memory until its substrate moves.
2. **Unify the two memory implementations** into one Neon+pgvector schema, typed in
   `contracts`, consumable by `agent-core` and `meeting-api`.
3. **Wire `agent-core` recall/write policy** to that unified memory.

**Do NOT build yet:** a Pages/BlockSuite docs feature, new Plane-inspired workboard tables,
any temporal-KG library, any *new* memory subsystem, or any new module on the fragmented
base. Consolidation before creation.

## The other tax: leverage is inconsistent across apps

Right now `roadmap-web` uses Supabase(ssr+js) + Upstash + BlockSuite + AI SDK;
`platform-web` uses Clerk + TanStack; `meeting-web` uses Neon + `@base-ui`. The
Supabase→Neon/Clerk retirement is unfinished (`contracts/src/auth.js` still carries
Supabase-RLS logic). A real part of "how many things to build" is **consolidating what is
already leveraged onto one consistent set** (finish Clerk + Neon everywhere, one UI
primitive kit, one data layer) — that is cheaper and higher-leverage than building new
modules on a fragmented base.

## Rough proportion

- **~80% of surface = leveraged/composed** libraries (editor, CRDT, AI SDK, UI, data,
  auth, DB, charts, STT) — keep doing exactly this.
- **~20% = hand-authored core** (contracts, agent-core, collab boundaries) — and memory is
  *already prototyped twice*, so the from-scratch effort is **consolidation onto Neon +
  contracts**, not a fresh build.

The takeaway: we are not over-building — if anything we've built memory *twice* on stacks
we're retiring. The scratch surface is small and maps onto the USP, but the USP is **not
"we have memory" (table-stakes) — it is memory bound to one typed `contracts` model across
meeting → workboard → roadmap.** So: keep leveraging like we did with BlockSuite; treat
`contracts` as the moat; and the near-term work is **consolidate (finish Neon/Clerk, unify
the two memory impls, wire agent-core) before creating anything new.**
