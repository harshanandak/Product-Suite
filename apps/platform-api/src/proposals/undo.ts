import type { Sql } from '@product-suite/db'

import { DomainError } from '../domain/errors'
import { updateWorkItem, type UpdateWorkItemInput, type WorkItemRow } from '../domain/work-items'
import type { ActorContext } from '../provenance/record-write'
import { getProposalScoped } from './repository'

/**
 * UNDO-ON-ACCEPT — reversing an applied `work_item:update`.
 *
 * Accepting a proposal is a one-way door without this: the reviewer sees the diff,
 * but nothing takes it back. Undo closes that loop for the one operation where a
 * reversal is unambiguous — an UPDATE, whose inverse is simply "write the previous
 * values back". (Undoing a CREATE is a delete, and memory proposals already have
 * reversal semantics via supersede/retract; both are deliberately out of scope.)
 *
 * Three invariants shape everything here:
 *
 *  1. **No schema change.** The pre-image rides INSIDE the existing `applied_write`
 *     jsonb under the reserved {@link UNDO_KEY}, beside the applied row — no new
 *     column, no migration, and every existing `applied_write` reader still finds
 *     the row's fields at the top level.
 *  2. **Undo is a NEW validated write, never a status rollback.** It goes through
 *     `updateWorkItem` — the SAME domain command the human UI and the accept path
 *     use — so the reversal is validated, provenance-stamped, and logged as its own
 *     activity event. The proposal STAYS `applied`: "accepted always means applied"
 *     remains true, and the undo is recorded as a fact about what happened after.
 *  3. **Never clobber a later edit.** Before reversing, the target's CURRENT values
 *     are compared against the values the accept applied. Any drift ⇒ 409 and NO
 *     write — someone edited the item since, and their edit outranks our reversal.
 */

/**
 * The work-item columns an accept can set and an undo can therefore restore —
 * `WorkItemPatch`'s key set (see `@product-suite/contracts`). `depth` is excluded
 * deliberately: it is SERVER-derived from `parent_id`, never a caller patch, so
 * restoring `parent_id` restores it implicitly.
 */
export const UNDOABLE_FIELDS = [
  'title',
  'description',
  'phase',
  'type',
  'priority',
  'tags',
  'project_id',
  'team_id',
  'status_id',
  'parent_id',
  'department',
  'assignee_id',
  'due_date',
  'archived',
] as const

/**
 * The reserved key the undo record lives under inside `applied_write`. Double-
 * underscored so it can never collide with a work-item column name — the row's own
 * fields stay at the top level exactly as before.
 */
export const UNDO_KEY = '__undo'

/** The undo record persisted inside `applied_write[UNDO_KEY]`. */
export interface UndoEnvelope {
  /** The target's values BEFORE the accept, for the fields the accept set. */
  pre_image: Record<string, unknown>
  /** The values the accept APPLIED — the conflict check compares against these. */
  applied: Record<string, unknown>
  /** When the undo ran (absent ⇒ not undone). */
  undone_at?: string
  /** The user who reversed it. */
  undone_by?: string
}

/** The outcome envelope, mirroring `AcceptResult`'s surfaced-not-thrown discipline. */
export type UndoResult =
  | { status: 'undone'; proposal_id: string; item_id: string }
  | { status: 'not_found'; proposal_id: string }
  /** Structurally un-undoable (wrong type/op, or an accept with no pre-image). */
  | { status: 'not_undoable'; proposal_id: string; message: string }
  /** The world moved: a later edit, an already-undone proposal, or a lost race. */
  | { status: 'conflict'; proposal_id: string; message: string; fields: string[] }

/** The HTTP status the undo route returns for an {@link UndoResult}. */
export function undoHttpStatus(result: UndoResult): 200 | 404 | 409 | 422 {
  switch (result.status) {
    case 'undone':
      return 200
    case 'not_found':
      return 404
    case 'conflict':
      return 409
    case 'not_undoable':
      return 422
  }
}

/** Run a parameterized statement via neon's `sql.query(text, params)` (v1.x). */
function sqlQuery<Row = Record<string, unknown>>(
  sql: Sql,
  text: string,
  params: unknown[],
): Promise<Row[]> {
  return (sql as unknown as { query: (q: string, p: unknown[]) => Promise<Row[]> }).query(text, params)
}

/**
 * Normalize a column value for STRUCTURAL comparison and for jsonb storage. A
 * `timestamptz` comes back as a `Date` from a live read but as an ISO string once
 * it has round-tripped through jsonb, so both sides collapse to the ISO string —
 * otherwise every undo of an item with a due date would false-conflict. `undefined`
 * becomes `null` because jsonb DROPS undefined keys, which would silently shrink
 * the pre-image.
 */
function normalizeFieldValue(value: unknown): unknown {
  if (value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(normalizeFieldValue)
  return value
}

/** The patch keys that are real, restorable columns (everything else is ignored). */
export function undoableKeys(payload: Record<string, unknown>): string[] {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return []
  return UNDOABLE_FIELDS.filter((field) => field in payload)
}

/** Read exactly `fields` off a row, normalized — an absent column records as `null`. */
export function fieldSnapshot(
  row: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {}
  for (const field of fields) snapshot[field] = normalizeFieldValue(row[field])
  return snapshot
}

/**
 * The `applied_write` value to persist for an undoable accept: the applied ROW
 * (unchanged, so existing readers are unaffected) plus the undo record beside it.
 */
export function buildUndoEnvelope(
  row: Record<string, unknown>,
  preImage: Record<string, unknown>,
  applied: Record<string, unknown>,
): Record<string, unknown> {
  return { ...row, [UNDO_KEY]: { pre_image: preImage, applied } satisfies UndoEnvelope }
}

/** The undo record inside an `applied_write`, or null when it carries no pre-image. */
export function readUndoEnvelope(appliedWrite: unknown): UndoEnvelope | null {
  if (typeof appliedWrite !== 'object' || appliedWrite === null) return null
  const record = (appliedWrite as Record<string, unknown>)[UNDO_KEY]
  if (typeof record !== 'object' || record === null) return null
  const envelope = record as Partial<UndoEnvelope>
  if (typeof envelope.pre_image !== 'object' || envelope.pre_image === null) return null
  return { ...envelope, pre_image: envelope.pre_image, applied: envelope.applied ?? {} }
}

/**
 * The fields where the target's CURRENT value no longer matches what the accept
 * applied — i.e. what somebody changed since. A non-empty list means the undo must
 * refuse: reversing would silently discard that later edit.
 */
export function conflictingFields(
  applied: Record<string, unknown>,
  current: Record<string, unknown>,
): string[] {
  return Object.keys(applied).filter((field) => {
    const before = JSON.stringify(normalizeFieldValue(applied[field]) ?? null)
    const now = JSON.stringify(normalizeFieldValue(current[field]) ?? null)
    return before !== now
  })
}

/** The target work item, scoped to the caller's tenants (null when not theirs/gone). */
async function loadTargetRow(
  sql: Sql,
  tenantIds: string[],
  id: string,
): Promise<WorkItemRow | null> {
  const rows = (await sql`
    select * from work_items where id = ${id} and tenant_id = any(${tenantIds})
  `) as WorkItemRow[]
  return rows[0] ?? null
}

/** A conflict outcome with no specific field (status/race conflicts, not value drift). */
function conflict(proposalId: string, message: string, fields: string[] = []): UndoResult {
  return { status: 'conflict', proposal_id: proposalId, message, fields }
}

/**
 * Reverse an applied `work_item:update` proposal, ONE step, through the validated
 * write path. Sequence (deliberately mirroring accept's write-first/mark-last):
 *
 *  1. LOAD scoped (`not_found` when it isn't the caller's) and check it is an
 *     `applied` `work_item:update` carrying a pre-image — anything else is a clean
 *     `not_undoable` (422) or `conflict` (409), never a 500.
 *  2. CONFLICT CHECK — re-read the target and compare its CURRENT values against
 *     the values the accept applied. Any drift ⇒ 409 with the drifted field names
 *     and NOTHING written. A later human edit always outranks the undo.
 *  3. WRITE the pre-image back through `updateWorkItem` — the same validated domain
 *     command, stamped with the APPROVER as a `human` actor (a person reversed
 *     this; it is not the agent's write). A domain rejection classifies to
 *     `not_undoable`; anything unexpected rethrows → the route's 500.
 *  4. MARK LAST — one guarded UPDATE stamps `undone_at`/`undone_by` inside
 *     `applied_write`, guarded on still-`applied` AND not-yet-undone so a
 *     concurrent undo can only win once (the loser reports `conflict`). The
 *     proposal's STATUS is untouched: the accept really did apply, and the undo is
 *     a subsequent fact, not a rewrite of history.
 */
export async function undoProposal(
  sql: Sql,
  ctx: { tenantIds: string[]; approverUserId: string },
  proposalId: string,
): Promise<UndoResult> {
  // (1) LOAD + eligibility.
  const proposal = await getProposalScoped(sql, proposalId, ctx.tenantIds)
  if (!proposal) return { status: 'not_found', proposal_id: proposalId }

  if (proposal.target_type !== 'work_item' || proposal.operation !== 'update') {
    return {
      status: 'not_undoable',
      proposal_id: proposalId,
      message: 'only an applied work item update can be undone',
    }
  }
  if (proposal.status !== 'applied') {
    return conflict(proposalId, 'this proposal is not applied, so there is nothing to undo')
  }
  const envelope = readUndoEnvelope(proposal.applied_write)
  if (!envelope) {
    return {
      status: 'not_undoable',
      proposal_id: proposalId,
      message: 'this change was accepted before undo was available, so its previous values were never recorded',
    }
  }
  if (envelope.undone_at) {
    return conflict(proposalId, 'this change has already been undone')
  }
  const targetId = proposal.target_id
  if (!targetId) return { status: 'not_found', proposal_id: proposalId }

  // (2) CONFLICT CHECK — never silently clobber an edit made after the accept.
  const current = await loadTargetRow(sql, ctx.tenantIds, targetId)
  if (!current) return { status: 'not_found', proposal_id: proposalId }
  const drifted = conflictingFields(envelope.applied, current as unknown as Record<string, unknown>)
  if (drifted.length > 0) {
    return conflict(
      proposalId,
      `this item changed after it was accepted (${drifted.join(', ')}) — undoing would discard that change`,
      drifted,
    )
  }

  // (3) WRITE the pre-image back — a NEW validated write, by the HUMAN who undid it.
  const actor: ActorContext = { actorType: 'human', actorId: ctx.approverUserId }
  let restored: WorkItemRow
  try {
    restored = await updateWorkItem(
      sql,
      { tenantIds: [proposal.tenant_id], actor },
      targetId,
      envelope.pre_image as UpdateWorkItemInput,
    )
  } catch (cause) {
    if (cause instanceof DomainError) {
      if (cause.code === 'not_found') return { status: 'not_found', proposal_id: proposalId }
      if (cause.code === 'stale' || cause.code === 'conflict') {
        return conflict(proposalId, cause.message)
      }
      return { status: 'not_undoable', proposal_id: proposalId, message: cause.message }
    }
    throw cause
  }

  // (4) MARK LAST — guarded so a concurrent undo can only win once. Status untouched.
  const undone: UndoEnvelope = {
    ...envelope,
    undone_at: new Date().toISOString(),
    undone_by: ctx.approverUserId,
  }
  const appliedWrite = {
    ...(proposal.applied_write as Record<string, unknown>),
    [UNDO_KEY]: undone,
  }
  const marked = await sqlQuery<{ id: string }>(
    sql,
    `update proposals set applied_write = $1::jsonb, updated_at = now()
     where id = $2 and status = 'applied'
       and applied_write -> '${UNDO_KEY}' ->> 'undone_at' is null
     returning id`,
    [JSON.stringify(appliedWrite), proposalId],
  )
  if (marked.length === 0) {
    // A concurrent undo stamped it first. Its write restored the SAME pre-image, so
    // the item is correct either way — we just report that we were not the one.
    return conflict(proposalId, 'this change has already been undone')
  }
  return { status: 'undone', proposal_id: proposalId, item_id: restored.id }
}
