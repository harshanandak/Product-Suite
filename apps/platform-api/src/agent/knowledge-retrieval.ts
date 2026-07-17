import type { Sql } from '@product-suite/db'

import {
  ANNOTATE_SIM_THRESHOLD,
  annotateByAuthority,
  compareByAuthority,
  resolveTier,
  type AnnotatableItem,
  type AuthorityTier,
} from './authority'
import { buildScopeCascade, estimateTokens, sanitizeForFence, type MemoryScopeInput } from './memory-retrieval'

/**
 * Memory Brain P3a §4C — the unified knowledge RECALL lane. `searchKnowledge` fuses
 * FOUR ranked lists (pgvector kNN over chunk + memory embeddings, plus FTS over each)
 * with Reciprocal Rank Fusion, then applies the deterministic authority layer (§2):
 * a tier weight on the fused score, `annotateByAuthority` conflict flags, and a token
 * budget. The output is ONE ranked set spanning the org's ratified memories AND its
 * past work-item chunks — ordered by relevance *and* authority.
 *
 * Determinism discipline (same as P1): RRF is rank-only (no sampling), and the
 * annotate/tier steps are pure. HNSW recall can drift if the index changes, but for a
 * fixed input+index the order is stable and the attribution rail logs the ACTUAL
 * returned items, so the causal/holdout signal stays honest.
 *
 * Degradation contracts:
 *   - embed failure → FTS-only mode (the tool still answers; never throws).
 *   - holdout=true → CHUNK lane only (skip BOTH memory lanes) — mirrors the P2b
 *     memory-holdout discipline so a holdout run reaches no memory.
 */

/** The injected embed function — Task 3's `embed` with its `env` already bound. */
export type EmbedFn = (texts: string[]) => Promise<{ vectors: number[][]; model: string; dims: number }>

/** One ranked entry fed to {@link rrfFuse}. `rank` is 0-based (list position). */
export interface Ranked {
  id: string
  rank: number
}

/** A fused id + its Reciprocal-Rank-Fusion score. */
export interface FusedItem {
  id: string
  score: number
}

/** The default RRF constant. Larger `k` flattens the contribution of top ranks. */
export const RRF_K = 60

/**
 * Reciprocal Rank Fusion of N ranked lists. `score(id) = Σ 1/(k + rank)` summed across
 * every list the id appears in; higher = better. Sorted by score DESC with an id
 * ascending tie-break, so the output order is FULLY deterministic for fixed inputs —
 * an id ranked high in two lists beats one ranked high in only one. Pure: no I/O.
 */
export function rrfFuse(lists: Ranked[][], k = RRF_K): FusedItem[] {
  const scores = new Map<string, number>()
  for (const list of lists) {
    for (const entry of list) {
      scores.set(entry.id, (scores.get(entry.id) ?? 0) + 1 / (k + entry.rank))
    }
  }
  return Array.from(scores.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** One item in the unified recall result set. Chunks carry `sourceType`; memories don't. */
export interface KnowledgeItem {
  id: string
  kind: 'memory' | 'chunk'
  sourceType?: string
  title: string
  snippet?: string
  tier: AuthorityTier
  score: number
  scope: string
  annotation?: string
}

export interface SearchKnowledgeCtx {
  tenantId: string
  scope?: MemoryScopeInput
  query: string
  /** Max items to return (also caps per-lane candidate breadth). */
  k: number
  /** On a holdout run, skip BOTH memory lanes (chunk-lane only). */
  holdout?: boolean
  embed: EmbedFn
}

/** Token budget for the returned block (kept small + deterministic, like P1). */
export const DEFAULT_KNOWLEDGE_TOKEN_BUDGET = 1200

/**
 * Deterministic tier weight applied multiplicatively to the fused RRF score. Lower
 * tier (more authoritative) → larger factor, so at EQUAL relevance a T1 memory (×4)
 * outranks a T3 chunk (×2). Strictly decreasing in tier → the authority ordering is
 * reproducible.
 */
export function tierWeight(tier: AuthorityTier): number {
  return 5 - tier
}

/** Raw parameterized query helper — mirrors `memory-retrieval.ts` (Neon HTTP, bound params only). */
function runQuery<Row>(sql: Sql, text: string, params: unknown[]): Promise<Row[]> {
  return (sql as unknown as { query: (q: string, p: unknown[]) => Promise<Row[]> }).query(text, params)
}

/** Format a JS `number[]` as a pgvector/`halfvec` literal `'[v1,v2,...]'` for a `$n::halfvec` bind. */
function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`
}

/** Parse a `halfvec`/`vector` text form `'[a,b,c]'` back to `number[]`; undefined when absent/empty. */
function parseVector(text: string | null | undefined): number[] | undefined {
  if (!text) return undefined
  const inner = text.trim().replace(/^\[/, '').replace(/\]$/, '')
  if (inner.length === 0) return undefined
  return inner.split(',').map(Number)
}

/**
 * Append the scope-cascade OR-clause to `params` (which already holds the earlier
 * binds) and return its SQL. Same shape as `memory-retrieval.ts`: org is a literal,
 * scoped rows bind (scope_type, scope_id). A foreign scope is never in the WHERE.
 */
function scopeClause(cascade: { scopeType: string; scopeId: string | null }[], params: unknown[]): string {
  const clauses: string[] = []
  for (const c of cascade) {
    if (c.scopeType === 'org') {
      clauses.push(`scope_type = 'org'`)
    } else {
      params.push(c.scopeType)
      const a = params.length
      params.push(c.scopeId)
      const b = params.length
      clauses.push(`(scope_type = $${a} and scope_id = $${b})`)
    }
  }
  return clauses.join(' or ')
}

interface ChunkRow {
  id: string
  source_type: string
  content: string
  tier: number
  scope_type: string
  event_time: string | null
  embedding: string | null
}

interface MemoryRow {
  id: string
  kind: string
  title: string
  body: string
  scope_type: string
  pinned: boolean
  enforcement: string
  priority: number
  valid_from: string | null
  embedding: string | null
}

/** Normalized candidate carried through fusion → authority → output. */
interface MetaItem {
  id: string
  kind: 'memory' | 'chunk'
  sourceType?: string
  title: string
  snippet: string
  tier: AuthorityTier
  scopeType: string
  eventTime?: string
  priority: number
  embedding?: number[]
}

function chunkMeta(r: ChunkRow): MetaItem {
  const firstLine = r.content.split('\n')[0] ?? r.content
  return {
    id: r.id,
    kind: 'chunk',
    sourceType: r.source_type,
    title: sanitizeForFence(firstLine),
    snippet: sanitizeForFence(r.content),
    tier: resolveTier({ kind: 'chunk', sourceType: r.source_type }),
    scopeType: r.scope_type,
    eventTime: r.event_time ?? undefined,
    priority: 0,
    embedding: parseVector(r.embedding),
  }
}

function memoryMeta(r: MemoryRow): MetaItem {
  return {
    id: r.id,
    kind: 'memory',
    title: sanitizeForFence(r.title),
    snippet: sanitizeForFence(r.body),
    tier: resolveTier({ kind: 'memory', memKind: r.kind, pinned: r.pinned, enforcement: r.enforcement }),
    scopeType: r.scope_type,
    eventTime: r.valid_from ?? undefined,
    priority: r.priority ?? 0,
    embedding: parseVector(r.embedding),
  }
}

/**
 * Unified recall over memories + knowledge_chunks: kNN(chunks)∪kNN(memories)∪
 * FTS(chunks)∪FTS(memories) → RRF → tier-weighted authority order → annotate →
 * token budget. Always tenant + scope-cascade + `status='active'` scoped. Never
 * throws on an embed outage (degrades to FTS-only). On holdout, memory lanes are
 * skipped entirely.
 */
export async function searchKnowledge(sql: Sql, ctx: SearchKnowledgeCtx): Promise<KnowledgeItem[]> {
  const { tenantId, query, k, holdout, embed } = ctx
  const cascade = buildScopeCascade(ctx.scope)
  const perLane = Math.max(k * 4, 20)

  // 1. Embed the query. A provider outage must never strand the agent → FTS-only mode.
  let vecLiteral: string | null = null
  try {
    const { vectors } = await embed([query])
    const vec = vectors[0]
    if (vec && vec.length > 0) vecLiteral = toVectorLiteral(vec)
  } catch {
    vecLiteral = null
  }

  const meta = new Map<string, MetaItem>()
  const lists: Ranked[][] = []
  const collect = (rows: MetaItem[]) => {
    for (const m of rows) if (!meta.has(m.id)) meta.set(m.id, m)
    lists.push(rows.map((m, rank) => ({ id: m.id, rank })))
  }

  // 2a. kNN chunks (only when the query embedded).
  if (vecLiteral) {
    const params: unknown[] = [tenantId]
    const sc = scopeClause(cascade, params)
    params.push(vecLiteral)
    const q = params.length
    const text = `
      select id, source_type, content, tier, scope_type, event_time, embedding::text as embedding
      from "knowledge_chunks"
      where tenant_id = $1 and status = 'active' and (${sc})
      order by embedding <=> $${q}::halfvec
      limit ${perLane}
    `
    collect((await runQuery<ChunkRow>(sql, text, params)).map(chunkMeta))
  }

  // 2b. kNN memories (skipped on holdout).
  if (vecLiteral && !holdout) {
    const params: unknown[] = [tenantId]
    const sc = scopeClause(cascade, params)
    params.push(vecLiteral)
    const q = params.length
    const text = `
      select id, kind, title, body, scope_type, pinned, enforcement, priority, valid_from, embedding::text as embedding
      from "memories"
      where tenant_id = $1 and status = 'active' and embedding is not null and (${sc})
      order by embedding <=> $${q}::halfvec
      limit ${perLane}
    `
    collect((await runQuery<MemoryRow>(sql, text, params)).map(memoryMeta))
  }

  // 3a. FTS chunks.
  {
    const params: unknown[] = [tenantId, query]
    const sc = scopeClause(cascade, params)
    const text = `
      select id, source_type, content, tier, scope_type, event_time, embedding::text as embedding
      from "knowledge_chunks"
      where tenant_id = $1 and status = 'active' and (${sc})
        and fts @@ plainto_tsquery('english', $2)
      order by ts_rank(fts, plainto_tsquery('english', $2)) desc, created_at desc
      limit ${perLane}
    `
    collect((await runQuery<ChunkRow>(sql, text, params)).map(chunkMeta))
  }

  // 3b. FTS memories (skipped on holdout).
  if (!holdout) {
    const params: unknown[] = [tenantId, query]
    const sc = scopeClause(cascade, params)
    const text = `
      select id, kind, title, body, scope_type, pinned, enforcement, priority, valid_from, embedding::text as embedding
      from "memories"
      where tenant_id = $1 and status = 'active' and (${sc})
        and fts @@ plainto_tsquery('english', $2)
      order by ts_rank(fts, plainto_tsquery('english', $2)) desc, created_at desc
      limit ${perLane}
    `
    collect((await runQuery<MemoryRow>(sql, text, params)).map(memoryMeta))
  }

  // 4. RRF fuse the (up to 4) ranked lists.
  const fused = rrfFuse(lists.filter((l) => l.length > 0))

  // 5. Authority: tier-weight the fused score + annotate conflicts (needs embeddings,
  //    which every lane SELECTed as `embedding::text`). annotateByAuthority is used
  //    only for its annotation side-effect; we keep the relevance ordering below.
  const annotatable: (AnnotatableItem & { id: string })[] = fused.map((f) => {
    const m = meta.get(f.id)!
    return {
      id: m.id,
      title: m.title,
      tier: m.tier,
      scopeType: m.scopeType,
      eventTime: m.eventTime,
      priority: m.priority,
      embedding: m.embedding,
    }
  })
  const annotations = new Map<string, string>()
  for (const a of annotateByAuthority(annotatable)) {
    if (a.annotation) annotations.set(a.id, a.annotation)
  }

  interface Scored extends MetaItem {
    weighted: number
  }
  const scored: Scored[] = fused.map((f) => {
    const m = meta.get(f.id)!
    return { ...m, weighted: f.score * tierWeight(m.tier) }
  })
  scored.sort((a, b) => {
    if (b.weighted !== a.weighted) return b.weighted - a.weighted
    const c = compareByAuthority(a, b)
    if (c !== 0) return c
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  // 6. Token budget + return. At most `k` items, trimmed to the budget.
  const out: KnowledgeItem[] = []
  let used = 0
  for (const s of scored) {
    if (out.length >= k) break
    const cost = estimateTokens(`${s.title} ${s.snippet}`)
    if (out.length > 0 && used + cost > DEFAULT_KNOWLEDGE_TOKEN_BUDGET) break
    used += cost
    out.push({
      id: s.id,
      kind: s.kind,
      sourceType: s.sourceType,
      title: s.title,
      snippet: s.snippet || undefined,
      tier: s.tier,
      score: s.weighted,
      scope: s.scopeType,
      annotation: annotations.get(s.id),
    })
  }
  return out
}

/** One KB attribution row: the item's `kind` selects which XOR FK is set. */
export interface KnowledgeAttributionEntry {
  kind: 'memory' | 'chunk'
  /** The item id — bound to `memory_id` (kind='memory') XOR `chunk_id` (kind='chunk'). */
  id: string
  rank: number | null
  score: number | null
}

/**
 * Write ONE `run_knowledge_attributions` row per returned knowledge item — the P3a
 * KB moat rail (the analogue of `run_memory_attributions`'s {@link insertAttributions}).
 * A single multi-row insert (bound params only), anchored to the run's org. `kind`
 * selects the exactly-one FK: a 'memory' item sets `memory_id` (chunk_id null), a
 * 'chunk' sets `chunk_id` (memory_id null) — always honouring the `rka_exactly_one`
 * CHECK (never both, never neither). `suppressed` is the holdout counterfactual.
 * No ON CONFLICT: the table carries no unique key, and the caller logs the ACTUAL
 * returned set exactly once per retrieval, so there is nothing to dedup. A no-op when
 * nothing was returned.
 */
export async function insertKnowledgeAttributions(
  sql: Sql,
  ctx: { runId: string; tenantId: string; suppressed?: boolean },
  entries: KnowledgeAttributionEntry[],
): Promise<void> {
  if (entries.length === 0) return
  const params: unknown[] = []
  const tuples: string[] = []
  for (const e of entries) {
    const base = params.length
    // XOR: exactly one FK is non-null, chosen by kind — the CHECK's whole point.
    const memoryId = e.kind === 'memory' ? e.id : null
    const chunkId = e.kind === 'chunk' ? e.id : null
    params.push(
      ctx.runId,
      ctx.tenantId,
      memoryId,
      chunkId,
      e.kind,
      e.rank ?? null,
      e.score ?? null,
      ctx.suppressed ?? false,
    )
    tuples.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`,
    )
  }
  const text = `
    insert into "run_knowledge_attributions"
      ("run_id", "tenant_id", "memory_id", "chunk_id", "kind", "rank", "score", "suppressed")
    values ${tuples.join(', ')}
  `
  await runQuery(sql, text, params)
}
