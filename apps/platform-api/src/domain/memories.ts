import type { Sql } from '@product-suite/db'

import { DomainError } from './errors'

/**
 * The Memory Brain P1 domain — the single validated write path for the semantic
 * decision/knowledge store (see docs/design/2026-07-15-memory-brain-p1.md). Mirrors
 * `work-items.ts`: tenant-scoped, `DomainError` on any invariant violation, a foreign
 * id indistinguishable from unknown (⇒ `not_found`, never a cross-tenant leak).
 *
 * Supersession is APPEND-ONLY: `supersedeMemory` inserts a NEW version row (carrying
 * `supersedes_id` + the old `root_id`) and latches the old row
 * (`status='superseded'`, `superseded_by_id=<new>`) in ONE atomic Neon batch — it
 * never overwrites. `retract`/`defer` keep the row (history is never destroyed).
 *
 * These use the `sql.query(text, params)` form (neon v1.x) so every value is a bound
 * param and the SQL text is matchable by the route/domain test harness.
 */

/** A memory row (snake_case DB columns, matching migration 0010). */
export interface MemoryRow {
  id: string
  tenant_id: string
  kind: 'decision' | 'fact' | 'rule'
  title: string
  body: string
  attrs: unknown
  root_id: string
  supersedes_id: string | null
  superseded_by_id: string | null
  change_reason: string | null
  valid_from: string | Date
  status: 'active' | 'superseded' | 'retracted' | 'deferred'
  waiting_on: string | null
  review_after: string | Date | null
  scope_type: 'org' | 'project' | 'work_item_type' | 'work_item'
  scope_id: string | null
  topics: string[] | null
  source_kind: 'meeting' | 'chat' | 'proposal' | 'manual' | 'import'
  source_run_id: string | null
  source_proposal_id: string | null
  source_quote: string | null
  created_by: string | null
  decided_by: string | null
  pinned: boolean
  priority: number
  enforcement: 'advisory' | 'hard'
  created_at: string | Date
  updated_at: string | Date
}

function runQuery<Row>(sql: Sql, text: string, params: unknown[]): Promise<Row[]> {
  return (sql as unknown as { query: (q: string, p: unknown[]) => Promise<Row[]> }).query(text, params)
}

/** Run several statements as ONE atomic Neon batch (`sql.transaction`). */
async function runTx<Row>(
  sql: Sql,
  build: { text: string; params: unknown[] }[],
): Promise<Row[][]> {
  const queries = build.map((q) =>
    (sql as unknown as { query: (t: string, p: unknown[]) => unknown }).query(q.text, q.params),
  )
  return (await (sql as unknown as { transaction: (q: unknown[]) => Promise<Row[][]> }).transaction(
    queries,
  )) as Row[][]
}

/** The full projection returned on every write — the whole row. */
const RETURNING = '*'

/** Fields a human (or agent, P1b) may set when logging a new memory. */
export interface CreateMemoryInput {
  kind: 'decision' | 'fact' | 'rule'
  title: string
  body?: string
  attrs?: unknown
  scopeType?: 'org' | 'project' | 'work_item_type' | 'work_item'
  scopeId?: string | null
  topics?: string[]
  sourceKind?: 'meeting' | 'chat' | 'proposal' | 'manual' | 'import'
  sourceRunId?: string | null
  sourceProposalId?: string | null
  sourceQuote?: string | null
  decidedBy?: string | null
}

/**
 * Log a new memory in ONE org, active immediately (the capture-friction keystone —
 * no self-review). `root_id` is the row's own id (a brand-new chain head); status is
 * `active`; `created_by` is the server-derived actor. A `title` is required. Anchors
 * to the resolved `tenantId`; the id is generated client-side so nothing is trusted.
 */
export async function createMemory(
  sql: Sql,
  ctx: { tenantId: string; actor: string },
  input: CreateMemoryInput,
): Promise<MemoryRow> {
  const title = (input.title ?? '').trim()
  if (!title) throw new DomainError('invalid_input', 'title is required')
  const id = crypto.randomUUID()
  const scopeType = input.scopeType ?? 'org'
  // A non-org scope needs a target id; org scope must not carry one.
  const scopeId = scopeType === 'org' ? null : (input.scopeId ?? null)
  const text = `
    insert into "memories" (
      "id", "tenant_id", "kind", "title", "body", "attrs", "root_id",
      "status", "scope_type", "scope_id", "topics", "source_kind",
      "source_run_id", "source_proposal_id", "source_quote", "created_by", "decided_by"
    ) values (
      $1, $2, $3, $4, $5, $6::jsonb, $1,
      'active', $7, $8, $9, $10,
      $11, $12, $13, $14, $15
    ) returning ${RETURNING}
  `
  const params = [
    id,
    ctx.tenantId,
    input.kind,
    title,
    input.body ?? '',
    input.attrs === undefined ? null : JSON.stringify(input.attrs),
    scopeType,
    scopeId,
    input.topics ?? [],
    input.sourceKind ?? 'manual',
    input.sourceRunId ?? null,
    input.sourceProposalId ?? null,
    input.sourceQuote ?? null,
    ctx.actor,
    input.decidedBy ?? null,
  ]
  const rows = await runQuery<MemoryRow>(sql, text, params)
  const row = rows[0]
  if (!row) throw new DomainError('not_found', 'insert returned no row')
  return row
}

/** Fetch one memory scoped to the caller's tenants (null when not theirs). */
export async function getMemoryScoped(
  sql: Sql,
  id: string,
  tenantIds: string[],
): Promise<MemoryRow | null> {
  const rows = await runQuery<MemoryRow>(
    sql,
    `select * from "memories" where id = $1 and tenant_id = any($2) limit 1`,
    [id, tenantIds],
  )
  return rows[0] ?? null
}

/**
 * The whole supersession chain for a memory's `root_id`, oldest first — the "why did
 * this flip?" trail. Scoped to the caller's tenants (empty when the root is foreign).
 */
export async function getMemoryChain(
  sql: Sql,
  rootId: string,
  tenantIds: string[],
): Promise<MemoryRow[]> {
  return runQuery<MemoryRow>(
    sql,
    `select * from "memories" where root_id = $1 and tenant_id = any($2) order by valid_from asc, created_at asc`,
    [rootId, tenantIds],
  )
}

/** Filters accepted by the Decision Log / Topic list. */
export interface ListMemoriesFilter {
  kind?: 'decision' | 'fact' | 'rule'
  status?: 'active' | 'superseded' | 'retracted' | 'deferred'
  topic?: string
  scopeType?: 'org' | 'project' | 'work_item_type' | 'work_item'
  scopeId?: string
  q?: string
}

/** Max memories returned to a list view — bounds the payload. */
export const MEMORY_LIST_LIMIT = 200

/**
 * List an org's memories, newest first, with optional filters (kind/status/topic/
 * scope/FTS `q`). Scoped to the caller's tenants — another org's memory is invisible.
 * `q` runs against the generated `fts` tsvector; `topic` matches the `topics` array.
 */
export async function listMemories(
  sql: Sql,
  tenantIds: string[],
  filter: ListMemoriesFilter = {},
): Promise<MemoryRow[]> {
  const params: unknown[] = [tenantIds]
  let where = 'tenant_id = any($1)'
  if (filter.kind) {
    params.push(filter.kind)
    where += ` and kind = $${params.length}`
  }
  if (filter.status) {
    params.push(filter.status)
    where += ` and status = $${params.length}`
  }
  if (filter.scopeType) {
    params.push(filter.scopeType)
    where += ` and scope_type = $${params.length}`
  }
  if (filter.scopeId) {
    params.push(filter.scopeId)
    where += ` and scope_id = $${params.length}`
  }
  if (filter.topic) {
    params.push(filter.topic)
    where += ` and $${params.length} = any(topics)`
  }
  if (filter.q) {
    params.push(filter.q)
    where += ` and fts @@ plainto_tsquery('english', $${params.length})`
  }
  const text = `
    select * from "memories"
    where ${where}
    order by created_at desc
    limit ${MEMORY_LIST_LIMIT}
  `
  return runQuery<MemoryRow>(sql, text, params)
}

/** Fields a supersede may override; unspecified ones are inherited from the old version. */
export interface SupersedeMemoryInput {
  title?: string
  body?: string
  topics?: string[]
  changeReason: string
}

/**
 * Supersede a memory: insert a NEW active version (inheriting the old row's kind/
 * scope/topics unless overridden, carrying `supersedes_id=<old>` + the old
 * `root_id`), and latch the old row (`status='superseded'`, `superseded_by_id=<new>`)
 * — as ONE atomic batch. `change_reason` is MANDATORY. Both statements are guarded on
 * the old row being `active`, so a concurrent supersede makes BOTH no-op (no orphan
 * new version); an existing-but-inactive target ⇒ `conflict`, a foreign/unknown id ⇒
 * `not_found`. Append-only: the old version is never overwritten.
 */
export async function supersedeMemory(
  sql: Sql,
  ctx: { tenantIds: string[]; actor: string },
  id: string,
  input: SupersedeMemoryInput,
): Promise<MemoryRow> {
  const changeReason = (input.changeReason ?? '').trim()
  if (!changeReason) {
    throw new DomainError('change_reason_required', 'change_reason is required to supersede a memory')
  }
  // Ownership first: a foreign/unknown id is not_found (never a cross-tenant leak).
  const existing = await getMemoryScoped(sql, id, ctx.tenantIds)
  if (!existing) throw new DomainError('not_found', 'Not found')

  const newId = crypto.randomUUID()
  // The new version copies the old row's fields via INSERT…SELECT (so it inherits
  // kind/scope/attrs/etc), overriding title/body/topics/change_reason and stamping
  // the chain pointers. Guarded on the old row still being `active`.
  const insert = {
    text: `
      insert into "memories" (
        "id", "tenant_id", "kind", "title", "body", "attrs", "root_id",
        "supersedes_id", "change_reason", "valid_from", "status",
        "scope_type", "scope_id", "topics", "source_kind", "created_by", "decided_by",
        "pinned", "priority", "enforcement"
      )
      select
        $1, "tenant_id", "kind", coalesce($2, "title"), coalesce($3, "body"), "attrs", "root_id",
        "id", $4, now(), 'active',
        "scope_type", "scope_id", coalesce($5, "topics"), 'manual', $6, "decided_by",
        "pinned", "priority", "enforcement"
      from "memories"
      where "id" = $7 and "tenant_id" = any($8) and "status" = 'active'
      returning *
    `,
    params: [
      newId,
      input.title ?? null,
      input.body ?? null,
      changeReason,
      input.topics ?? null,
      ctx.actor,
      id,
      ctx.tenantIds,
    ],
  }
  const latch = {
    text: `
      update "memories"
      set "superseded_by_id" = $1, "status" = 'superseded', "updated_at" = now()
      where "id" = $2 and "tenant_id" = any($3) and "status" = 'active'
      returning "id"
    `,
    params: [newId, id, ctx.tenantIds],
  }
  const [insertedRows] = await runTx<MemoryRow>(sql, [insert, latch])
  const inserted = insertedRows?.[0]
  if (!inserted) {
    // The row exists (fetched above) but was not `active` — a concurrent supersede/
    // retract won the race. Atomic batch means the latch also no-op'd (no orphan).
    throw new DomainError('conflict', 'memory is no longer active; reload and retry')
  }
  return inserted
}

/**
 * Retract a memory (a mis-record correction) — status→`retracted`, the ROW IS KEPT
 * (history is never destroyed). Scoped to the caller's tenants; a foreign/unknown id
 * ⇒ `not_found`. Only an `active`/`deferred` memory can be retracted.
 */
export async function retractMemory(
  sql: Sql,
  ctx: { tenantIds: string[]; actor: string },
  id: string,
): Promise<MemoryRow> {
  const existing = await getMemoryScoped(sql, id, ctx.tenantIds)
  if (!existing) throw new DomainError('not_found', 'Not found')
  const rows = await runQuery<MemoryRow>(
    sql,
    `update "memories" set "status" = 'retracted', "updated_at" = now()
     where "id" = $1 and "tenant_id" = any($2) and "status" in ('active', 'deferred')
     returning *`,
    [id, ctx.tenantIds],
  )
  const row = rows[0]
  if (!row) throw new DomainError('conflict', 'memory cannot be retracted from its current status')
  return row
}

/** Fields a defer sets. `waitingOn`/`reviewAfter` are optional context on the pause. */
export interface DeferMemoryInput {
  waitingOn?: string | null
  reviewAfter?: string | Date | null
}

/**
 * Defer a memory (park it) — status→`deferred` + `waiting_on`/`review_after`, the
 * ROW IS KEPT. Scoped to the caller's tenants; foreign/unknown id ⇒ `not_found`. Only
 * an `active` memory can be deferred.
 */
export async function deferMemory(
  sql: Sql,
  ctx: { tenantIds: string[]; actor: string },
  id: string,
  input: DeferMemoryInput = {},
): Promise<MemoryRow> {
  const existing = await getMemoryScoped(sql, id, ctx.tenantIds)
  if (!existing) throw new DomainError('not_found', 'Not found')
  const rows = await runQuery<MemoryRow>(
    sql,
    `update "memories"
     set "status" = 'deferred', "waiting_on" = $3, "review_after" = $4, "updated_at" = now()
     where "id" = $1 and "tenant_id" = any($2) and "status" = 'active'
     returning *`,
    [id, ctx.tenantIds, input.waitingOn ?? null, input.reviewAfter ?? null],
  )
  const row = rows[0]
  if (!row) throw new DomainError('conflict', 'only an active memory can be deferred')
  return row
}
