import type { Sql } from '@product-suite/db'

import { undoableKeys } from './work-item-fields'

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
  status:
    | 'pending'
    | 'accepted'
    | 'accepted_with_edits'
    | 'rejected'
    | 'superseded'
    | 'expired'
    | 'applied'
    | 'failed'
  decided_by: string | null
  decided_at: string | Date | null
  edited_payload: unknown
  rejection_reason: string | null
  applied_write: unknown
  target_version: number | null
  /**
   * The target's values for the payload's fields AS THEY WERE when this proposal was
   * drafted (Postgres's `to_jsonb` rendering). The Inbox diff's "before" side and the
   * accept-time compare-and-set fence both read it, so the reviewer's preview cannot
   * re-base and a drifted baseline is declined instead of clobbered. Null = unknown.
   */
  target_snapshot: Record<string, unknown> | null
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
const JSONB_COLUMNS = new Set(['payload', 'target_snapshot'])

/** Insertable columns, in a fixed allowlist (never derived from caller keys). */
const INSERT_COLUMNS = [
  'tenant_id',
  'run_id',
  'target_type',
  'target_id',
  'operation',
  'payload',
  'target_snapshot',
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
 * The BEFORE-IMAGE a `work_item:update` proposal is authored against: the target's
 * current values for exactly the fields this payload will set, read through Postgres's
 * OWN `to_jsonb` rendering so it compares byte-identically against
 * `to_jsonb(work_items)` in the accept-time fence (a driver-decoded `Date` would
 * false-conflict on every item with a due date).
 *
 * Captured HERE, inside the single insert every creation path shares, rather than at
 * each call site: a caller that forgets it would silently re-introduce the re-basing
 * diff (audit F5). Returns null when there is nothing honest to capture — a create, a
 * memory op, no patchable field, a vanished target, or a failed read. Drafting the
 * proposal matters more than diffing it perfectly, so a read failure is swallowed: a
 * null snapshot renders as an UNKNOWN before-state and must be refreshed before accept.
 */
async function captureTargetSnapshot(
  sql: Sql,
  input: CreateProposalInput,
): Promise<Record<string, unknown> | null> {
  if (input.target_type !== 'work_item' || input.operation !== 'update') return null
  if (!input.target_id) return null
  const fields = undoableKeys(input.payload)
  if (fields.length === 0) return null
  try {
    const rows = (await sql`
      select to_jsonb(work_items) as row_json from work_items
      where id = ${input.target_id} and tenant_id = ${input.tenant_id}
    `) as { row_json: Record<string, unknown> | null }[]
    const rowJson = rows[0]?.row_json
    if (!rowJson) return null
    const snapshot: Record<string, unknown> = {}
    for (const field of fields) snapshot[field] = rowJson[field] ?? null
    return snapshot
  } catch (cause) {
    console.error('[proposals] could not snapshot the proposal target', cause)
    return null
  }
}

/**
 * Insert a proposal (status defaults to 'pending') and return the created row.
 * Identifiers come only from the static allowlist; every value is a bound param.
 */
export async function createProposal(sql: Sql, input: CreateProposalInput): Promise<ProposalRow> {
  const snapshot = await captureTargetSnapshot(sql, input)
  const values: Record<string, unknown> = { ...(input as unknown as Record<string, unknown>) }
  // Server-captured, never caller-supplied: this side of the diff is not up for
  // negotiation (and `CreateProposalInput` deliberately has no such field).
  delete values.target_snapshot
  if (snapshot !== null) values.target_snapshot = snapshot
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

/** Store a human approval decision without executing the proposal. */
export async function approveProposalForCommand(
  sql: Sql,
  input: { tenantId: string; approverUserId: string; proposalId: string; editedPayload?: Record<string, unknown> },
): Promise<ProposalRow | null> {
  const rows = await runQuery<ProposalRow>(sql,
    `update proposals set
       status = case when $4::jsonb is null then 'accepted'::proposal_status else 'accepted_with_edits'::proposal_status end,
       decided_by = $3, decided_at = now(), edited_payload = $4::jsonb, updated_at = now()
     where id = $1 and tenant_id = $2 and status = 'pending'
     returning *`,
    [input.proposalId, input.tenantId, input.approverUserId, input.editedPayload ? JSON.stringify(input.editedPayload) : null],
  )
  return rows[0] ?? null
}
