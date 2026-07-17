# Memory Brain P3a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use `- [ ]` checkboxes.

**Goal:** Prove the unified knowledge state + deterministic authority: a `knowledge_chunks` (pgvector) store + embedded memories, unified behind a `search_knowledge` tool (RRF hybrid + authority tiers + a conflict-annotation demo), ingesting project-scoped past work-items only.

**Architecture:** Two physically-separate stores (`memories`, `knowledge_chunks`) sharing scope/topic/provenance vocabulary, unified by ONE retrieval service. Embeddings = OpenAI `text-embedding-3-large@1024` via OpenRouter (`halfvec`; reuses `OPENROUTER_API_KEY`). Recall lane = pgvector kNN ∪ FTS → RRF → deterministic tier weight → annotate. Conflict resolution is deterministic code (never LLM-judged). No canon-lane changes.

**Tech Stack:** Hono + Cloudflare Workers (platform-api), Neon Postgres + pgvector (≥0.7 for `halfvec`), Drizzle (hand-authored migrations), Vitest.

**Spec:** `docs/design/2026-07-17-memory-brain-p3a.md` — read first.

## Global Constraints
- **Neon HTTP, bound params only** (`sql.query(text, params)`); never interpolate values. Vector ops via raw SQL (`halfvec`/`fts` are not Drizzle types → their columns are omitted from the `pgTable` and addressed in raw SQL).
- **Hand-authored migration** (0013) + `_journal.json` entry (idx 13, version 7); additive; **do not touch meta snapshots**.
- **Determinism** is "given index state" — HNSW is approximate; the attribution rail logs ACTUAL injected items so the causal/holdout signal stays honest. No `Math.random`.
- **Holdout safety:** `search_knowledge` is omitted from the toolset on a holdout run; if invoked, chunk-lane only, memory would-be-hits logged `suppressed=true`.
- **Attribution honesty:** all `search_knowledge` hits → `run_knowledge_attributions` (never `run_memory_attributions`); memory-value analysis must UNION both tables (kind='memory').
- **Env:** embeddings use **`OPENROUTER_API_KEY`** (already wired in `agent/models.ts` — no new provisioning); optional `KB_EMBED_MODEL` override (default `openai/text-embedding-3-large`). Tests mock the client. Confirm `CREATE EXTENSION vector` ≥0.7 on the branch DB (Task 1). Confirm `statusCategoryEnum` includes `'completed'` and exact `activity_events` columns.
- Commit per task, TDD; run api suite + `tsc --noEmit` from `apps/platform-api` (local binaries, never `npx`).

**Task order:** 1 (migration) → 2 (authority pure fns) → 3 (embedding client) → 4 (ingestion) → 5 (retrieval recall lane) → 6 (tool + attribution + holdout).

---

## File Structure
| File | Responsibility | Task |
|---|---|---|
| `packages/db/migrations/0013_knowledge_base.sql` (create) + `_journal.json` + `schema.ts` | pgvector, `knowledge_chunks`, `memories.embedding`, `run_knowledge_attributions` | 1 |
| `apps/platform-api/src/agent/authority.ts` (create) + `.test.ts` | `resolveTier`, `compareByAuthority`, `annotateByAuthority`, `ANNOTATE_SIM_THRESHOLD` | 2 |
| `apps/platform-api/src/agent/embeddings.ts` (create) + `.test.ts` | OpenRouter embedding client + provenance + degraded contract | 3 |
| `apps/platform-api/src/agent/kb-ingest.ts` (create) + `.test.ts` + route `routes/agent-kb.ts` | backfill memory embeddings + ingest work-items | 4 |
| `apps/platform-api/src/agent/knowledge-retrieval.ts` (create) + `.test.ts` | `searchKnowledge` (kNN∪FTS→RRF→tier→annotate), `rrfFuse` | 5 |
| `apps/platform-api/src/agent/tools.ts` (modify) + `runtime.ts` (holdout omit) + attribution | `search_knowledge` tool + `run_knowledge_attributions` logging | 6 |

---

## Task 1: Migration 0013 — pgvector + chunk store + attribution rail

**Files:** create `packages/db/migrations/0013_knowledge_base.sql`; modify `_journal.json`, `packages/db/src/schema.ts`.

- [ ] **Step 1: Verify pgvector on the branch DB.** Run (or have the operator run) `select extversion from pg_extension where extname='vector';` — need ≥0.7 for `halfvec`. If absent, `create extension vector;` is in the migration; if the version is <0.7, STOP and escalate (halfvec unsupported).
- [ ] **Step 2: Write the migration SQL** — the full DDL from spec §3 (extension; `knowledge_chunks` with a `fts` GENERATED column `generated always as (to_tsvector('english', content)) stored`; `memories` add `embedding halfvec(1024)` + `embed_model text`; `run_knowledge_attributions` with the `rka_exactly_one` CHECK; all indexes incl. the two HNSW `halfvec_cosine_ops`).
- [ ] **Step 3: Journal entry** — append idx 13, version "7", tag `0013_knowledge_base`, `when` = 0012's + 1 day.
- [ ] **Step 4: Drizzle `pgTable`s** in schema.ts — `knowledgeChunks` (all columns EXCEPT `embedding`/`fts`), `runKnowledgeAttributions`; add `embedModel` (text) to `memories` (NOT `embedding` — raw SQL only). Add the `statusCategoryEnum`/etc. imports if needed.
- [ ] **Step 5:** `cd packages/db && ./node_modules/.bin/tsc --noEmit` → 0; `cd apps/platform-api && ./node_modules/.bin/tsc --noEmit` → 0.
- [ ] **Step 6: Commit** — `feat(db): knowledge_base migration 0013 — chunks + pgvector + attribution rail`.

---

## Task 2: Authority — deterministic tiers + annotation (pure functions)

**Files:** create `apps/platform-api/src/agent/authority.ts` + `.test.ts`.

**Interfaces produced:** `resolveTier(item): 0|1|2|3|4`; `compareByAuthority(a,b): number`; `annotateByAuthority(items): AnnotatedItem[]`; `ANNOTATE_SIM_THRESHOLD = 0.82`.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from 'vitest'
import { resolveTier, compareByAuthority, annotateByAuthority, ANNOTATE_SIM_THRESHOLD } from './authority'

describe('resolveTier', () => {
  it('orders pinned-hard-rule > active memory > work-item chunk', () => {
    expect(resolveTier({ kind: 'memory', memKind: 'rule', pinned: true, enforcement: 'hard' })).toBe(0)
    expect(resolveTier({ kind: 'memory', memKind: 'decision' })).toBe(1)
    expect(resolveTier({ kind: 'chunk', sourceType: 'work_item' })).toBe(3)
  })
})
describe('compareByAuthority', () => {
  it('higher tier first; ties → scope specificity → event-time recency', () => {
    const t1 = { tier: 1, scopeType: 'org', eventTime: '2026-01-01' }
    const t3 = { tier: 3, scopeType: 'work_item', eventTime: '2026-07-01' }
    expect(compareByAuthority(t1 as any, t3 as any)).toBeLessThan(0) // t1 first
    const a = { tier: 3, scopeType: 'project', eventTime: '2026-01-01' }
    const b = { tier: 3, scopeType: 'org', eventTime: '2026-01-01' }
    expect(compareByAuthority(a as any, b as any)).toBeLessThan(0) // project (more specific) first
  })
})
describe('annotateByAuthority', () => {
  it('annotates a lower-tier chunk highly similar to a higher-tier memory', () => {
    const mem = { id: 'm1', tier: 1, kind: 'memory', title: 'Use Postgres', embedding: [1, 0, 0] }
    const chunk = { id: 'c1', tier: 3, kind: 'chunk', title: 'DB choice', embedding: [0.99, 0.14, 0] }
    const out = annotateByAuthority([chunk, mem] as any)
    const annotated = out.find((x) => x.id === 'c1')!
    expect(annotated.annotation).toMatch(/see decision: Use Postgres/)
    // the higher-tier memory ranks before the annotated chunk
    expect(out.findIndex((x) => x.id === 'm1')).toBeLessThan(out.findIndex((x) => x.id === 'c1'))
  })
  it('does NOT annotate below the threshold', () => {
    const mem = { id: 'm1', tier: 1, kind: 'memory', title: 'X', embedding: [1, 0, 0] }
    const chunk = { id: 'c1', tier: 3, kind: 'chunk', title: 'Y', embedding: [0, 1, 0] }
    expect(annotateByAuthority([chunk, mem] as any).find((x) => x.id === 'c1')!.annotation).toBeUndefined()
    expect(ANNOTATE_SIM_THRESHOLD).toBe(0.82)
  })
})
```

- [ ] **Step 2:** run → fail. **Step 3: implement** `authority.ts` — `resolveTier` (pinned+hard rule→0; active decision/rule/fact→1; doc→2; work_item chunk→3; meeting→4); `compareByAuthority` (tier asc → scope-specificity rank {work_item:0,work_item_type:1,project:2,org:3} → eventTime desc → priority desc); cosine helper; `annotateByAuthority` (for each lower-tier item, find the highest-tier item with cosine ≥ threshold; if found, set `annotation="see decision: <title>"`, then stable-sort by `compareByAuthority`). **Step 4:** run → pass. **Step 5: commit** — `feat(agent): deterministic authority tiers + conflict annotation`.

---

## Task 3: Embedding client (OpenRouter)

**Files:** create `apps/platform-api/src/agent/embeddings.ts` + `.test.ts`.

**Interfaces:** `embed(texts: string[], env): Promise<EmbedResult>` where `EmbedResult = { vectors: number[][]; model: string; dims: number }`; throws `EmbeddingError` on failure. (No `input_type` — OpenAI-format embeddings don't use one; same call for ingest + query.)

- [ ] **Step 1: Failing test** — mock `fetch`; assert one batched POST to `https://openrouter.ai/api/v1/embeddings` with body `{ model: 'openai/text-embedding-3-large', input: texts, dimensions: 1024 }` + `Authorization: Bearer <env.OPENROUTER_API_KEY>`; returns `{ vectors, model:'openai/text-embedding-3-large', dims:1024 }`; model overridable via `env.KB_EMBED_MODEL`; on non-200/network → throws `EmbeddingError` (caller decides degrade). **Step 2:** fail. **Step 3: implement** — a single `fetch` to the OpenRouter embeddings endpoint (OpenAI-compatible), parse `data[].embedding`, return provenance (`provider='openrouter'`, model, dims); defensive parse; typed error; key from `env.OPENROUTER_API_KEY`. **Step 4:** pass. **Step 5: commit** — `feat(agent): OpenRouter embedding client (text-embedding-3-large @1024, provenance)`.

---

## Task 4: Ingestion — memory backfill + work-item chunks

**Files:** create `apps/platform-api/src/agent/kb-ingest.ts` + `.test.ts`; add route `POST /api/agent/kb/ingest` (mirror `agent-reflection.ts` single-org anchor).

**Interfaces:** `ingestKnowledge(sql, { tenantId, embed }): Promise<{ memoriesEmbedded: number; chunksIngested: number }>` (`embed` injected for tests).

- [ ] **Step 1: Failing test** (mocked sql + embed): asserts (a) memory backfill embeds only `embedding is null` active rows and stamps `embed_model`; (b) work-item selection query joins `statuses` on `status_id` where `category='completed'` and `archived=false`; (c) each item → one chunk with `content = title+"\n"+description`, `scope_type='project'` (`org` when `project_id` null), `event_time` from the item's latest `activity_events.created_at` (fallback `updated_at`), `tier=3`, provenance stamped; (d) a re-ingest is a no-op (dedup unique index). **Step 2:** fail. **Step 3: implement** — the two queries + the chunk insert (`on conflict … do nothing` on the dedup index); use the injected `embed`. **Step 4:** pass. **Step 5: route** — `POST /api/agent/kb/ingest` builds the real `embed` from the OpenRouter client + calls `ingestKnowledge`. **Step 6:** api suite + tsc. **Step 7: commit** — `feat(agent): KB ingestion — memory backfill + work-item chunks`.

---

## Task 5: Retrieval recall lane

**Files:** create `apps/platform-api/src/agent/knowledge-retrieval.ts` + `.test.ts`.

**Interfaces:** `rrfFuse(lists: Ranked[][], k=60): FusedItem[]`; `searchKnowledge(sql, { tenantId, scope?, query, k, holdout, embed }): Promise<KnowledgeItem[]>`.

- [ ] **Step 1: Failing test — `rrfFuse`** (pure): fixed inputs → deterministic order; an item ranked high in two lists beats one ranked high in one; id tie-break. **Step 2/3:** implement RRF (`score = Σ 1/(k+rank)`, sort desc, id tie-break). **Step 4:** pass.
- [ ] **Step 5: Failing test — `searchKnowledge`** (mocked sql + embed): kNN(chunks)∪kNN(memories)∪FTS(chunks)∪FTS(memories) → RRF → `resolveTier`+tier-weight → `annotateByAuthority` → returns memories AND chunks in one list; a T1 memory outranks a same-relevance T3 chunk; **embed failure → FTS-only** (no throw); **holdout=true → chunk-lane only** (no memory rows returned). **Step 6:** fail. **Step 7: implement** — embed the query (catch → FTS-only mode); per-store raw-SQL queries (HNSW kNN `order by embedding <=> $q::halfvec limit N`, and `fts @@ plainto_tsquery`), tenant+scope-cascade+status='active' filters; RRF; tier weight; annotate; token budget. On holdout, skip the memories lanes. **Step 8:** pass + tsc. **Step 9: commit** — `feat(agent): unified knowledge recall lane (RRF hybrid + authority)`.

---

## Task 6: `search_knowledge` tool + attribution + holdout omit

**Files:** modify `apps/platform-api/src/agent/tools.ts`, `runtime.ts` (holdout), + attribution insert.

- [ ] **Step 1: Failing tests** — (a) `search_knowledge` tool: given a query, calls `searchKnowledge`, fences results as untrusted, returns compact hits; logs each hit to `run_knowledge_attributions` (kind + exactly-one FK, rank, score). (b) `buildTools` omits `search_knowledge` on `holdout` (mirror the P2b `search_memory` omission). (c) holdout run: the memories lane is excluded + would-be memory hits logged `suppressed=true`. **Step 2:** fail. **Step 3: implement** — add `search_knowledge` to `buildTools` (with the holdout-omit destructure like `search_memory`); an `insertKnowledgeAttributions` helper (bound params, `run_knowledge_attributions`); wire attribution-before-return. **Step 4:** pass; full api suite + tsc. **Step 5: commit** — `feat(agent): search_knowledge tool + KB attribution rail`.

---

## Self-Review
**Spec coverage:** §3 schema→T1 · §2 authority→T2 · §4A embeddings→T3 · §4B ingestion→T4 · §4C recall lane→T5 · §4D tool+attribution+holdout→T6. ✓
**Deferred (correctly absent):** knowledge_sources, document/meeting ingestion, async contradiction job, promotion, reranker wiring (seam only), self-hosted BGE.
**Type consistency:** `KnowledgeItem`/`Ranked`/`FusedItem` consistent T5→T6; `embed` signature consistent T3→T4→T5; `resolveTier` tiers match the spec.
**Build-time verifications owed:** pgvector ≥0.7 on the branch DB (T1 Step 1); `statusCategoryEnum` includes `'completed'`; `OPENROUTER_API_KEY` already provisioned (reused — confirm it's in the Workers env/CI, it is for the agent); the memory-value/holdout analysis unions both attribution tables (a P2b follow-up, noted).
