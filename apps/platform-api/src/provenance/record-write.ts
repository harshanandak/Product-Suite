import type { Sql } from '@product-suite/db'

/**
 * The single provenance-stamping write path (see
 * docs/design/2026-07-12-actor-provenance-design.md §3.3).
 *
 * `recordWrite` OWNS the `actor_*` columns: it derives them from the verified
 * request context, refuses any caller-supplied provenance, and appends them to
 * every insert. It also allowlists the insertable columns per table, so a caller
 * can neither spoof who-wrote-it nor inject arbitrary columns through the generic
 * helper. This is the uniformity mechanism — provenance is impossible to forget
 * because writes go through here.
 *
 * Neon's HTTP driver batches transactions (no interactive/read-then-write in one
 * txn), so this helper is a single parameterized INSERT that server-derives the
 * actor from `ctx` — it never reads request state mid-transaction. The neon `sql`
 * client is called in its ordinary (non-tagged) form — `sql(text, params)` — for
 * the dynamically-built column list; every VALUE is a bound `$n` parameter.
 */

/** The four provenance columns — stamped here, NEVER accepted from a caller. */
export const PROVENANCE_COLUMNS = ['actor_type', 'actor_id', 'on_behalf_of', 'run_id'] as const

/**
 * Who is performing a write, derived on the SERVER from the verified request
 * (a human from `callerUserId`, or an agent from a verified run token). Route
 * code builds this from request context — it is never read from the request body.
 */
export type ActorContext =
  | { actorType: 'human'; actorId: string; onBehalfOf?: null; runId?: null }
  | { actorType: 'agent'; actorId: string; onBehalfOf: string; runId: string }
  | { actorType: 'system'; actorId: string; onBehalfOf?: null; runId?: null }
  | { actorType: 'import'; actorId: string; onBehalfOf?: string | null; runId?: null }

/**
 * Registered write tables → their caller-insertable columns (the allowlist).
 * A table absent here cannot be written through `recordWrite`; a column absent
 * from a table's list is rejected. Provenance columns are appended by the helper
 * and must NOT appear here. Grows as routes convert (the fast-follow PR).
 */
const WRITE_TABLES: Record<string, readonly string[]> = {
  teams: ['tenant_id', 'name'],
}

/**
 * Insert `values` into `table`, stamping the provenance columns from `actor`.
 * Throws when the table is unregistered, a column is not allowlisted, or the
 * caller tried to set a provenance column — all programmer errors, surfaced
 * loudly rather than silently written.
 */
export async function recordWrite<Row = Record<string, unknown>>(
  sql: Sql,
  table: string,
  values: Record<string, unknown>,
  actor: ActorContext,
): Promise<Row> {
  const allowed = WRITE_TABLES[table]
  if (!allowed) {
    throw new Error(`recordWrite: "${table}" is not a registered write table`)
  }

  // Actor is server-derived: reject any caller-supplied provenance outright.
  for (const col of PROVENANCE_COLUMNS) {
    if (col in values) {
      throw new Error(`recordWrite: caller may not set provenance column "${col}"`)
    }
  }

  // No arbitrary column injection: every value column must be allowlisted.
  const cols = Object.keys(values)
  for (const col of cols) {
    if (!allowed.includes(col)) {
      throw new Error(`recordWrite: "${col}" is not an insertable column on "${table}"`)
    }
  }

  const actorColumns: Record<string, unknown> = {
    actor_type: actor.actorType,
    actor_id: actor.actorId,
    on_behalf_of: actor.onBehalfOf ?? null,
    run_id: actor.runId ?? null,
  }

  const allColumns = [...cols, ...Object.keys(actorColumns)]
  const allValues = [...cols.map((c) => values[c]), ...Object.values(actorColumns)]
  // Identifiers come only from the allowlist above (never from request data), so
  // they are safe to interpolate; every VALUE is a bound parameter.
  const columnList = allColumns.map((c) => `"${c}"`).join(', ')
  const placeholders = allColumns.map((_, i) => `$${i + 1}`).join(', ')
  const text = `insert into "${table}" (${columnList}) values (${placeholders}) returning *`

  // Ordinary (non-tagged) neon call: a query string with $n placeholders + params.
  const rows = (await (sql as unknown as (q: string, p: unknown[]) => Promise<Row[]>)(
    text,
    allValues,
  )) as Row[]
  const row = rows[0]
  if (!row) {
    throw new Error(`recordWrite: insert into "${table}" returned no row`)
  }
  return row
}
