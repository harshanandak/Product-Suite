# Agent Slice PR2 — Agent Runtime + 5 Retrieval-First Tools — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]`.

**Goal:** Make the moat loop provable end-to-end (pre-UI): a chat prompt → the agent reads the workboard and **proposes** work-item changes → proposals land in the PR1 queue → accept applies through the single write path.

**Architecture:** All in `platform-api` on Workers. `POST /api/agent/chat` (Hono) mints an `agent_runs` row, runs Vercel AI SDK v6 `streamText` against **OpenRouter** with 5 in-process `tool()`s behind a `ToolRegistry`, streams via `toUIMessageStreamResponse`, and on finish persists the transcript + closes the run. The agent's authority IS the chatting user's Clerk identity (no agent token). `propose_*` tools write ONLY to `proposals` (never real data).

**Tech Stack:** Hono/Workers · Neon (`sql.query` + tagged templates) · Vercel AI SDK v6 (`ai` ^6) · `@openrouter/ai-sdk-provider` ^2 · zod · Vitest/Bun.

## Global Constraints

- **Model-agnostic, no lock-in:** every model via `createOpenRouter({apiKey: env.OPENROUTER_API_KEY})`; the model id is a **config value** (`env.AGENT_MODEL`, documented default), swappable — mirror `apps/roadmap-web/src/lib/ai/ai-sdk-client.ts`. No provider-specific features.
- **Request-free loop (design §3):** the agent loop is a pure function of `(ctx, messages)` — NO `Request`/`Response` threaded in; the Hono handler resolves `ctx` and calls it. So a future queue consumer can call the same function for autonomous `agent_run`s.
- **Retrieval-first (design §6/§7):** read tools return **compact projections** (id/title/status/priority), paginated; `search_items` returns ranked hits via a `retrieve()` seam (Postgres FTS/ILIKE in v1), never raw dumps.
- **Agent never writes real data:** `propose_*` tools call PR1's `createProposal` (target_type='work_item') stamped `run_id` + `actor_type='agent'`, `on_behalf_of`=the user. Reads scoped by `callerTenantIds`.
- **Provable pre-UI:** the LLM is **mocked** in tests (deterministic tool-call emission) so the loop is asserted without a live model. TDD; frequent commits.
- Tenancy is a security boundary; ids never trusted from the client. Held for review when done.

## File Structure

- `packages/db/src/schema.ts` + `packages/db/migrations/0008_agent_transcript.sql` (+ journal/snapshot) — **Modify/Create**: add `agent_runs.transcript jsonb`.
- `apps/platform-api/src/agent/models.ts` — **Create**: `openrouterFrom(env)` + default model config.
- `apps/platform-api/src/agent/tools.ts` — **Create**: `buildTools(sql, ctx): ToolSet` (the `ToolRegistry`) — the 5 tools.
- `apps/platform-api/src/agent/retrieve.ts` — **Create**: `retrieve(sql, ctx, query, limit): Promise<ItemHit[]>` (BM25/FTS seam).
- `apps/platform-api/src/agent/runtime.ts` — **Create**: `runAgentChat(sql, ctx, messages)` (request-free loop) + `agent_runs` lifecycle + transcript persistence.
- `apps/platform-api/src/routes/agent-chat.ts` — **Create**: `POST /` handler (resolve ctx → `runAgentChat`), mounted at `/api/agent/chat` in `app.ts`.
- `apps/platform-api/src/proposals/repository.ts` — **Modify**: ensure `createProposal` accepts `run_id, target_type, operation, payload, rationale, confidence, actor_*, context_ref`.
- Co-located `*.test.ts` for tools, retrieve, runtime (mock model), and an integration test for the endpoint.

---

### Task 1: `agent_runs.transcript` column (migration 0008)

**Files:** `packages/db/src/schema.ts`, `packages/db/migrations/0008_agent_transcript.sql`, `meta/_journal.json` (+ idx 8), `meta/0008_snapshot.json` (copy 0007, bump id/prevId), `packages/db/src/schema.test.ts`.

**Interfaces:** `agentRuns.transcript` — `jsonb('transcript')` (nullable; the full messages+tool-calls array, written at run end — design §13).

- [ ] **Step 1:** Failing test — `Object.keys(schema.agentRuns)` contains `'transcript'`.
- [ ] **Step 2:** Run → fail.
- [ ] **Step 3:** Add `transcript: jsonb('transcript')` to `agentRuns`; migration: `ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "transcript" jsonb;` + journal idx 8 + snapshot copy.
- [ ] **Step 4:** Run test + `bun run typecheck` → pass.
- [ ] **Step 5:** Commit — `feat(db): agent_runs.transcript for decision-corpus capture (0008)`.

---

### Task 2: OpenRouter model config (`agent/models.ts`)

**Interfaces:** `openrouterFrom(env: { OPENROUTER_API_KEY?: string }): OpenRouterProvider` and `agentModel(env): LanguageModel` = `openrouterFrom(env)(env.AGENT_MODEL ?? DEFAULT_AGENT_MODEL)`. `DEFAULT_AGENT_MODEL` = a strong tool-calling OpenRouter id (config; document it's a founder choice, §17 open q). Mirror `roadmap-web`'s `createOpenRouter` usage.

- [ ] **Step 1:** Failing test — `agentModel({ OPENROUTER_API_KEY: 'k', AGENT_MODEL: 'x/y' })` returns a model whose id/config reflects `x/y` (assert it doesn't throw + is defined; provider is not called).
- [ ] **Step 2–4:** Implement + run + typecheck.
- [ ] **Step 5:** Commit — `feat(agent): OpenRouter model config (swappable via env)`.

---

### Task 3: `retrieve()` + read tools context

**Files:** `agent/retrieve.ts`, tested.

**Interfaces:** `interface ItemHit { id; title; status_id; priority; team_id }`; `retrieve(sql, ctx: { tenantIds: string[] }, query: string, limit = 8): Promise<ItemHit[]>` — tenant-scoped ranked match (v1: `WHERE tenant_id = any($1) AND (title ILIKE $2 OR description ILIKE $2) ORDER BY … LIMIT`). Compact projection only.

- [ ] **Step 1:** Failing test — `retrieve` scopes by tenant array + returns compact hits (mock sql).
- [ ] **Step 2–4:** Implement + run + typecheck.
- [ ] **Step 5:** Commit — `feat(agent): retrieve() seam (tenant-scoped, compact)`.

---

### Task 4: the 5 tools (`agent/tools.ts` — the ToolRegistry)

**Interfaces:** `interface ToolContext { tenantIds: string[]; userId: string; runId: string }`; `buildTools(sql, ctx: ToolContext): ToolSet` returns:
- `list_work_items` — `inputSchema z.object({ team_id?, status_id?, limit? })` · execute → compact projection scoped by `ctx.tenantIds`.
- `get_work_item` — `z.object({ id })` · execute → one item scoped.
- `search_items` — `z.object({ query, limit? })` · execute → `retrieve(sql, ctx, query, limit)`.
- `propose_create` — `z.object({ title, team_id, status_id, description?, priority?, rationale? })` · execute → `createProposal(sql, { tenant_id: ctx.tenantIds[0]?, run_id: ctx.runId, target_type:'work_item', operation:'create', payload, rationale, actor_type:'agent', actor_id: ctx.runId, on_behalf_of: ctx.userId, context_ref: ctx.runId })` → returns `{ proposed: true, proposal_id }`.
- `propose_update` — `z.object({ id, patch: z.record(z.unknown()), rationale? })` · execute → `createProposal(... operation:'update', target_id: id, payload: patch ...)`.

**Rules:** every tool execute is server-side, scoped to `ctx`; `propose_*` write ONLY to `proposals`. Reads never dump — projections + limits.

- [ ] **Step 1:** Failing tests — (a) `propose_create` execute inserts a proposal stamped `run_id`+`actor_type='agent'`+`on_behalf_of=userId` (assert `createProposal` args); (b) `list_work_items` execute scopes by `ctx.tenantIds` and returns compact fields only.
- [ ] **Step 2–4:** Implement `buildTools` + run + typecheck.
- [ ] **Step 5:** Commit — `feat(agent): 5 retrieval-first tools behind buildTools (ToolRegistry)`.

---

### Task 5: request-free runtime + `agent_runs` lifecycle (`agent/runtime.ts`)

**Interfaces:** `runAgentChat(sql, ctx: { tenantIds: string[]; tenantId: string; userId: string; model: LanguageModel }, messages: UIMessage[]): Promise<Response>`:
1. mint `agent_runs` (`kind='chat'`, `status='running'`, `triggered_by=userId`, `tenant_id=tenantId`) → `runId`.
2. `tools = buildTools(sql, { tenantIds, userId, runId })`.
3. `streamText({ model, system: AGENT_SYSTEM_PROMPT, messages: convertToModelMessages(messages), tools, stopWhen: stepCountIs(8) })`.
4. `onFinish` → persist transcript (the response messages + tool calls) to `agent_runs.transcript`, set `status='completed'` (or `'failed'` on error) + `summary`.
5. return `result.toUIMessageStreamResponse()`.

- [ ] **Step 1:** Failing test — with a **mocked** `streamText` (mock the `ai` module) that emits a `propose_create` tool call, `runAgentChat` (a) creates a running `agent_runs` row, (b) the tool executes → a proposal is created, (c) onFinish marks the run completed + writes a transcript. Assert via mocked `sql`.
- [ ] **Step 2–4:** Implement + run + typecheck.
- [ ] **Step 5:** Commit — `feat(agent): request-free runAgentChat + agent_runs lifecycle + transcript`.

---

### Task 6: `POST /api/agent/chat` endpoint

**Files:** `routes/agent-chat.ts`, `app.ts` (mount), tested.

**Interfaces:** `POST /` — behind `clerkAuth`; resolve `callerTenantIds` (deny if empty) + `callerUserId` (approver/triggerer); parse `{ messages }`; `runAgentChat(sql, { tenantIds, tenantId: tenantIds[0], userId, model: agentModel(c.env) }, messages)`; return its `Response`. 401 without token; 403 no org.

- [ ] **Step 1:** Failing integration test — POST `/api/agent/chat` with a mocked model emitting `propose_create` → 200 stream + a proposal row created for the caller's tenant (mirror `teams.test.ts` harness + mock `ai`).
- [ ] **Step 2–4:** Implement route + mount in `app.ts` at `/api/agent/chat` + run + typecheck.
- [ ] **Step 5:** Commit — `feat(agent): POST /api/agent/chat streaming endpoint (moat loop provable)`.

---

## Self-Review

- **Spec coverage:** runtime/streaming (§2) → T5/T6; request-free loop (§3) → T5; 5 tools + ToolRegistry (§6) → T4; retrieval-first + retrieve seam (§6/§7) → T3; transcript + context_ref capture (§13) → T1/T4/T5; model-agnostic (§11) → T2. ✓
- **Placeholder scan:** the LLM is explicitly mocked in tests (named strategy, not a TODO); `DEFAULT_AGENT_MODEL` is a flagged config decision, not a placeholder. ✓
- **Type consistency:** `ToolContext {tenantIds,userId,runId}` (tools) vs `runAgentChat` ctx `{tenantIds,tenantId,userId,model}` — distinct by design (runtime resolves runId then builds ToolContext). `createProposal` args match PR1's `proposals` columns. ✓

## Execution Handoff

Recommend **subagent-driven** (one Opus builder, then Fable adversarial review + my verification — the process that caught PR1's seam bugs), built **solo on this branch** (no parallel agents on shared state). Riskiest task: T5/T6 (mocking `streamText`/the `ai` module correctly so the loop is asserted without a live model).
