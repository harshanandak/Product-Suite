# Product-Suite — Module Parallelization Roadmap

**Date:** 2026-07-05
**Canonical build contract (do not reinvent):** `docs/design/2026-07-05-work-item-port-plan.md`
**Status:** decisive execution plan. Supersedes the draft; folds in the adversarial critique (B1/B2/B3 + file-contention + honest critical path).

> **2026-07-10 deltas (from the canonical [Vision & Architecture](2026-07-10-vision-and-architecture.md)):**
> - **Modes are PROJECT-level, org-defaulted.** Jira/Linear/Notion strictness is a preset bundle of
>   guard-rail settings resolved per project from an org default + optional ceiling (inherit → override
>   within bounds). Additive: the fixed `work_items` backbone stays; a per-project config/policy governs
>   behavior. Project becomes a first-class thing carrying its resolved mode.
> - **Agent-first setup replaces template-dependency.** Default onboarding is "describe your project →
>   the agent configures the board (mode + fields + workflow) within guard rails." Curated templates are
>   accelerators layered on top, not the foundation.
> - **The model router is a core agent-plane component** — classify task difficulty/stakes → dispatch to
>   the cheapest capable model, with a user-facing budget↔quality dial. Sits alongside CopilotKit/AG-UI/MCP.
> - **Canvas note:** BlockSuite is now the canonical canvas/blocks adopt — this supersedes the
>   "canvas re-contract off BlockSuite" item (§1.13) in this roadmap.

## Grounding rules (inherited, not re-litigated)
- Single L1 build contract is the Work-Item port plan. Rebuild sequence: **Phase 0** (F1 shell DONE; F2 Neon data plane + F3 seams NOT built) → **Phase 1** boards-on-mock → **Phase 2** convergence/cutover (deletes `apps/meeting-web`, deletes Supabase).
- Ownership: frontend/contract → **Claude**; backend/schema/infra → **Codex/GPT**; cross-family review.
- Universal rule: everything generated lands as a `proposals` row → one review queue.
- Model discipline: **data model first, UI last, honest placeholders only.**

## The insight that drives the cut
The richest domain model already exists and is unit-tested, but it is trapped in the wrong place — the vocabulary in `apps/platform-web/src/data/work-items/types.ts` and the enums inside React components in `packages/ui/src/components/*.tsx`. Neither the Python backend (`apps/meeting-api`) nor the SDK (`packages/sdk`) can import them, so every other board and the F2 schema will **fork** these types until they move. Freeing them is the keystone.

## What the critique changed (read this first)
1. **B1 — Split F2 migration pack #1.** `agents`, `agent.runs`, `connections` are Tier‑1 contracts gated at **G3**, so they cannot ride in a "day‑0" pack. Pack #1 splits into **1a** (`projects, product_tasks, proposals`; gated G1+G2) and **1b** (`agents, agent.runs, connections`; gated G3).
2. **B2 — Tenancy is day‑0 DDL, not Wave 2.** Every `CREATE TABLE` needs `workspace_id` + visibility columns from the first line. `visibility` + `workspace/membership` are promoted into **Foundation Wave 1**. No table DDL is authored before they are pinned.
3. **B3 — The shipped auth spine is Supabase‑RLS‑shaped; F2 is Neon and Phase 2 deletes Supabase.** `packages/contracts/src/index.d.ts` ships `PlatformSupabaseRlsContract { provider:"clerk", supabaseManagedSchemas, allowedBrowserSchemas, rlsIdentitySource … }`. Neon has no PostgREST/anon‑role/JWT‑RLS model. **New foundation item on the critical path:** a Neon tenant‑isolation redesign (app‑layer scoping or Neon‑native RLS).
4. **meeting-api Clerk cutover (auth boundary to resolve).** `apps/meeting-api` runs on **Neon Auth** (`MeetingCoreContract.auth.neonAuthUrlKey`) while `proposals`/`membership`/`visibility` are **Clerk**‑scoped. The `meeting.action_items → proposals` handoff and Phase‑2 convergence both cross this boundary, so meeting-api cuts over to Clerk (rewrite `backend/services/neon_auth.py` → Clerk + remap user rows) rather than building a bridge (§0). **New foundation item on the critical path.**
5. **Relocated out of per‑board tracks into shared foundation:** the **task‑write seam** (it defines the `product_tasks` write surface, not a workboard nicety), the **cycle guard** in `apps/platform-web/src/data/work-items/dependency-graph.ts` (shared by the store write‑guard *and* canvas `isValidConnection`), and **`ProposalCard`** (a cross‑module primitive for meeting/agent/Home, delivered at G2).
6. **Enum move is S–M, not "free."** `packages/contracts` is a JS package with hand‑authored `index.d.ts`; the enums are TS union types + label/order maps in `packages/ui`. The move requires keeping JS + `.d.ts` + canonical JSON in sync three ways — budget a tri‑directional type‑sync test.
7. **Honest critical path is longer.** F‑0/F‑1 **overlap** F2, they do not neatly precede it, and F2‑1a's true predecessor set includes the two new auth‑rework items. See §4.

---

## 0. Fable strategist review — corrections folded in (2026-07-05, guidance-only)

Deltas from a read-only Fable pass; read alongside §1–§5, they supersede where they conflict.

1. **Tenancy #7 = a pinned DECISION at G1, not built enforcement.** Decide app-layer scoping now (every query carries `workspace_id` + visibility filter); **defer** Neon-native RLS. Timebox to days — if G1 becomes a tenancy mini-project everything queues behind it (risk R1).
2. **Bridge #10 may be the wrong artifact — evaluate a Clerk cutover instead.** End-state auth is Cloudflare + Neon + **Clerk** (`architecture-reference.html`); Neon Auth is legacy. An M-sized Neon-Auth↔Clerk bridge feeds a dying system. Evaluate cutting `apps/meeting-api` to Clerk early (rewrite `backend/services/neon_auth.py` middleware + remap user rows) — similar cost, permanent, and **deletes a critical-path segment**. Decide this BEFORE pricing #10.
   - **✅ DECISION (user, 2026-07-05): go with the early Clerk cutover (option 1). Bridge #10 is DROPPED from the plan** (the bridge remains an acceptable fallback only if the cutover proves harder than expected). Meeting-api auth = Clerk, matching the end-state.
3. **Critical path is partly a capacity artifact.** Split pack 1a again: `projects`+`product_tasks` need only G1; `proposals` needs G2. F3 seams (`packages/transport`, `packages/jobs`) + `workers/platform-api` depend on 1a (not 1b) and can overlap F2 with a second Codex lane. The only dependency-forced pole is `G3 → 1b → agent-worker → runtime`.
4. **~2.5 executor lanes, not 4.** Tracks A + B are both Claude and contend; G1 slips unless the enum slice and the workboard-fast slice interleave deliberately. Loosen the agent fixture-UI gate — grant Track B the same draft-then-formalize rule Track D got for pack 1a; don't gate the whole fixture UI on the L-sized G3 contract. Extra hot files: `apps/platform-web/src/router.tsx`, hand-authored `packages/contracts/src/index.d.ts`.
5. **Meetly premise corrected (see the research doc).** The platform ALREADY has web capture → chunked upload → GPT-4o-Transcribe (`apps/meeting-api/backend/server.py`, `OpenAIWhisperSpeechProvider`) + real summarization — Meetly is NOT a pipeline source, and its diarization is PRO/paid, not MIT. Harvest only: (a) tuned summary prompts → `apps/meeting-api/backend/services/chapter_summary.py` (hours, survives cutover); (b) transcript/summary schema as a cross-check when authoring meeting tables. Reject its Next.js UI (meeting-web is deleted at Phase 2) + its multi-provider abstraction (standardized on OpenAI now). Net: Meetly **reinforces** "invest backend, go light on meeting-web."
6. **New risk R2 — auth-strategy churn (needs a human sign-off).** PR19/PR20 moved meeting Neon→Supabase ~4 weeks ago; F2 reverses it. Get a signed "Neon + Clerk is final" one-pager BEFORE funding the two auth-rework segments. **✅ SIGNED OFF (user, 2026-07-05): Neon + Clerk is the final direction; meeting-api cuts over to Clerk. R2 closed.**
7. **New blind spot — system-audio capture.** Browser `getUserMedia` can't hear desktop Zoom/Meet; that is the one thing a native engine (Meetly) solves. Don't build now — record the decision (meeting bot vs. a desktop companion post-Phase-2; a Meetly fork could be that companion, feeding `proposals`).

**✅ STACK DECISION (user, 2026-07-05): the single committed stack is Cloudflare + Neon + Clerk; Supabase is fully RETIRED, not kept.** Verified: Supabase today is the whole backend substrate, not DB-only — Auth (roadmap-web), Storage (canvas Yjs docs + avatars, 7 files), Realtime (canvas/chat/**live permissions**, 10 files), one Edge Function (`purge-deleted-resources`), and **RLS in 47 of 95 migrations**. Mapping: DB→**Neon**, Auth→**Clerk**, Storage→**Cloudflare R2**, Realtime→**Cloudflare Durable Objects** (or Hocuspocus self-host), Functions/cron→**Cloudflare Workers/Cron**, and **RLS→app-layer tenant scoping** in the Workers/API (Neon has no JWT-RLS — this IS tenancy redesign #7, the real long-pole). This confirms the Neon end-state; the cost is the `roadmap-web` Phase-2 convergence migration, not a quick Postgres swap.

**Do only these three this week:** (1) enum-only move + task-write interface → **REPOSITORY-INTERFACE-FREEZE** (decision-free; unblocks the Track D long pole); (2) decide **bridge-vs-Clerk-cutover** for meeting-api + the **app-layer tenancy shape** — unblocks all DDL; (3) start Codex on F2 scaffolding + `projects`/`product_tasks` against the draft, and lift Meetly's prompts into `chapter_summary.py`.

---

## 1. FOUNDATION‑FIRST — the models that must land first

Each entry: what it is → where it lives now → where it must go. **Tier‑0 blocks parallel module work; Tier‑1 unblocks specific boards/seams; Tier‑2 is deferrable.**

### TIER‑0 — Foundation Wave 1 (the keystone; nothing DDL happens before this is pinned)

1. **Domain enums** — `Phase, TaskStatus, Health, Priority, WorkItemType, WorkItemSource, Assignee‑kind`.
   - NOW: trapped inside React components `packages/ui/src/components/{phase-pill,status-pill,work-item-type-badge,priority-badge,provenance-chip,assignee-picker,health-badge}.tsx`.
   - TO: `packages/contracts/src/enums.js` (framework‑neutral) + `.d.ts` union types + canonical `packages/contracts/contracts/enums.json`; `packages/ui` re‑exports. `apps/platform-web/src/data/work-items/types.ts` already re‑exports these via `@product-suite/ui`, so the move is **transparent to platform‑web** — but not free. **Size: S–M** (tri‑directional JS/`.d.ts`/JSON sync test required). This is the one piece safe to land anytime; treat as the enum‑only slice.

2. **Core object vocabulary** — `Project, WorkItem, Task, WorkItemDependency, ActivityEvent, WorkItemPatch, WorkItemRow, deriveHealth`, provenance/source.
   - NOW: local + unit‑tested at `apps/platform-web/src/data/work-items/types.ts` (explicitly "ahead of the F2 backend").
   - TO: `packages/contracts/src/work-items.js` + canonical `packages/contracts/contracts/work-items-core.json` so the Python backend validates the same artifact. `types.ts` becomes a thin re‑import. **Size: M.**

3. **Task‑write surface** (promoted from workboard — it defines `product_tasks` writes for F2).
   - `createTask / updateTask / toggleStatus` on the `WorkItemRepository` interface (`apps/platform-web/src/data/work-items/repository.ts`) + mock impl. Tasks are read‑only everywhere today (repository exposes no task‑write methods). **This must be in the shared repository interface before F2 authors `product_tasks`, or the task‑mutation contract is authored twice.** **Size: M.**

4. **Cycle guard** — `wouldCreateCycle / dependencyExists` in `apps/platform-web/src/data/work-items/dependency-graph.ts`.
   - Shared by the store write‑guard AND the future canvas `isValidConnection`. Move it with the vocabulary so canvas re‑contract does not fork it. **Size: S.**

5. **Workspace + Membership entity contract** — membership must admit **agent principals** (member kind `human|agent`) and carry the roles `AuthClaims` references.
   - NOW: `packages/contracts/src/identity.js` is a config‑key MAP only — no entity model.
   - TO: add `Workspace` + `Membership` entities to `identity.js`, wired to `packages/contracts/src/auth.js` (`AuthClaims.workspace_ids/roles`). **Wave 1 (B2): every table's `workspace_id` FK targets this.** **Size: M.**

6. **Visibility contract** — `visibility` enum `workspace|department|restricted` + `visibility_grants`.
   - NOW: does not exist. Design §1 requires it "designed in from day one, never retrofitted."
   - TO: `packages/contracts/src/visibility.js` + JSON. **Wave 1 (B2): every table carries visibility columns from its first DDL line.** **Size: M.**

7. **Neon tenant‑isolation redesign** *(NEW — B3, on the critical path)*.
   - NOW: `packages/contracts/src/index.d.ts` ships `PlatformSupabaseRlsContract` (Clerk provider, Supabase‑managed schemas, PostgREST/anon‑role RLS). Phase 2 deletes Supabase; F2 is Neon, which has none of that enforcement.
   - TO: a Neon‑native tenancy contract — app‑layer scoping middleware (every query carries `workspace_id` + visibility filter) and/or Neon `SET app.workspace_id` + policy. Author it as `packages/contracts/src/tenancy.js` and pin it **before any F2 DDL.** **Size: M–L. Unpriced in the draft; it is a real long‑pole segment.**

### TIER‑0 — Foundation Wave 2 (the cross‑module review seam)

8. **Proposals contract** — the universal review‑queue sink ALL four modules write to (meeting action‑items, agent artifacts, growth unlocks) and the workboard consumes.
   - NOW: does not exist. Meeting action‑items and agent artifacts have nowhere shared to land.
   - TO: `packages/contracts/src/proposals.js` + JSON. Must encode the DESIGN §11 idempotency key `{source_type, source_id, source_candidate_id, target_kind}` and states `proposed→accepted|rejected|expired`. **THE cross‑module integration seam.** **Size: M.**

9. **`ProposalCard` design‑system primitive** *(relocated from the Agent track — it is cross‑module)*.
   - Add to `packages/ui/src/components/proposal-card.tsx`, delivered **at G2** so meeting action‑items, agent approvals, and the Home review queue all consume one card. `StatusPill` already exists (reserved for tasks + agent runs). **Size: S.**

10. **meeting-api Clerk cutover** *(NEW — on the critical path; gates the proposals handoff and Phase‑2; supersedes the dropped Neon‑Auth↔Clerk bridge, see §0)*.
   - NOW: `apps/meeting-api` authenticates on Neon Auth while `proposals`/`membership`/`visibility` are Clerk‑scoped.
   - TO: rewrite the `backend/services/neon_auth.py` middleware to Clerk + remap the existing user rows, so meeting-api authenticates on Clerk like the rest of the platform. It still gates `meeting.action_items → proposals` reconciliation and Phase‑2 convergence — the same critical‑path slot the bridge held; only the artifact changes, and there is no new bridge contract. **Size: M.**

### TIER‑1 — Foundation Wave 3 (unblocks specific boards + backend seams; gate **G3**)

11. **Agent / Run / Connector contracts** — `agents`, `agent.runs` (resumability: `memory_version` + message/step cursor), `approvals`, `connectors`, `connector_bindings`, `mcp_catalog`, `connections` (scope `user|workspace`), `tool_schemas`.
    - NOW: nonexistent in contracts; only the runtime `services/agent-core/src/index.ts` + a reserved (empty) Postgres `agent` schema (`infra/supabase/migrations/20260602120000_create_platform_schema.sql`).
    - TO: `packages/contracts/src/agents.js` + JSON. **Gates the agent‑board data layer AND F2 migration pack 1b (B1).** **Size: L.**

12. **Conversation contract extension** — object binding (`object_type/object_id`) + member kind `human|agent`.
    - NOW: `packages/contracts/src/conversation.js` is a chat key‑map missing the DESIGN §11 binding.
    - TO: extend `conversation.js`. Unblocks the object‑linked agent‑thread panel on every board. **Size: S–M.**

13. **Canvas re‑contract off BlockSuite** → React Flow + TipTap/Yjs (DESIGN §10 removes BlockSuite).
    - NOW: `packages/contracts/src/canvas.js` (table `blocksuite_documents`) + `packages/ui-canvas/src/index.ts` (bucket `blocksuite-yjs`) are stale.
    - TO: rewrite both to the React Flow + TipTap/Yjs model; consume the shared cycle guard (item 4). **Size: M.**

14. **SDK generalization** — a platform‑API client, and move the `WorkItemRepository` seam into `packages/sdk` so the F2 backend‑adapter swap is shared. `packages/sdk` must actually `import @product-suite/contracts` (today it declares the dep but never imports it).
    - **Sequencing hazard (file contention):** Track C Wave 1 also edits `packages/sdk` (meeting methods). Generalize **after** those methods land and behind a regression gate so it does not clobber them. **Size: M.**

15. **RealtimeTransport interface** (DESIGN §12 seam 2) — one neutral interface for graph presence + chat + canvas Yjs. Impls: Durable Objects (SaaS) / `services/hocuspocus` (self‑host). Only a canvas‑specific adapter exists today. **Size: M.**

### TIER‑2 (deferrable, module‑owned once Tier‑0/1 land — DO NOT build now)
`playbooks`, `product_strategies` tree + `work_item_strategies`, `customer_insights` + `work_item_insights`, `automations` + `automation_runs`, connector snapshots, files/attachments, global search index.

**Value migrations that must precede any F2 schema (DESIGN §11):** type‑aware phases → universal `plan|execute|review|done`; `timeline_items → product_tasks`; drop `work_items.status`; milestones rebind item→project; `meeting.action_items → proposals` (needs item 10, the meeting-api Clerk cutover).

---

## 2. WORKBOARD‑FAST — the minimal ordered cut to get it "right" so the team moves on

The workboard is the most complete module (data seam + table/kanban/graph + detail page + activity log all shipped; port‑plan PR1/PR2/PR4/PR5 in code). "Right" is a **SMALL slice**, not the deferred backlog. Ordered:

1. **PR3 perf fix (half‑done).** `apps/platform-web/src/boards/workboard/WorkboardScreen.tsx` and `.../graph/WorkboardGraphScreen.tsx` both still call `repo.listTasks()` (ALL tasks) purely to feed the editor's read‑only task list + derived health. `getTasks(itemId)` already exists and `.../detail/WorkItemDetailScreen.tsx` uses it. Switch the editor path to per‑item fetch‑on‑open so the F2 backend never inherits the fetch‑everything contract. **Size: S.**

2. **Graph parity.** `.../graph/WorkboardGraphScreen.tsx` node‑click still opens the editor Sheet instead of navigating to the detail page like table+kanban do (`WorkboardScreen.tsx` `handleSelectItem → navigate workboard/item/$itemId`). Route the graph node‑activate to the detail page. **Size: S.**

3. **Wire the task‑write seam** (Foundation item 3 is the contract; this is the UI wiring). Wire the detail Tasks tab (`.../detail/WorkItemDetailScreen.tsx`) and editor to `createTask/updateTask/toggleStatus`. Checking off / adding a task is core to a usable board. **Size: M.** *(The interface itself is a Tier‑0 deliverable — see §1.3 — so F2 authors `product_tasks` against the frozen shape.)*

4. **Cleanup.** Remove `apps/platform-web/src/verify-workboard.tsx` (throwaway screenshot harness still in `src`).

**Then swap types to contracts** (handoff from Foundation §1.1–1.4): once `packages/contracts` holds the vocabulary + task‑write + cycle guard, repoint `types.ts` to re‑import. **Sequence this AFTER the fast slice** to avoid churn (the enum‑only move in §1.1 is transparent and can happen anytime; the full vocabulary + task‑write relocation must follow the fast slice — see the file‑contention note in §5).

**Explicitly DEFER (documented future PRs, not correctness gaps):** Map view (PR7), Memory v0 (PR6), graph focused‑neighborhood scoping. Do not chase these to call the board "done."

**Workboard also provides to others once locked:** the repository‑seam pattern, the `apps/platform-web/src/boards/workboard/filter-state.ts` view‑state contract, and the detail‑page route template are the templates meeting/agent boards mirror. Lock the fast slice first so downstream boards copy a settled pattern.

---

## 3. PARALLEL STREAMS — meeting, canvas, agent‑board

### MEETING (invest BACKEND‑heavy — it survives cutover; deprioritize meeting‑web — deleted at Phase 2)
- **Dependencies:** NONE on the shared foundation for its independent slice — the stack is self‑contained (`apps/meeting-api` has real routes + real OpenAI). Soft‑depends on `proposals` (Foundation #8) **and** the meeting-api Clerk cutover (Foundation #10) for the cross‑module handoff.
- **START IMMEDIATELY (true independent slice — this is the real "M"):**
  (a) Wire the summary‑first buddy agent to OpenAI — `apps/meeting-api/backend/services/tool_router.py answer_buddy_query` returns a hardcoded `[Preview]` stub; `apps/meeting-api/backend/routes/buddy.py` persists invocations but never calls an LLM.
  (b) Add summary‑first + buddy + history + tools endpoints to `packages/sdk/src/meeting.js` — hooks call them via raw `fetch()` today (`apps/meeting-web/src/hooks/{useMeetingState,useRealtimeTranscript,useBuddyAgent}.js`), bypassing the typed client.
  (c) Wire chat compose/send into `apps/meeting-web/src/components/meeting/SummaryFirstMeetingScreen.jsx` (`sendChatMessage` exists in the SDK, not connected).
  (d) Delete orphaned `apps/meeting-web/src/components/{AIToolsPanel,TranscriptionPanel}.jsx`.
- **SEPARATE item, partly BLOCKED (do not bundle into the "M" above):** the `/tools/*` handlers in `apps/meeting-api/backend/routes/tools.py`. `/tools/search-web` is an **external‑provider integration** (its own item). `/tools/search-workspace` searches workspace data **that does not exist until F2** — for Wave 1, scope it to the **meeting corpus only** (`apps/meeting-api/backend/services/{corpus,retrieval}.py`); defer true cross‑workspace search to post‑F2.
- **LOWER priority / later:** embeddings/semantic retrieval to replace the naive keyword `score_history_match` (backend, survives cutover); true realtime (replace `/recent-lines` polling with SSE/WebSocket); adopting the parked `ui-chat` AI Elements.
- **Handoff:** after `proposals` (#8) AND the meeting-api Clerk cutover (#10) land, reconcile `meeting.action_items → proposals`. Meeting‑api DB moves to Neon inside the backend spine (Track D Wave 1).
- **Size:** **M** for the independent buddy+SDK+chat+cleanup slice; **separate** for `/tools/*` (part F2‑blocked); **L** for retrieval+realtime. **Buddy/tools/retrieval are backend and survive into platform‑web's L2; the chat‑compose work is on the doomed meeting‑web — do it lightly.**

### CANVAS (lowest priority — re‑contract only now; the board is genuinely Phase 2)
- **Dependencies:** the re‑contract off BlockSuite (Foundation #13), the shared cycle guard (Foundation #4), and RealtimeTransport (Foundation #15) for the Yjs seam.
- **START IMMEDIATELY (if capacity):** the re‑contract — rewrite `packages/contracts/src/canvas.js` + `packages/ui-canvas/src/index.ts` to React Flow + TipTap/Yjs, consuming the shared cycle guard (do NOT fork it). Pure contract/package refactor, no backend.
- **MUST WAIT:** the actual Canvas board (`apps/platform-web/src/boards/canvas/` — does not exist; the route at `apps/platform-web/src/router.tsx` still renders the `BoardScreen` placeholder) is Phase 2 convergence. Do NOT build it now.
- **Size:** M for the re‑contract, L for the board (Phase 2). It blocks no other board → **the stream to sacrifice under time pressure.**

### AGENT‑BOARD (greenfield in platform‑web; biggest unbuilt board; port‑heavy, then runtime)
- **Dependencies:** Foundation #11 (agent/run/connector contracts, **gate G3**), #8 (proposals — the Approvals lane feeds it) + #9 (`ProposalCard`), then the F2‑1b + F3 backend spine + `workers/` for the real runtime.
- **START IMMEDIATELY (no backend needed — but NOTE the honest ceiling):**
  (a) Create `apps/platform-web/src/data/agent-runs/` (types/fixtures/repository/use‑agent‑runs) mirroring the `src/data/work-items/` seam. **This may only start after G1** (the keystone), not "anytime."
  (b) Port the 4 lane screens (Runs / Approvals / Connectors / Action‑history) + a run‑detail surface from the 20 legacy components in `apps/roadmap-web/src/components/ai/` (`action-history-list.tsx`, `approval-dialog.tsx`, `execution-progress.tsx`, `task-plan-card.tsx`, `tool-confirmation-card.tsx`, …) — **restyled from roadmap‑web's own ai‑elements/tokens to `packages/ui`/oklch, on fixtures.**
  (c) Repoint the 4 agent routes in `apps/platform-web/src/router.tsx` from the `apps/platform-web/src/shell/BoardScreen.tsx` placeholder to the real screens.
  (d) Add missing `packages/ui` primitives: `RunProgress`. (`ProposalCard` now ships from Foundation #9 at G2; `StatusPill` already exists.)
- **MUST WAIT:** the real agent runtime (AI SDK v6 + OpenRouter over `services/agent-core/src/index.ts`), the durable run worker + resumability spine (`agent.runs` message/step cursor), live MCP connectors (port `apps/roadmap-web/src/lib/ai/mcp/gateway-client.ts`), the custom‑agents create flow — **ALL wait on F2‑1b + F3 + `workers/agent-worker`.**
- **Size:** **L/XL** for the fixture‑UI port (restyle + new data seam + 4 lanes + run‑detail + new primitive + reconciling with the parked AI Elements), **XL total** with runtime. **This board becomes real LAST — Runs/Approvals/History are demoware on fixtures until live execution exists.**

### BACKEND SPINE F2 / F3 / workers (the true long pole; Codex‑owned)
No `infra/db/`, no `packages/transport`, no `packages/jobs`, no `workers/`. Every board is on the in‑memory mock. Runs as its own parallel stream from day 0 or nothing ever persists.
- **F2 Neon data plane:** `infra/db/` host‑neutral SQL, migration runner + codegen. **Migration pack #1 SPLIT (B1):**
  - **1a** (gated **G1+G2**): `projects`, `product_tasks` (against the frozen task‑write interface), `proposals` (w/ candidate‑id idempotency) — **all with `workspace_id` + visibility columns from line 1 (B2), enforced via the Neon tenancy contract (#7), not Supabase RLS.**
  - **1b** (gated **G3**): `agents`, `agent.runs`, `connections` (scope `user|workspace`).
  - Move `apps/meeting-api` DB to Neon.
- **F3 seams:** `packages/transport` (RealtimeTransport impl — DO / Hocuspocus), `packages/jobs` (queue/cron — CF Queues/Cron).
- **Workers:** `workers/platform-api` (Hono/MCP gateway), `workers/realtime` (Durable Objects), `workers/agent-worker` (AI SDK v6 + OpenRouter over `services/agent-core`).

---

## 4. DEPENDENCY GRAPH + CRITICAL PATH

```text
 FOUNDATION WAVE 1  (G1 keystone — days; nothing DDL before it)
 ├─ enums → packages/contracts/enums.js            (transparent; safe anytime)
 ├─ vocabulary → contracts/work-items.js
 ├─ TASK-WRITE interface (repository.ts)  ── defines product_tasks writes
 ├─ CYCLE GUARD (dependency-graph.ts)     ── shared w/ canvas isValidConnection
 ├─ workspace + membership (identity.js)  ◄─ B2: every table's workspace_id
 ├─ visibility (visibility.js)            ◄─ B2: every table's visibility cols
 └─ NEON TENANCY redesign (tenancy.js)    ◄─ B3: replaces PlatformSupabaseRlsContract
       │
       ├──► WORKBOARD-FAST (perf / graph-nav / task-write-wiring / cleanup)  ── mock, independent
       │        └─ (then) vocabulary+task-write type-swap  ── AFTER fast slice
       │
       ├──► REPOSITORY-INTERFACE-FREEZE  ◄── task-write IN + vocabulary relocated
       │        └──► Track D may build the F2 backend adapter behind the seam
       │
       └──► F2 pack #1a  (projects, product_tasks, proposals)   [needs G1 + G2]
                                     ▲
 FOUNDATION WAVE 2  (G2)             │
 ├─ proposals (proposals.js) ───────┤
 ├─ ProposalCard (packages/ui)  ── cross-module, all boards
 └─ MEETING-API CLERK CUTOVER (neon_auth.py → Clerk)  ── gates meeting→proposals + Phase 2
       │        ├──► MEETING action-item→proposal   (needs cutover)
       │        └──► AGENT Approvals lane
       │
 FOUNDATION WAVE 3  (G3)
 ├─ agents/agent.runs/connections (agents.js) ─┬─► F2 pack #1b   [needs G3]
 ├─ conversation-ext                           ├─► AGENT-UI fixture port
 ├─ SDK-generalize (after meeting SDK methods) │
 ├─ RealtimeTransport interface                └─► CANVAS re-contract (+ cycle guard)
       │
 F3 seams (packages/transport, packages/jobs)
       │
 WORKERS (platform-api / realtime / agent-worker)     ── G4: seam swap, UI mock→real
       │
 AGENT RUNTIME (durable runs on agent.runs, live MCP)  ── G5: agent board REAL (last)
       │
 PHASE 2 convergence + cutover (needs meeting-api on Clerk) ── deletes meeting-web + Supabase

 MEETING backend (buddy→OpenAI / SDK / chat / cleanup) ── hangs off NOTHING, start day 0
```

**Honest critical path (longest chain to a fully‑real, cross‑module product):**
`[ all Tier‑0 Wave 1 (vocab + task‑write + cycle guard + workspace/membership + visibility + Neon tenancy) + proposals + meeting-api Clerk cutover + Tier‑1 agents/connections ] → F2 1a → F2 1b → F3 seams → workers → agent runtime → Phase‑2 cutover.`

Two facts the draft got wrong and this corrects:
- **F‑0/F‑1 overlap F2, they don't cleanly precede it.** Track D authors pack 1a against the vocabulary draft in parallel, but cannot *finish* 1a until G1+G2 and cannot *start* 1b until G3.
- **The contracts long pole is longer than "F‑0→F‑1"** because **two auth‑rework segments (Neon tenancy redesign #7, meeting-api Clerk cutover #10)** sit on it and were previously unpriced.

**Shortest path to "team can move on":** WORKBOARD‑FAST + MEETING‑backend‑buddy + F‑0 **enum‑only** move, in parallel — days. The full vocabulary+task‑write relocation is placed **after** the fast slice (they contend on `types.ts`/`repository.ts`), so the "days" claim holds only under that split.

---

## 5. THE PARALLEL‑TRACK CUT (4 tracks, with gates/handoffs)

Ownership collapses onto two agent‑families (Claude = frontend/contract, Codex = backend/infra), cross‑reviewed — four independent workstreams.

**Track A — Contracts / Foundation (Claude).** The handoff artifact every other track consumes.
- **Wave 1 (G1):** enums + vocabulary + **task‑write interface** + **cycle guard** + **workspace/membership** + **visibility** + **Neon tenancy redesign** → `packages/contracts`. **Gate G1:** platform‑web + ui re‑import cleanly; tri‑directional type‑sync test green; tenancy contract pinned so no DDL is retrofitted.
- **Wave 2 (G2):** `proposals` + **`ProposalCard`** (`packages/ui`) + **meeting-api Clerk cutover**. **Gate G2.**
- **Wave 3 (G3):** agent/run/connector contracts + conversation‑ext + **SDK‑generalize (sequenced AFTER Track C's meeting SDK methods, behind a regression gate)** + RealtimeTransport + canvas re‑contract. **Gate G3.**
- Handoffs: G1 → Track B type‑swap + Track D pack 1a authoring; G2 → Track C proposals handoff + Track B Approvals lane + Track D proposals table; G3 → Track B agent‑UI + Track D pack 1b + canvas.

**Track B — Workboard finish + Agent‑board fixture UI (Claude).**
- **Wave 1 (day 0, no deps):** WORKBOARD‑FAST slice (perf, graph nav, task‑write wiring, cleanup). **Gate: workboard is "right", team moves on.** Then the vocabulary+task‑write type‑swap. **Then emit REPOSITORY‑INTERFACE‑FREEZE** (task‑write in + vocabulary relocated) — the signal Track D waits on before building the F2 adapter.
- **Wave 2 (after G3):** agent‑board fixture UI ported from `apps/roadmap-web/src/components/ai/` → `packages/ui` styling, on fixtures; new `apps/platform-web/src/data/agent-runs/` seam; repoint agent routes in `router.tsx`; add `RunProgress` to `packages/ui`.
- Handoff: locks the repository‑seam + detail‑page template other boards mirror; hands the agent‑runs seam shape to Track D to back with the real runtime.
- **File‑contention note:** `apps/platform-web/src/data/work-items/{types.ts,repository.ts}` is touched by Track A (relocate), Track B (task‑write), and Track D (adapter). These are **serial on the same files** — the interface‑freeze gate makes the ordering explicit. `packages/ui` is mutated by Track A (enum re‑export refactor of the pill/badge/picker components), Track A Wave 2 (`ProposalCard`), and Track B Wave 2 (`RunProgress`) — **serialize `packages/ui` edits, do not "parallelize" them.**

**Track C — Meeting (Codex for retrieval/tools; Claude for SDK/chat).**
- **Wave 1 (day 0, no deps — the true independent M):** buddy → OpenAI (`apps/meeting-api/backend/services/tool_router.py`), add summary‑first+buddy+history+tools methods to `packages/sdk/src/meeting.js`, chat compose in `SummaryFirstMeetingScreen.jsx`, delete dead components. **Gate: live AI Q&A over meeting memory is real.**
- **Wave 1b (separate, partly F2‑blocked):** `/tools/*` in `routes/tools.py` — `search-web` (external provider); `search-workspace` scoped to the meeting corpus for now, true cross‑workspace deferred to post‑F2.
- **Wave 2:** embeddings/semantic retrieval (pgvector) + SSE/WebSocket realtime.
- Handoff: after **G2 (proposals + meeting-api Clerk cutover #10)**, `meeting.action_items → proposals`. Meeting‑api DB moves to Neon inside Track D Wave 1. **SDK note:** Track A's SDK generalization must land AFTER these meeting methods, behind a regression gate.

**Track D — Backend spine F2/F3/workers (Codex) — the critical‑path long pole; start Wave 1 in parallel day 0.**
- **Wave 1:** F2 Neon data plane + **pack #1a** (`projects, product_tasks, proposals`; needs Track A G1+G2; author against the local `types.ts` draft immediately, formalize at the gates; **all tables carry `workspace_id` + visibility from line 1, enforced via the Neon tenancy contract — never Supabase RLS**). Move meeting‑api DB to Neon. **Builds the F2 backend adapter only AFTER Track B's REPOSITORY‑INTERFACE‑FREEZE.**
- **Wave 1b:** **pack #1b** (`agents, agent.runs, connections`; gated **G3**).
- **Wave 2:** F3 seams — `packages/transport` (RealtimeTransport impl), `packages/jobs` (queues/cron).
- **Wave 3:** `workers/platform-api` + `workers/realtime` + `workers/agent-worker` (AI SDK v6 + OpenRouter over `services/agent-core`). **Gate G4:** seam swap — UI streams flip from mock/fixtures to real backend.
- **Wave 4:** agent runtime — durable runs on `agent.runs`, live MCP connectors. **Gate G5:** Agent board Runs/Approvals/History become real.

**Gate summary:**
- **G1** — vocabulary + task‑write + cycle guard + workspace/membership + visibility + Neon tenancy in contracts → unblocks WB type‑swap + F2 pack 1a authoring. Hard gate before any `agent-runs` data seam.
- **REPOSITORY‑INTERFACE‑FREEZE** — task‑write in + vocabulary relocated → unblocks Track D building the F2 adapter behind a stable seam.
- **G2** — proposals + ProposalCard + meeting-api Clerk cutover → unblocks meeting→proposal + agent Approvals + proposals table.
- **G3** — agent/connector contracts + RealtimeTransport → unblocks agent‑UI + F2 pack 1b + canvas.
- **G4** — workers live → seam swap for all boards.
- **G5** — agent runtime → agent board is real.

**Decisive priorities under time pressure:**
1. Do the **enum‑only** G1 move first (a day, transparent, unblocks two families). Land the rest of Wave 1 — including the **Neon tenancy redesign** — before any F2 DDL, or you retrofit tenancy (forbidden).
2. Ship the workboard slice (perf, graph‑nav, task‑write, cleanup) and **stop** — no Map/Memory/scoping.
3. Start Track D Wave 1 in parallel day 0, but **split pack #1 (1a vs 1b)** and gate the F2 adapter on the interface‑freeze — do not let mock‑backed UI hide that nothing persists.
4. Invest meeting effort in the **backend** (survives cutover), not meeting‑web (deleted at Phase 2). Keep `/tools/search-workspace` scoped to the meeting corpus until F2.
5. **Canvas is the sacrificial stream** — re‑contract only; board is Phase 2.
6. Price the **two auth‑rework segments** (Neon tenancy, meeting-api Clerk cutover) as first‑class long‑pole work — they, not the UI, set the true end date.

---
*Canonical build contract: `docs/design/2026-07-05-work-item-port-plan.md`.*
