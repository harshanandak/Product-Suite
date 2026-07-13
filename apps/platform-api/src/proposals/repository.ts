import type { Sql } from '@product-suite/db'

/**
 * A proposal row (snake_case DB columns, matching migration 0007). A module-
 * agnostic reviewable intent to change something — applied through the SAME
 * validated domain-command layer as the human UI (see `apply.ts`).
 */
export interface ProposalRow {
  id: string
  tenant_id: string
  run_id: string | null
  target_type: string
  target_id: string | null
  operation: string
  payload: unknown
  rationale: string | null
  confidence: number | null
  risk_level: string | null
  status: 'pending' | 'accepted' | 'accepted_with_edits' | 'rejected' | 'superseded' | 'expired' | 'applied'
  decided_by: string | null
  decided_at: string | Date | null
  edited_payload: unknown
  rejection_reason: string | null
  applied_write: unknown
  target_version: number | null
  model_id: string | null
  prompt_version: string | null
  context_ref: string | null
  actor_type: string
  actor_id: string | null
  on_behalf_of: string | null
  created_at: string | Date
  updated_at: string | Date
}

/** The fields a caller may set when drafting a proposal (provenance included: the
 *  run/agent is the actor, the human is `on_behalf_of`). Lifecycle/decision columns
 *  are server-managed and never accepted here. */
export interface CreateProposalInput {
  tenant_id: string
  run_id?: string | null
  target_type: string
  target_id?: string | null
  operation: string
  payload: unknown
  rationale?: string | null
  confidence?: number | null
  risk_level?: string | null
  target_version?: number | null
  model_id?: string | null
  prompt_version?: string | null
  context_ref?: string | null
  actor_type?: 'agent' | 'human' | 'system' | 'import'
  actor_id?: string | null
  on_behalf_of?: string | null
}

/** Columns that are jsonb in the schema — stringified + cast so a JS object binds. */
const JSONB_COLUMNS = new Set(['payload'])

/** Insertable columns, in a fixed allowlist (never derived from caller keys). */
const INSERT_COLUMNS = [
  'tenant_id',
  'run_id',
  'target_type',
  'target_id',
  'operation',
  'payload',
  'rationale',
  'confidence',
  'risk_level',
  'target_version',
  'model_id',
  'prompt_version',
  'context_ref',
  'actor_type',
  'actor_id',
  'on_behalf_of',
] as const

function runQuery<Row>(sql: Sql, text: string, params: unknown[]): Promise<Row[]> {
  return (sql as unknown as { query: (q: string, p: unknown[]) => Promise<Row[]> }).query(text, params)
}

/**
 * Insert a proposal (status defaults to 'pending') and return the created row.
 * Identifiers come only from the static allowlist; every value is a bound param.
 */
export async function createProposal(sql: Sql, input: CreateProposalInput): Promise<ProposalRow> {
  const values = input as unknown as Record<string, unknown>
  const cols: string[] = []
  const params: unknown[] = []
  const placeholders: string[] = []
  for (const col of INSERT_COLUMNS) {
    if (values[col] === undefined) continue
    cols.push(`"${col}"`)
    if (JSONB_COLUMNS.has(col)) {
      params.push(JSON.stringify(values[col]))
      placeholders.push(`$${params.length}::jsonb`)
    } else {
      params.push(values[col])
      placeholders.push(`$${params.length}`)
    }
  }
  const text = `insert into "proposals" (${cols.join(', ')}) values (${placeholders.join(', ')}) returning *`
  const rows = await runQuery<ProposalRow>(sql, text, params)
  const row = rows[0]
  if (!row) throw new Error('createProposal: insert returned no row')
  return row
}

/**
 * The caller's pending inbox: every pending proposal in the tenants they belong
 * to, newest last (stable `created_at` order). Tenant-scoped — a proposal from
 * another org is invisible.
 */
export async function listPending(sql: Sql, tenantIds: string[]): Promise<ProposalRow[]> {
  return (await sql`
    select * from proposals
    where tenant_id = any(${tenantIds}) and status = 'pending'
    order by created_at
  `) as ProposalRow[]
}

/** Fetch one proposal scoped to the caller's tenants (null when not theirs). */
export async function getProposalScoped(
  sql: Sql,
  id: string,
  tenantIds: string[],
): Promise<ProposalRow | null> {
  const rows = (await sql`
    select * from proposals where id = ${id} and tenant_id = any(${tenantIds}) limit 1
  `) as ProposalRow[]
  return rows[0] ?? null
}
