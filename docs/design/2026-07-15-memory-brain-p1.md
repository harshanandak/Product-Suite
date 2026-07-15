# Memory Brain — P1 (decision/knowledge foundation + injection + attribution)

> Architecture: Fable-locked (3 reviews) + grounded in a real team's usage (CuraPod) + Forge patterns. This is **P1a** — the human-authored decision/knowledge store, its retrieval/injection into the agent, and the attribution rail (the moat's evidence). Agent-authored memory (memory-as-proposal via the Inbox + meeting-notes extraction) is **P1b**; the procedural learning loop + holdout is **P2**; the KB (pgvector) is **P3**.

## Why / what we already have
The agent proposes work-item changes; humans dispose in the Review Inbox; `proposals`/`agent_runs`/transcripts are the **episodic** memory (build nothing there). P1 adds the **semantic** layer — decisions + facts a team logs once and the agent then *reads and is grounded by* — so proposals reflect the org's actual decisions. The keystone is **capture friction**: logging a decision must be faster than not.

## The `memories` table (ONE table, `kind = decision | fact | rule`)
Rules (`kind='rule'`, learned) are written in P2; P1 uses `decision` + `fact`. All columns land now so P2/P1b don't re-migrate.

- `id` uuid pk · `tenant_id` text NOT NULL · `kind` enum(`decision`,`fact`,`rule`)
- `title` text (injectable one-liner) · `body` text (full statement) · `attrs` jsonb (kind-specific escape hatch)
- **Supersession chain:** `root_id` uuid (chain head; a new root = itself) · `supersedes_id` uuid null (immutable self-FK) · `superseded_by_id` uuid null (the ONLY mutable pointer) · `change_reason` text (MANDATORY when superseding) · `valid_from` timestamptz default now()
- **Status:** enum(`active`,`superseded`,`retracted`,`deferred`) — `retracted` = mis-record corrected (history kept); `deferred` uses `waiting_on` text + `review_after` timestamptz
- **Scope:** `scope_type` enum(`org`,`project`,`work_item_type`,`work_item`) default `org` · `scope_id` uuid null
- **Topic axis:** `topics` text[] (GIN index) · a generated `tsvector` FTS column over title+body
- **Provenance:** `source_kind` enum(`meeting`,`chat`,`proposal`,`manual`,`import`) · `source_run_id` uuid null (FK→agent_runs, ON DELETE SET NULL) · `source_proposal_id` uuid null (FK→proposals) · `source_quote` text null · `created_by` text · `decided_by` text null
- **Rule-only (unused in P1, present for P2):** `pinned` bool default false · `priority` int default 0 · `enforcement` enum(`advisory`,`hard`) default `advisory`
- `created_at` / `updated_at`. Indexes: `(tenant_id, status, scope_type, scope_id)`, `(tenant_id, root_id)`, GIN on `topics`, GIN on the tsvector.

**`run_memory_attributions`** (the moat rail — ship it now): `id`, `run_id` uuid FK→agent_runs, `memory_id` uuid FK→memories, `tenant_id` text NOT NULL, `injected_via` enum(`pinned`,`retrieved`,`tool`), `rank` int null, `tokens` int null, `suppressed` bool default false (P2 holdout logs what WOULD have injected), `created_at`. Also add `agent_runs.memory_holdout` boolean default false (assigned at run start; always false in P1).

**Migration: HAND-AUTHOR** it (SQL + `_journal.json` entry + copy-forward the meta snapshot with bumped ids) exactly like `0009_chat_threads.sql` — do NOT run `drizzle-kit generate` (drizzle-orm won't resolve in the worktree; snapshots are drift-prone).

## Backend (`platform-api`)
- **Domain** `src/domain/memories.ts` (mirror `work-items.ts` structure, tenant-scoped, `DomainError`): `createMemory(sql, {tenantId, actor}, input)` (new row, `root_id = id`, status `active`); `supersedeMemory(sql, {tenantIds, actor}, id, input)` (requires `change_reason`; atomically: insert the new version with `supersedes_id=id`+`root_id=<old root>`, set old row `status='superseded'`+`superseded_by_id=<new>`); `retractMemory` (status→`retracted`, keep row); `deferMemory` (status→`deferred` + `waiting_on`/`review_after`). All verify tenant ownership first (foreign id → `not_found`).
- **Retrieval** `src/agent/memory-retrieval.ts`: `retrieveForContext(sql, {tenantId, scope})` → the **resolved-to-current** (`status='active'`) decisions+facts for the scope cascade (org→project→work_item_type→work_item), ranked FTS+recency, **token-budgeted**, returned as fenced text + the `memory_id`s injected (for attribution). `search_memory` (see tool).
- **Runtime injection** (`agent/runtime.ts`): after `mintRun`, call `retrieveForContext`, append the fenced memory block to `buildSystemPrompt`'s output (fence AFTER truncation — untrusted data, never instructions), and write a `run_memory_attributions` row per injected memory (`injected_via='retrieved'`). Deterministic (no model in the loop) so attribution is causal. Thread `scope` through `AgentRunContext`.
- **Tool** `search_memory` in `agent/tools.ts`: tenant-scoped FTS over active memories (+ full supersession chain on request — "why did this flip?"); each returned id logs an attribution `injected_via='tool'`.
- **Routes** `routes/memories.ts`: `GET /api/memories` (org-scoped; filters: kind, status, topic, scope, `q` FTS) → Decision Log / Topic data; `GET /api/memories/:id` (+ its chain); `POST /api/memories` (create); `POST /api/memories/:id/supersede|retract|defer`. Every route org-scoped; foreign id → 404. Mount in `app.ts`.

## Frontend (`platform-web`)
- `data/memories` adapter (mirror the repositories; Clerk-bearer; org-scoped): `list(filters)`, `get(id)`, `create`, `supersede`, `retract`, `defer`.
- **"Log a decision"** — a FAST form (title required, body, kind, topics, scope) reachable from the shell (a command-palette action + a button); human-authored → **active immediately, no review**. This is the capture-friction keystone — keep it one-step.
- **Decision Log** view (route, e.g. `/w/$workspace/memory`): chronological, grouped by source; each item shows status pill, topics, provenance, and supersede/retract/defer actions; a superseded item shows its chain ("replaced by … because …").
- **Topic view**: resolved-to-current facts/decisions per topic (the topic-axis over the same store).
- Reuse `packages/ui` + tokens; match the Inbox/board look. Screenshot-verify.

## Out of scope (deferred — name in the PR)
- **P1b:** `target_type='memory'` proposals through the existing Review Inbox (agent-authored create/supersede/retract/defer) + paste-meeting-notes → agent emits a batch of memory proposals + chat "remember this".
- **P2 (moat):** `kind='rule'` reflection from `edited_payload` → candidate rules via the Inbox; ~10% `memory_holdout` + edit/reject-rate delta; pinned-rule deterministic injection; "saved N edits" UI + revoke.
- **P3:** KB (`kb_documents`/`kb_chunks` + pgvector hybrid `search_knowledge`).
- Also deferred: graph/temporal-KG, embeddings for decisions/rules, correction auto-propagation, auto-accept engine.

## Verification
- TDD; `typecheck` + `vitest` green BOTH apps; pre-push. Migration hand-authored + snapshot chain consistent.
- Tests: supersede creates a new version + latches the old (chain resolves to current, both rows kept, `change_reason` required); retract/defer keep history; **tenant isolation → 404 on every route + a foreign scope never retrieved/injected**; retrieval is scope-cascade correct + token-budgeted + fenced; **an attribution row is written per injected memory** (the moat rail); `search_memory` is tenant-scoped.
- **Fable adversarial review** before merge (tenant boundary, supersession correctness, injection fencing, attribution completeness, capture-friction of the log form).
- Screenshot: Log-a-decision + the Decision Log/Topic views.

## Execution
Solo Opus builder, commit per task (schema+migration · memory domain+routes · retrieval+injection+attribution+search tool · frontend log form+views). Riskiest: supersession atomicity + tenant-scoped injection/attribution. Hold for Fable review + screenshots.
