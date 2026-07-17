import type { Sql } from '@product-suite/db'

import { resolveTier } from './authority'

/**
 * KB ingestion (Memory Brain P3a §4B). Two idempotent passes, both driven by an
 * INJECTED `embed` (Task 3's `embed(texts, env)` partially applied to the request
 * env) so tests never touch the network:
 *
 *   1. Backfill: embed active `memories` that lack an `embedding` and stamp
 *      `embed_model`. The `embedding`/`halfvec` column is raw-SQL only (omitted from
 *      the Drizzle table) — the vector is bound as a Postgres vector literal string
 *      `'[v1,v2,...]'` and cast `::halfvec`.
 *   2. Work-item chunks: one chunk per COMPLETED, non-archived work item (join
 *      `statuses.category='completed'`), scoped to its PROJECT (org when it has no
 *      project — NEVER `work_item` scope, or cross-item recall could never fire),
 *      with `event_time` = the item's latest activity, falling back to `updated_at`.
 *      Inserted with `on conflict (tenant_id, source_type, source_ref, content_hash)
 *      do nothing` so a re-ingest of unchanged items is a no-op; a content change
 *      yields a new hash → a new chunk.
 */

/** The injected embed function — Task 3's `embed` with its `env` already bound. */
export type EmbedFn = (texts: string[]) => Promise<{ vectors: number[][]; model: string; dims: number }>

export interface IngestKnowledgeCtx {
  tenantId: string
  embed: EmbedFn
}

export interface IngestKnowledgeResult {
  memoriesEmbedded: number
  chunksIngested: number
}

/** Fixed KB vector dimensionality (see embeddings.ts / migration 0013). */
const EMBED_DIMS = 1024

/** Raw parameterized query helper — mirrors `memory-retrieval.ts` (Neon HTTP, bound params only). */
function runQuery<Row>(sql: Sql, text: string, params: unknown[]): Promise<Row[]> {
  return (sql as unknown as { query: (q: string, p: unknown[]) => Promise<Row[]> }).query(text, params)
}

/** Format a JS `number[]` as a pgvector/`halfvec` literal `'[v1,v2,...]'` for a `$n::halfvec` bind. */
function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`
}

/** Stable content hash (sha256 hex) for the dedup unique index. Web Crypto → works on Workers + Node. */
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

interface MemoryBackfillRow {
  id: string
  title: string
  body: string
}

interface CompletedItemRow {
  id: string
  title: string
  description: string
  project_id: string | null
  updated_at: string
  event_time: string | null
}

/**
 * Run both ingestion passes for one tenant. `embed` is injected so the pure
 * data-flow is testable without a network. Returns the counts actually written.
 */
export async function ingestKnowledge(sql: Sql, ctx: IngestKnowledgeCtx): Promise<IngestKnowledgeResult> {
  const { tenantId, embed } = ctx

  const memoriesEmbedded = await backfillMemoryEmbeddings(sql, tenantId, embed)
  const chunksIngested = await ingestCompletedWorkItems(sql, tenantId, embed)

  return { memoriesEmbedded, chunksIngested }
}

/** Embed active memories that have no embedding yet and stamp `embed_model`. */
async function backfillMemoryEmbeddings(sql: Sql, tenantId: string, embed: EmbedFn): Promise<number> {
  const rows = await runQuery<MemoryBackfillRow>(
    sql,
    `select id, title, body from memories
     where tenant_id = $1 and status = 'active' and embedding is null`,
    [tenantId],
  )
  if (rows.length === 0) return 0

  const texts = rows.map((r) => `${r.title}\n${r.body}`)
  const { vectors, model } = await embed(texts)

  for (let i = 0; i < rows.length; i++) {
    await runQuery(
      sql,
      `update memories set embedding = $1::halfvec, embed_model = $2 where id = $3`,
      [toVectorLiteral(vectors[i] ?? []), model, rows[i]!.id],
    )
  }
  return rows.length
}

/** Ingest each completed, non-archived work item as one project-scoped chunk. */
async function ingestCompletedWorkItems(sql: Sql, tenantId: string, embed: EmbedFn): Promise<number> {
  const rows = await runQuery<CompletedItemRow>(
    sql,
    `select wi.id, wi.title, wi.description, wi.project_id, wi.updated_at,
       (select max(ae.created_at) from activity_events ae where ae.work_item_id = wi.id) as event_time
     from work_items wi
     join statuses s on wi.status_id = s.id
     where wi.tenant_id = $1 and s.category = 'completed' and wi.archived = false`,
    [tenantId],
  )
  if (rows.length === 0) return 0

  const contents = rows.map((r) => `${r.title}\n${r.description}`)
  const { vectors, model } = await embed(contents)
  const tier = resolveTier({ kind: 'chunk', sourceType: 'work_item' })

  let inserted = 0
  for (let i = 0; i < rows.length; i++) {
    const item = rows[i]!
    const content = contents[i]!
    const contentHash = await sha256Hex(content)
    const scopeType = item.project_id != null ? 'project' : 'org'
    const scopeId = item.project_id ?? null
    const eventTime = item.event_time ?? item.updated_at

    const out = await runQuery<{ id: string }>(
      sql,
      `insert into knowledge_chunks
         (tenant_id, source_type, source_ref, chunk_index, content, content_hash,
          embedding, tier, scope_type, scope_id, event_time,
          embed_provider, embed_model, embed_dims, status)
       values ($1, 'work_item', $2, 0, $3, $4, $5::halfvec, $6, $7, $8, $9, 'openrouter', $10, $11, 'active')
       on conflict (tenant_id, source_type, source_ref, content_hash) do nothing
       returning id`,
      [tenantId, item.id, content, contentHash, toVectorLiteral(vectors[i] ?? []), tier, scopeType, scopeId, eventTime, model, EMBED_DIMS],
    )
    if (out.length > 0) inserted++
  }
  return inserted
}
