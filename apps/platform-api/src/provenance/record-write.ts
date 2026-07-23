import type { Sql } from '@product-suite/db'

/**
 * The provenance write layer (see docs/design/2026-07-12-actor-provenance-design.md
 * §3.3–§3.4). Two tiers, both sourcing the actor ONLY from the server-derived
 * request context — a caller can never spoof who-wrote-it:
 *
 *  - Tier 1 — the generic builder for boring writes. `buildWrite` owns the column
 *    allowlist + actor stamping; `recordWrite` runs one statement, `recordWriteTx`
 *    runs an atomic Neon batch for unconditional multi-writes.
 *  - Tier 2 — the escape hatch for irreducible writes (custom WHERE / conditional
 *    logic, e.g. work_items UPDATE's recursive-CTE cycle guard). Those keep their
 *    own tagged-template SQL and stamp the same columns inline from
 *    `actorAssignments(actor)`.
 *
 * Neon's HTTP driver batches transactions (non-interactive: no statement reads a
 * prior statement's output), so multi-writes generate ids client-side; parameterized
 * statements use the `sql.query(text, params)` form (neon v1.x).
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
  | { actorType: 'system'; actorId: string; onBehalfOf?: null; runId?: string | null }
  | { actorType: 'import'; actorId: string; onBehalfOf?: string | null; runId?: null }

/** The provenance values as a plain object, for a Tier-2 route to interpolate. */
export interface ActorAssignments {
  actorType: ActorContext['actorType']
  actorId: string
  onBehalfOf: string | null
  runId: string | null
}

/**
 * Validate the ActorContext invariants and return the four provenance values as a
 * plain object. Shared by both tiers: the generic builder maps these onto the
 * `actor_*` columns, and a Tier-2 route interpolates them into its own statement
 * as ordinary `${}` params. Design §1: an agent write is NEVER anonymous.
 */
export function actorAssignments(actor: ActorContext): ActorAssignments {
  if (!actor.actorId) {
    throw new Error('recordWrite: actor_id is required (no anonymous writes)')
  }
  if (actor.actorType === 'agent' && (!actor.onBehalfOf || !actor.runId)) {
    throw new Error('recordWrite: an agent write requires on_behalf_of and run_id')
  }
  return {
    actorType: actor.actorType,
    actorId: actor.actorId,
    onBehalfOf: actor.onBehalfOf ?? null,
    runId: actor.runId ?? null,
  }
}

/**
 * Registered write tables. `insert` is the caller-insertable column allowlist
 * (includes `id` where a route generates it client-side for a batched pair).
 * `update.set` is the updatable column allowlist (never includes `id`), and
 * `update.match` is the REQUIRED-and-complete predicate key set (every listed key
 * must be present; `tenant_id` is included wherever the table has it). Provenance
 * columns are appended by the builder and must NOT appear here. Grows as routes
 * convert (the fast-follow).
 */
const WRITE_TABLES: Record<
  string,
  { insert?: readonly string[]; update?: { set: readonly string[]; match: readonly string[] } }
> = {
  teams: {
    insert: ['tenant_id', 'name'],
    update: { set: ['name'], match: ['id', 'tenant_id'] },
  },
  projects: {
    insert: ['tenant_id', 'name', 'kind', 'status', 'lead_id', 'target_date'],
  },
  checks: {
    insert: ['work_item_id', 'title', 'status', 'due_date'],
  },
  statuses: {
    insert: ['team_id', 'name', 'category', 'position'],
  },
  work_items: {
    insert: [
      'id',
      'tenant_id',
      'title',
      'description',
      'phase',
      'type',
      'priority',
      'tags',
      'source',
      'project_id',
      'team_id',
      'status_id',
      'parent_id',
      'depth',
      'department',
      'assignee_id',
      'due_date',
      'archived',
      'applied_from_proposal_id',
    ],
  },
  activity_events: {
    insert: ['id', 'work_item_id', 'kind', 'summary'],
  },
}

/** What a write wants to do: insert `values`, or update `values` where `match`. */
export interface WriteSpec {
  table: string
  operation: 'insert' | 'update'
  values: Record<string, unknown>
  /**
   * Required for `update`: the tenant-scoped predicate (e.g. `{ id, tenant_id }`).
   * A value may be an ARRAY to scope one UPDATE to several rows (`col = any($n)`),
   * except `tenant_id`, which must stay a single value.
   */
  match?: Record<string, unknown>
}

function rejectCallerProvenance(source: Record<string, unknown>): void {
  for (const col of PROVENANCE_COLUMNS) {
    if (col in source) {
      throw new Error(`recordWrite: caller may not set provenance column "${col}"`)
    }
  }
}

/**
 * Build a parameterized INSERT/UPDATE with the `actor_*` columns stamped from the
 * server-derived actor. PURE — no DB. Identifiers come only from the static
 * allowlist (never request data); every VALUE is a bound `$n` param.
 */
export function buildWrite(spec: WriteSpec, actor: ActorContext): { text: string; params: unknown[] } {
  const config = WRITE_TABLES[spec.table]
  if (!config) {
    throw new Error(`recordWrite: "${spec.table}" is not a registered write table`)
  }
  rejectCallerProvenance(spec.values)
  if (spec.match) rejectCallerProvenance(spec.match)

  const a = actorAssignments(actor)
  const actorColumns: Record<string, unknown> = {
    actor_type: a.actorType,
    actor_id: a.actorId,
    on_behalf_of: a.onBehalfOf,
    run_id: a.runId,
  }

  if (spec.operation === 'insert') {
    const allowed = config.insert
    if (!allowed) throw new Error(`recordWrite: insert is not supported on "${spec.table}"`)
    const cols = Object.keys(spec.values)
    for (const col of cols) {
      if (!allowed.includes(col)) {
        throw new Error(`recordWrite: "${col}" is not an insertable column on "${spec.table}"`)
      }
    }
    const allColumns = [...cols, ...Object.keys(actorColumns)]
    const params = [...cols.map((c) => spec.values[c]), ...Object.values(actorColumns)]
    const columnList = allColumns.map((c) => `"${c}"`).join(', ')
    const placeholders = allColumns.map((_, i) => `$${i + 1}`).join(', ')
    return {
      text: `insert into "${spec.table}" (${columnList}) values (${placeholders}) returning *`,
      params,
    }
  }

  // update
  const upd = config.update
  if (!upd) throw new Error(`recordWrite: update is not supported on "${spec.table}"`)
  const match = spec.match ?? {}
  // Required-and-complete: every registered match key must be present and set —
  // an allowlist alone could drop tenant scoping or compile an unqualified UPDATE.
  for (const key of upd.match) {
    if (match[key] === undefined || match[key] === null) {
      throw new Error(`recordWrite: update on "${spec.table}" requires match key "${key}"`)
    }
  }
  for (const key of Object.keys(match)) {
    if (!upd.match.includes(key)) {
      throw new Error(`recordWrite: "${key}" is not a match column on "${spec.table}"`)
    }
  }
  // A match value may be an ARRAY — compiled to `"col" = any($n)` with the array
  // bound as ONE param — so a caller can scope a single UPDATE to several rows.
  // This must NOT become a way around the required-and-complete check above:
  // `tenant_id` stays a single value (an array there would widen one statement
  // across tenants), and a degenerate array is rejected rather than silently
  // compiling a predicate that matches nothing.
  for (const key of upd.match) {
    const value = match[key]
    if (!Array.isArray(value)) continue
    if (key === 'tenant_id') {
      throw new Error(`recordWrite: match key "tenant_id" must be a single value on "${spec.table}"`)
    }
    if (value.length === 0) {
      throw new Error(`recordWrite: match key "${key}" may not be an empty array on "${spec.table}"`)
    }
    // Index-walked rather than `.some()`: `some` SKIPS sparse holes, so a value
    // like ['team_1', ,] would slip past a callback-based check and then bind a
    // NULL into the `any()` array — a predicate that silently matches nothing.
    // `!(i in value)` is what distinguishes a hole from a present undefined.
    for (let i = 0; i < value.length; i += 1) {
      if (!(i in value) || value[i] === undefined || value[i] === null) {
        throw new Error(
          `recordWrite: match key "${key}" may not contain a null element on "${spec.table}"`,
        )
      }
    }
  }
  const setCols = Object.keys(spec.values)
  for (const col of setCols) {
    if (!upd.set.includes(col)) {
      throw new Error(`recordWrite: "${col}" is not an updatable column on "${spec.table}"`)
    }
  }
  const assignColumns = [...setCols, ...Object.keys(actorColumns)]
  const assignValues = [...setCols.map((c) => spec.values[c]), ...Object.values(actorColumns)]
  let p = 0
  const setClause = assignColumns.map((c) => `"${c}" = $${++p}`).join(', ')
  const whereClause = upd.match
    .map((k) => (Array.isArray(match[k]) ? `"${k}" = any($${++p})` : `"${k}" = $${++p}`))
    .join(' and ')
  return {
    text: `update "${spec.table}" set ${setClause}, "updated_at" = now() where ${whereClause} returning *`,
    params: [...assignValues, ...upd.match.map((k) => match[k])],
  }
}

/**
 * Run a built statement and return its rows via neon's `sql.query(text, params)`
 * — the documented parameterized API in `@neondatabase/serverless@1.x`. (The
 * ordinary callable `sql(text, params)` form was REMOVED in v1.0; verified against
 * the installed 1.1.0 that `sql.query` returns a NeonQueryPromise and that its
 * results compose into `sql.transaction([...])`, which recordWriteTx relies on.
 * Route tagged-templates are unaffected by the v1 change.)
 */
function runQuery<Row>(sql: Sql, text: string, params: unknown[]): Promise<Row[]> {
  return (sql as unknown as { query: (q: string, p: unknown[]) => Promise<Row[]> }).query(text, params)
}

/**
 * Stamp + execute a single write, returning the affected row. Throws when the
 * table/column is not allowlisted, the caller tried to set a provenance column,
 * or (for a create) nothing was returned. For an update, a no-match returns
 * undefined-row → throws; routes that need to distinguish "not found" from a
 * guard block should build their own statement (Tier 2).
 */
export async function recordWrite<Row = Record<string, unknown>>(
  sql: Sql,
  spec: WriteSpec,
  actor: ActorContext,
): Promise<Row> {
  const { text, params } = buildWrite(spec, actor)
  const rows = await runQuery<Row>(sql, text, params)
  const row = rows[0]
  if (!row) {
    throw new Error(`recordWrite: ${spec.operation} on "${spec.table}" returned no row`)
  }
  return row
}

/**
 * Stamp + execute several writes as ONE atomic Neon batch (`sql.transaction`).
 * For UNCONDITIONAL multi-writes only — the batch is non-interactive, so no
 * statement may depend on another's output (generate shared ids client-side).
 * Returns the first row of each statement, in spec order.
 */
export async function recordWriteTx<Row = Record<string, unknown>>(
  sql: Sql,
  specs: WriteSpec[],
  actor: ActorContext,
): Promise<Row[]> {
  const queries = specs.map((spec) => {
    const { text, params } = buildWrite(spec, actor)
    return (sql as unknown as { query: (q: string, p: unknown[]) => unknown }).query(text, params)
  })
  const results = (await (sql as unknown as { transaction: (q: unknown[]) => Promise<Row[][]> }).transaction(
    queries,
  )) as Row[][]
  // One output row per input spec, IN ORDER. Every spec uses `returning *`, so a
  // missing row is a real failure — dropping it (rather than throwing) would shift
  // later rows into the wrong statement's position and hand a caller the wrong row.
  return results.map((rows, i) => {
    const row = rows[0]
    if (!row) {
      throw new Error(`recordWriteTx: ${specs[i]?.operation} on "${specs[i]?.table}" returned no row`)
    }
    return row
  })
}
