import type { Sql } from '@product-suite/db'

import { DomainError } from '../domain/errors'
import {
  createWorkItem,
  updateWorkItem,
  type CreateWorkItemInput,
  type UpdateWorkItemInput,
  type WorkItemRow,
} from '../domain/work-items'
import type { ActorContext } from '../provenance/record-write'
import { getProposalScoped, type ProposalRow } from './repository'

/**
 * The outcome of applying a proposal. `not_found` = not in the caller's tenants
 * (the route maps it to 404); the rest are decision outcomes: `not_pending` = it
 * was already decided/claimed (a duplicate or racing accept → 409), `stale` = the
 * target moved/vanished under it so the proposal stays reviewable (→ 409), `invalid`
 * = a permanent invariant failure that terminally FAILED the proposal (→ 422).
 */
export type ApplyResult =
  | { applied: true; result: WorkItemRow }
  | { applied: false; reason: 'not_found' | 'not_pending' | 'stale' | 'invalid' }

/** The (target_type, operation) pairs this slice can apply. */
const SUPPORTED = new Set(['work_item:create', 'work_item:update'])

/** Run a parameterized statement via neon's `sql.query(text, params)` (v1.x). */
function sqlQuery<Row = Record<string, unknown>>(
  sql: Sql,
  text: string,
  params: unknown[],
): Promise<Row[]> {
  return (sql as unknown as { query: (q: string, p: unknown[]) => Promise<Row[]> }).query(text, params)
}

/**
 * Apply a pending proposal EXACTLY ONCE, through the SAME validated domain command
 * the human UI uses — the moat's single write path (Design C: claim-then-command).
 *
 *  1. LOAD the proposal scoped to the caller's tenants (`not_found` if not theirs).
 *  2. Build the AGENT actor from the proposal's run (the run is the actor, the
 *     approver is `on_behalf_of`); v1 proposals must come from a run.
 *  3. CLAIM — the atomic exactly-once gate. A single `UPDATE … WHERE status='pending'`
 *     row-locks the proposal, so concurrent/duplicate accepts serialize here and only
 *     ONE gets a row back; every other matches 0 rows → `not_pending`. This is the
 *     single point that decides the winner. It is NOT wrapped in a transaction with
 *     the command: Neon HTTP has no interactive txn, and the command MUST be the
 *     shared validated path (never a hand-written domain write).
 *  4. COMMAND — only the claim-winner dispatches to the domain command. On success
 *     the applied write is recorded on the proposal and `{applied:true}` returns.
 *  5. COMPENSATE on a `DomainError`:
 *     - `stale` → GUARDED revert to `pending` (only if THIS call still owns the
 *       claim) so the proposal stays reviewable → `stale`.
 *     - any other (permanent/invalid) → GUARDED terminal `failed` → `invalid`.
 *     Both guards match `status='applied' AND decided_by=$approver`, so they touch
 *     only the row THIS call claimed — no other accept can win while it is non-pending.
 *
 * Deliberate v1 tradeoff (for founder review): the claim (commit 1) and the write
 * (commit 2) are NOT one atomic transaction. A process crash in the gap could leave
 * a proposal `applied` but unwritten; the create path is made idempotent via
 * `work_items.applied_from_proposal_id` (a re-drive returns the existing row), and a
 * recovery sweep for `applied`-without-`applied_write` rows is a fast-follow.
 */
export async function applyProposal(
  sql: Sql,
  ctx: { tenantIds: string[]; approverUserId: string },
  proposalId: string,
): Promise<ApplyResult> {
  const { tenantIds, approverUserId } = ctx

  // (1) LOAD (scoped).
  const proposal = await getProposalScoped(sql, proposalId, tenantIds)
  if (!proposal) return { applied: false, reason: 'not_found' }
  if (proposal.status !== 'pending') return { applied: false, reason: 'not_pending' }

  // Structural pre-checks (BEFORE the claim, so a malformed proposal never flips):
  // the (target_type, operation) must be one we can apply, an agent write must be
  // attributable to a run, and an update must name a target.
  if (!SUPPORTED.has(`${proposal.target_type}:${proposal.operation}`)) {
    return { applied: false, reason: 'invalid' }
  }
  if (!proposal.run_id) return { applied: false, reason: 'invalid' }
  if (proposal.operation === 'update' && !proposal.target_id) {
    return { applied: false, reason: 'invalid' }
  }

  // The payload actually applied is the human-edited one when present, else the
  // agent's original (this is the gold-label the claim records on the proposal).
  const appliedPayload = (proposal.edited_payload ?? proposal.payload) as Record<string, unknown>

  // (3) CLAIM — the exactly-once gate (a single statement).
  const claimedRows = await sqlQuery<ProposalRow>(
    sql,
    `update proposals set status = 'applied', decided_by = $1, decided_at = now(),
       edited_payload = $2::jsonb, updated_at = now()
     where id = $3 and status = 'pending' returning *`,
    [approverUserId, JSON.stringify(appliedPayload), proposalId],
  )
  const claimed = claimedRows[0]
  if (!claimed) return { applied: false, reason: 'not_pending' }

  // (2) actor — the winner writes as the agent acting on behalf of the approver.
  const actor: ActorContext = {
    actorType: 'agent',
    actorId: proposal.run_id,
    onBehalfOf: approverUserId,
    runId: proposal.run_id,
  }

  try {
    // (4) COMMAND — only the winner reaches here; dispatch (target_type, operation).
    let result: WorkItemRow
    if (proposal.operation === 'create') {
      result = await createWorkItem(
        sql,
        { tenantId: claimed.tenant_id, actor, appliedFromProposalId: claimed.id },
        appliedPayload as CreateWorkItemInput,
      )
    } else {
      result = await updateWorkItem(
        sql,
        { tenantIds: [claimed.tenant_id], actor, expectedVersion: claimed.target_version ?? undefined },
        claimed.target_id as string,
        appliedPayload as UpdateWorkItemInput,
      )
    }
    // Record the actual write on the proposal (idempotency + audit).
    await sqlQuery(
      sql,
      `update proposals set applied_write = $1::jsonb, updated_at = now() where id = $2`,
      [JSON.stringify(result), proposalId],
    )
    return { applied: true, result }
  } catch (cause) {
    if (cause instanceof DomainError) {
      if (cause.code === 'stale') {
        // (5) GUARDED revert — the target moved; keep the proposal reviewable.
        await sqlQuery(
          sql,
          `update proposals set status = 'pending', decided_by = null, decided_at = null,
             updated_at = now()
           where id = $1 and status = 'applied' and decided_by = $2`,
          [proposalId, approverUserId],
        )
        return { applied: false, reason: 'stale' }
      }
      // (5) GUARDED terminal — a permanent invariant failure fails the proposal.
      await sqlQuery(
        sql,
        `update proposals set status = 'failed', rejection_reason = $1, updated_at = now()
         where id = $2 and status = 'applied' and decided_by = $3`,
        [cause.message, proposalId, approverUserId],
      )
      return { applied: false, reason: 'invalid' }
    }
    // A non-domain failure (DB/actor error) is not a decision outcome — surface it
    // so the route maps it to 500 (the proposal stays `applied`; the recovery sweep
    // re-drives it idempotently).
    throw cause
  }
}
