import type { Sql } from '@product-suite/db'

/**
 * A compact, ranked search hit — the ONLY shape retrieval hands to the model.
 * Retrieval-first (design §6/§7): the agent gets id/title/status/priority/team,
 * never raw rows or descriptions, so a search can't flood the context window.
 */
export interface ItemHit {
  id: string
  title: string
  status_id: string
  priority: string
  team_id: string
}

/** The tenancy anchor for retrieval — the org ids the caller may read across. */
export interface RetrieveContext {
  tenantIds: string[]
}

function runQuery<Row>(sql: Sql, text: string, params: unknown[]): Promise<Row[]> {
  return (sql as unknown as { query: (q: string, p: unknown[]) => Promise<Row[]> }).query(text, params)
}

/**
 * The retrieval seam behind `search_items`. v1 is a tenant-scoped ILIKE match with
 * a deterministic ranking (title matches ahead of description-only matches); it is
 * intentionally a single function so a future BM25 / Postgres FTS implementation
 * drops in without touching the tool or the runtime.
 *
 * Security: results are always scoped to `ctx.tenantIds` (bound as an array param),
 * so a search can never surface another org's work. An empty tenant set is DENY
 * (returns `[]`), never "all". A blank query is a no-op (never a raw dump).
 */
export async function retrieve(
  sql: Sql,
  ctx: RetrieveContext,
  query: string,
  limit = 8,
): Promise<ItemHit[]> {
  if (ctx.tenantIds.length === 0) return []
  const term = query.trim()
  if (!term) return []

  const like = `%${term}%`
  const text = `
    select id, title, status_id, priority, team_id
    from work_items
    where tenant_id = any($1)
      and archived = false
      and (title ilike $2 or description ilike $2)
    order by (case when title ilike $2 then 0 else 1 end), title
    limit $3
  `
  const rows = await runQuery<ItemHit>(sql, text, [ctx.tenantIds, like, limit])
  // Re-project defensively so nothing beyond the five compact fields ever escapes,
  // even if the SELECT is later widened.
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status_id: r.status_id,
    priority: r.priority,
    team_id: r.team_id,
  }))
}
