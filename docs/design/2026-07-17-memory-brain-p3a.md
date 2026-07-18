# Memory Brain P3a — the unified knowledge state (chunks + pgvector + deterministic authority)

> Scope: **P3a** is the first slice of P3 (the Knowledge Base). It proves the **unified searchable state + deterministic authority** idea end-to-end using the *lowest-friction* source (past work-items — already in Postgres, zero upload UX) plus the existing memories, behind one `search_knowledge` tool. Documents/wiki (P3b) and meeting transcripts (P3c) reuse the same rails. Builds on P1–P2b (all merged).
>
> Design basis: Fable architecture pass + 4 research streams + a focused embedding/reranker verification (see `docs/design/2026-07-17-memory-brain-p3-research-brief.md` / the Downloads brief). The load-bearing external finding: **conflict resolution must be deterministic code, not LLM-judged** (an LLM resolver scores 7% on the FactConsolidation benchmark; deterministic metadata comparison +21pp — arXiv:2606.01435). That keeps our attribution + 10% holdout rails causal.

## 1. The idea (what "one clean memory state" means here)
Not one table — **one retrieval *service*** over two physically-separate stores that share the same scope/topic/provenance vocabulary:
- **`memories`** (existing): few, human-ratified beliefs (decision/fact/rule) with supersession, scope cascade, provenance. High authority.
- **`knowledge_chunks`** (new): many, raw, unreviewed chunks derived from sources (work-items now; docs/meetings later). Lower authority, capped by tier.

Curated beliefs and bulk chunks have **different lifecycles** (review/supersession vs re-chunk/cascade-delete), so merging them into one table would pollute the belief machinery — the research consensus (Zep/Graphiti, cognee, CoALA) is layered stores + a unified query surface.

## 2. Authority — deterministic entrenchment tiers (the "decision layer")
Conflicts and ranking priority resolve by a **fixed lexicographic order in code** (grounded in AGM epistemic entrenchment + possibilistic lexicographic merging; deterministic + auditable):

> **Tier** (higher wins): **T0** pinned `hard` rule › **T1** active decision / rule / fact (human-ratified) › **T2** curated doc/SOP *(P3b)* › **T3** work-item resolution › **T4** meeting aside *(P3c)*.
> **Ties break by:** scope-specificity (work_item › work_item_type › project › org) → **event-time** recency (when it was *true*, not when captured) → **corroboration** (count of independent agreeing sources) → explicit `priority`.

- Authority (who wins a conflict) is kept **separate** from relevance (search rank). In P3a, tier is a **post-fusion ranking weight + a deterministic tie-break comparator** — NOT strict lexicographic override (a highly-relevant T3 chunk can still surface above a weakly-relevant T1; that's correct for a *search* tool). The strict-override semantics belong to injection/conflict resolution, which is P3b.
- **Minimal conflict demonstration (kept in P3a so the "decision layer" isn't entirely deferred):** at query time we already have the top-k items' embeddings, so compute pairwise cosine among them; when a **lower-tier** item (a T3 work-item chunk) is highly similar (≥ `ANNOTATE_SIM_THRESHOLD`, a **named, tested constant** — default `0.82`; determinism depends on it being fixed) to a **higher-tier** active memory in the same result set, **annotate** it — `"see decision: <memory title>"` — and rank the higher tier first. (On sparse real data this fires rarely, so the *proof* rests on the seeded unit test, §7 — keep it.) This is cheap, deterministic, and actually shows authority resolving a (soft) conflict. Full async cross-source contradiction *detection* + supersession + re-tiering via the Review Inbox is **P3b**.
- P3a implements `resolveTier(item)`, the ordering comparator, and the `annotateByAuthority(items)` pass as pure, unit-tested functions.

## 3. Schema (migration 0013)
Enable pgvector; add the chunk store; give memories an embedding so both answer one query.

```sql
create extension if not exists vector;

create table "knowledge_chunks" (
  "id" uuid primary key default gen_random_uuid(),
  "tenant_id" text not null,
  -- Source provenance (P3a: work_item). No separate knowledge_sources table yet —
  -- deferred to P3b when docs need version/staleness metadata.
  "source_type" text not null,          -- 'work_item' (P3a) | 'document' | 'meeting'
  "source_ref" text not null,           -- the work_item id (etc.)
  "chunk_index" integer not null default 0,
  "content" text not null,
  "content_hash" text not null,         -- dedup (exact-hash tier)
  "embedding" halfvec(1024),            -- openai/text-embedding-3-large @ 1024 dims (via OpenRouter), 2-byte
  -- FTS generated column (added in migration, not Drizzle-expressible), like memories.fts.
  -- Declared HERE (before the GIN index below) so the column the index references exists first:
  "fts" tsvector generated always as (to_tsvector('english', "content")) stored,
  -- Unified vocabulary with memories:
  "tier" integer not null,              -- resolved authority tier (T0..T4)
  "scope_type" text not null default 'org',
  "scope_id" uuid,
  "topics" text[] not null default '{}',
  "event_time" timestamptz,             -- bi-temporal: when the knowledge was TRUE
  -- Embedding provenance — hosted models silently version-bump; keep the rail honest:
  "embed_provider" text not null,       -- 'openrouter'
  "embed_model" text not null,          -- 'openai/text-embedding-3-large'
  "embed_dims" integer not null,        -- 1024
  "status" text not null default 'active',  -- active | stale | superseded
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);
-- HNSW on the halfvec (cosine); GIN on fts; scope + dedup indexes.
create index "knowledge_chunks_hnsw" on "knowledge_chunks" using hnsw ("embedding" halfvec_cosine_ops);
create index "knowledge_chunks_fts" on "knowledge_chunks" using gin ("fts");
create index "knowledge_chunks_tenant_scope" on "knowledge_chunks" ("tenant_id","status","scope_type","scope_id");
create unique index "knowledge_chunks_dedup" on "knowledge_chunks" ("tenant_id","source_type","source_ref","content_hash");

alter table "memories" add column "embedding" halfvec(1024);
alter table "memories" add column "embed_model" text;
create index "memories_hnsw" on "memories" using hnsw ("embedding" halfvec_cosine_ops);

-- The KB attribution rail (moat-rail analogue). A chunk can't satisfy
-- run_memory_attributions.memory_id (FK→memories), and reusing that table would
-- either need a nullable FK (weakening the existing rail) or conflate the two tools.
-- So a dedicated table; EXACTLY ONE of memory_id/chunk_id is set.
create table "run_knowledge_attributions" (
  "id" uuid primary key default gen_random_uuid(),
  "run_id" uuid not null references "agent_runs"("id") on delete cascade,
  "tenant_id" text not null,
  "memory_id" uuid references "memories"("id") on delete cascade,
  "chunk_id" uuid references "knowledge_chunks"("id") on delete cascade,
  "kind" text not null,          -- 'memory' | 'chunk'
  "rank" integer,
  "score" real,
  "suppressed" boolean not null default false,   -- holdout counterfactual
  "created_at" timestamptz not null default now(),
  constraint "rka_exactly_one" check (("memory_id" is null) <> ("chunk_id" is null))
);
create index "run_knowledge_attributions_run_idx" on "run_knowledge_attributions" ("run_id");
```
- **Drizzle side:** `halfvec` is not a native drizzle-orm column type, and (like the `fts` generated column) vector ops run through **raw tagged SQL** (`memory-retrieval.ts` uses `sql.query(text, params)` throughout). So the Drizzle `pgTable` for `knowledge_chunks` OMITS the `embedding`/`fts` columns (they exist only in the migration); the retrieval/ingest code addresses them via raw SQL. `memories`' new `embedding` column is likewise raw-SQL-only.
- **The `fts` generated tsvector** on `knowledge_chunks` is authored in the migration exactly as memories' `fts` is (migration 0010) — a `GENERATED ALWAYS AS (to_tsvector('english', content)) STORED` column, not a Drizzle type.
- Hand-authored SQL + `_journal.json` entry (idx 13, version 7); additive only; **do not touch the meta snapshots** (standing drift note). `halfvec(1024)` + `hnsw … halfvec_cosine_ops` require **pgvector ≥ 0.7** — Neon currently ships 0.8.x; **confirm `CREATE EXTENSION vector` version on the branch's DB at build time** and that `gen_random_uuid()` (pgcrypto) is available (it is, used across existing migrations).

## 4. Components

### A. Embedding client — `apps/platform-api/src/agent/embeddings.ts` (new)
- `embed(texts: string[], env): Promise<{ vector: number[]; model: string; dims: number }[]>` — one batched call to **OpenRouter's OpenAI-compatible embeddings endpoint** (`POST https://openrouter.ai/api/v1/embeddings`, bearer `env.OPENROUTER_API_KEY` — the SAME key the agent already uses via `agent/models.ts`, so **no new provisioning**). Body `{ model, input: texts, dimensions: 1024 }` where `model = env.KB_EMBED_MODEL ?? 'openai/text-embedding-3-large'`. OpenAI embeddings have **no `input_type`** (unlike Voyage/Cohere) — the same call serves ingest + query.
- Returns the vector + provenance (`provider='openrouter'`, `model`, `dims`) stamped on every stored row. Defensive: throws a typed `EmbeddingError` on failure (ingest/search handle it — a failed embed must not corrupt data or strand a run).
- `dimensions=1024` (OpenAI native Matryoshka) → store as `halfvec(1024)`. **Model-configurable** via `KB_EMBED_MODEL`, so we can A/B higher-MTEB OpenRouter models (Cohere `embed-v4`, `gemini-embedding`, `Qwen3-Embedding`) or swap to **Voyage** later — the per-vector `{provider,model,dims}` provenance makes a model bump safe. (Voyage `voyage-3.5-lite` was marginally better + cheaper but is not available yet — tracked as a follow-up.)

### B. Ingestion — `apps/platform-api/src/agent/kb-ingest.ts` (new) + route `POST /api/agent/kb/ingest`
1. **Backfill memories:** embed active `memories` rows lacking an `embedding` (batch), stamp `embed_model`. Cheap (few rows).
2. **Ingest work-items** (mind the real schema — `workItems` has **no** `resolution` or `completedAt` column):
   - **Select completed items:** join `statuses` on `status_id` where `statuses.category = 'completed'` (NOT the deprecated `phase` enum), `archived = false`, tenant-scoped, not already chunked.
   - **content** = `title + "\n" + description` (short → one chunk per item, no splitting); optionally append the item's `activity_events.summary` rows for resolution context.
   - **event_time** = the latest `activity_events.created_at` for the item, fallback `updated_at` (there is no completion timestamp column).
   - **scope** = the item's **project**: `scope_type='project'`, `scope_id = project_id` (`org`/null when the item has no project). **NOT `work_item` scope** — a work-item-scoped chunk would only surface when the run is already on that same item, so cross-item "have we solved this before?" recall would never fire.
   - Compute `content_hash`; skip on the dedup unique-index conflict. Embed, store `source_type='work_item'`, `source_ref = <work_item id>`, `tier = T3` (via `resolveTier`).
- Idempotent (dedup unique index + "not yet chunked" check). On-demand route now (like reflection); scheduling deferred. (Confirm exact `statuses`/`activity_events` column names against `schema.ts` when implementing.)

### C. Retrieval service — extend `apps/platform-api/src/agent/memory-retrieval.ts`
Two lanes, both deterministic (RRF is rank-only; no sampling):
- **Canon lane (unchanged):** the P1 scope-cascade active-memory injection into the prompt.
- **Recall lane (new):** `searchKnowledge(sql, { tenantId, scope?, query, k, holdout })`:
  0. **Holdout guard:** on a `holdout` run, the memories lane is excluded from the results (a holdout run must reach NO memory — same discipline that omits `search_memory` in P2b, §D) and any memory that *would* have surfaced is logged `suppressed=true`; chunks may still return (they're not the thing the memory-holdout measures). Simplest coherent rule: **on holdout, `search_knowledge` runs the chunk lane only.**
  1. Embed the query. **On embed failure, degrade to FTS-only** (deterministic; the tool still answers) rather than failing the tool — an embedding-provider outage must never strand the agent.
  2. **pgvector kNN** over `knowledge_chunks.embedding` ∪ `memories.embedding` (status='active', tenant + scope-cascade filter), top-N each.
  3. **FTS** (tsvector) over both, top-N each.
  4. **RRF fuse** the ranked lists (fixed `k=60`, id tie-break). Deterministic *given the index state* — HNSW is approximate, so recall can vary if the index changes, but for fixed inputs+index the output order is stable, and the attribution rail logs the ACTUAL injected items, so the causal/holdout signal stays honest (same as P1).
  5. **Authority weight + annotate:** multiply the fused score by a tier factor, break ties by the §2 comparator, and run `annotateByAuthority` (§2 minimal conflict demo — pairwise cosine, annotate a lower-tier item highly similar to a higher-tier memory).
  6. **(Feature-flagged) reranker stage** — default **OFF** (`KB_RERANK=1`): top-20 → a hosted cross-encoder → top-5 (provider TBD — Cohere `rerank-v3.5` or `voyage-rerank-2.5` when wired; self-hosted BGE later). Off by default so the holdout can measure its lift; version pinned + logged.
  7. Token-budget + return `KnowledgeItem[]` (`{ id, kind: 'memory'|'chunk', source_type, title/snippet, tier, score, scope, annotation? }`).

### D. Agent tool + attribution — `tools.ts` + the new rail
- **`search_knowledge` tool** (mirrors `search_memory`): the agent queries the unified state; results are fenced as untrusted data (chunks especially — a prompt-injection surface). The tool receives the run's `holdout` flag and applies §4C.0. **On a holdout run the tool is omitted from the toolset entirely** (same as `search_memory` in P2b) — belt-and-suspenders so a holdout run can reach neither memory lane.
- **Attribution → `run_knowledge_attributions` (§3), NOT `run_memory_attributions`.** Every `search_knowledge` hit is logged there — a `kind='memory'` hit sets `memory_id` (chunk_id null), a `kind='chunk'` hit sets `chunk_id` (memory_id null), with `rank`, `score`, and `suppressed` (the holdout counterfactual). Routing search_knowledge's memory hits here (rather than to `run_memory_attributions` as `injected_via='tool'`) keeps the two tools' rails distinct and the P2 memory-holdout signal clean. Logged deterministically after retrieval (attribution-before-return), like P1.
- **Analyst-side contract (measurement honesty):** because a memory can now be accessed via `search_knowledge` (logged to `run_knowledge_attributions`) OR the canon/`search_memory` path (logged to `run_memory_attributions`), any **memory-value analysis / P2 holdout must UNION both tables** filtered to `kind='memory'` — otherwise memory influence through the new tool is invisible and its causal value is undercounted once agents adopt it. State this in the metric query and the P2b analysis.

## 5. What P3a proves
The agent can `search_knowledge` and get **one ranked result set** spanning its ratified memories **and** the org's past work-items, ordered by relevance **and** deterministic authority — with attribution logged. That validates the unified-state + tier-authority architecture on real data before any upload/transcript UX exists.

## 6. Deferred (YAGNI → P3b/P3c)
- **P3b:** `knowledge_sources` (version/staleness), document/wiki upload + chunking (header-aware, ~400 tok, 15% overlap), the **async contradiction-detection job** (0.75–0.95 similarity band → NLI/LLM-judge → Review-Inbox item), chunk→memory **promotion** via the Inbox.
- **P3c:** meeting transcripts (speaker-turn chunking), the reranker turned on if RRF's floor needs it, MinHash/LSH dedup at scale, bi-temporal invalidation UI.
- **Later:** embedding upgrade A/B (voyage-3.5 / gemini-embedding-001), self-hosted BGE reranker, pgai Vectorizer for DB-driven refresh, RAGAS regression eval.

## 7. Testing strategy
- `resolveTier` + the ordering comparator (pure): T0>T1>T3; ties → scope → event-time → corroboration → priority; exhaustive cases.
- `annotateByAuthority` (pure): a T3 chunk highly similar (≥ threshold) to a T1 memory in the result set gets `annotation="see decision: …"` and the memory ranks first; below threshold → no annotation.
- RRF fusion deterministic (same inputs+index → same order; id tie-break).
- **Ingestion:** selects only `statuses.category='completed'`, non-archived items; content = title+description; `event_time` from latest activity / `updated_at` fallback; **scope = project (org when null), never work_item**; 1 chunk/item; dedup unique-index skips a re-ingest; memories backfill embeds only null-`embedding` rows; provenance (`provider/model/dims`) stamped.
- **Retrieval:** kNN∪FTS→RRF→tier weight returns memories AND chunks in one set; a T1 memory outranks a same-relevance T3 chunk; scope cascade respected; reranker flag OFF by default; **embed failure → FTS-only degraded (tool still answers)**; attribution rows written to `run_knowledge_attributions` (kind+exactly-one FK).
- **Holdout:** on a holdout run, `search_knowledge` is omitted from the toolset; if invoked directly it returns chunk-lane only, no memories, and would-be memory hits log `suppressed=true`.
- Embedding client: batched single call, `dimensions:1024`, provenance returned, defensive on API failure → typed error (mock OpenRouter `fetch`).

## 8. Defaults / decisions (locked via research + verification)
Embedding **OpenAI `text-embedding-3-large` @ 1024 dims via OpenRouter** (reuses `OPENROUTER_API_KEY`; `halfvec`; `KB_EMBED_MODEL`-configurable) · index **HNSW cosine** · fusion **RRF (k=60)** · reranker **feature-flagged OFF** (provider TBD — Cohere/voyage rerank when wired) · per-vector provenance `{provider,model,dims}` · work-items-only ingestion, **project-scoped** · tiers T0/T1 (memories) + T3 (work-items). Neon caveat: scale-to-zero cold start (~hundreds ms) is a latency (not correctness) concern for eval runs — pre-warm. Determinism is "given index state" — HNSW is approximate; the attribution rail logs actual injected items so the holdout stays causal.
