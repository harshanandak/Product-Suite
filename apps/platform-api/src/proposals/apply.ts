import { z } from 'zod'

import type { Sql } from '@product-suite/db'

import { DomainError } from '../domain/errors'
import {
  createMemory,
  deferMemory,
  getMemoryBySourceProposalId,
  retractMemory,
  supersedeMemory,
  type MemoryRow,
} from '../domain/memories'
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
  | { applied: true; result: WorkItemRow | MemoryRow }
  | { applied: false; reason: 'not_found' | 'not_pending' | 'stale' | 'invalid' }

/**
 * Runtime shapes for the three memory payloads that carry data. `payload`/`edited_payload`
 * are `unknown` JSON — a human could edit `topics` to a bare string or `review_after` to a
 * number, which the domain casts would forward straight to a `timestamptz`/`text[]` bind and
 * cast-error into a 500 that leaves the proposal `applied`-without-a-write. We parse each
 * payload HERE and convert any mismatch to `invalid_input` (→ a terminal `failed` proposal),
 * so a malformed edit is a clean rejection, never a wedge. Domain commands still do the deeper
 * checks (non-empty title, UUID scope_id, ISO `review_after`); this layer only fixes TYPES.
 */
const memoryCreatePayload = z.object({
  kind: z.enum(['decision', 'fact', 'rule']),
  title: z.string(),
  body: z.string().optional(),
  topics: z.array(z.string()).optional(),
  scope_type: z.enum(['org', 'project', 'work_item_type', 'work_item']).optional(),
  scope_id: z.string().optional(),
  attrs: z.record(z.string(), z.unknown()).optional(),
  enforcement: z.enum(['advisory', 'hard']).optional(),
  pinned: z.boolean().optional(),
})
const memorySupersedePayload = z.object({
  title: z.string().optional(),
  body: z.string().optional(),
  topics: z.array(z.string()).optional(),
  change_reason: z.string().optional(),
  attrs: z.record(z.string(), z.unknown()).optional(),
})
const memoryDeferPayload = z.object({
  waiting_on: z.string().optional(),
  review_after: z.string().optional(),
})

/** Parse a memory payload, mapping a shape mismatch to `invalid_input` (never a raw ZodError). */
function parseMemoryPayload<T>(schema: z.ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue?.path.length ? `${issue.path.join('.')}: ` : ''
    throw new DomainError('invalid_input', `invalid memory payload — ${where}${issue?.message ?? 'validation failed'}`)
  }
  return parsed.data
}

/** The (target_type, operation) pairs this slice can apply. */
const SUPPORTED = new Set([
  'work_item:create',
  'work_item:update',
  'memory:create',
  'memory:supersede',
  'memory:retract',
  'memory:defer',
])

/** Run a parameterized statement via neon's `sql.query(text, params)` (v1.x). */
function sqlQuery<Row = Record<string, unknown>>(
  sql: Sql,
  text: string,
  params: unknown[],
): Promise<Row[]> {
  return (sql as unknown as { query: (q: string, p: unknown[]) => Promise<Row[]> }).query(text, params)
}

/**
 * Terminally fail a permanently-invalid proposal (a structural pre-check failure)
 * and report `invalid`. The flip is GUARDED on `status='pending'` so it is a no-op
 * if the proposal was already decided — it never resurrects or re-decides a row.
 */
async function failInvalid(sql: Sql, proposalId: string, reason: string): Promise<ApplyResult> {
  await sqlQuery(
    sql,
    `update proposals set status = 'failed', rejection_reason = $1, updated_at = now()
     where id = $2 and status = 'pending'`,
    [reason, proposalId],
  )
  return { applied: false, reason: 'invalid' }
}

/**
 * Dispatch an accepted `target_type='memory'` proposal to the memory DOMAIN commands
 * (the single validated write path — never raw SQL), as the AGENT acting on behalf of
 * the approver. `created_by`/actor is the RUN (the agent's identity), `decided_by` is
 * the approver, and created/superseded memories carry `source_kind='proposal'` +
 * `source_proposal_id`/`source_run_id` so an agent-authored memory is fully accountable.
 *
 * Idempotent re-drive (create only): before creating, look up a memory already made
 * from THIS proposal (`source_proposal_id`) — the memory analogue of
 * `work_items.applied_from_proposal_id` — and return it, so a crash between the claim
 * and the write can never double-create. The lookup is scoped to the proposal's OWN
 * tenant; every command is likewise `tenantIds=[claimed.tenant_id]`, so a foreign
 * target id is indistinguishable from unknown (→ `not_found`) and never applied — the
 * apply is the tenant boundary, not just the tool.
 */
async function applyMemoryCommand(
  sql: Sql,
  claimed: ProposalRow,
  payload: Record<string, unknown>,
  approverUserId: string,
): Promise<MemoryRow> {
  const tenantId = claimed.tenant_id
  const runId = claimed.run_id as string // guaranteed by the run_id pre-check
  const targetId = claimed.target_id as string // guaranteed by the target pre-check (non-create)

  if (claimed.operation === 'create') {
    const existing = await getMemoryBySourceProposalId(sql, claimed.id, [tenantId])
    if (existing) return existing
    const p = parseMemoryPayload(memoryCreatePayload, payload)
    return createMemory(
      sql,
      { tenantId, actor: runId },
      {
        kind: p.kind,
        title: p.title,
        body: p.body,
        topics: p.topics,
        scopeType: p.scope_type,
        scopeId: p.scope_id ?? null,
        attrs: p.attrs,
        enforcement: p.enforcement,
        pinned: p.pinned,
        sourceKind: 'proposal',
        sourceRunId: runId,
        sourceProposalId: claimed.id,
        decidedBy: approverUserId,
      },
    )
  }
  if (claimed.operation === 'supersede') {
    const p = parseMemoryPayload(memorySupersedePayload, payload)
    return supersedeMemory(
      sql,
      { tenantIds: [tenantId], actor: runId },
      targetId,
      {
        title: p.title,
        body: p.body,
        topics: p.topics,
        changeReason: p.change_reason ?? '',
        sourceKind: 'proposal',
        sourceRunId: runId,
        sourceProposalId: claimed.id,
        // The new version records the APPROVER, not the old row's decider.
        decidedBy: approverUserId,
      },
    )
  }
  if (claimed.operation === 'retract') {
    return retractMemory(sql, { tenantIds: [tenantId], actor: runId }, targetId)
  }
  const p = parseMemoryPayload(memoryDeferPayload, payload)
  return deferMemory(
    sql,
    { tenantIds: [tenantId], actor: runId },
    targetId,
    {
      waitingOn: p.waiting_on ?? null,
      reviewAfter: p.review_after ?? null,
    },
  )
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
  editedPayload?: Record<string, unknown> | null,
): Promise<ApplyResult> {
  const { tenantIds, approverUserId } = ctx

  // (1) LOAD (scoped).
  const proposal = await getProposalScoped(sql, proposalId, tenantIds)
  if (!proposal) return { applied: false, reason: 'not_found' }
  if (proposal.status !== 'pending') return { applied: false, reason: 'not_pending' }

  // Structural pre-checks. Each is a PERMANENT invariant failure (this slice can
  // never apply the proposal), so it must terminally FAIL the proposal instead of
  // leaving it pending forever in `listPending`. The guarded flip (only while still
  // `pending`) is a no-op if another path already decided it. The (target_type,
  // operation) must be one we can apply, an agent write must be attributable to a
  // run, and an update must name a target.
  if (!SUPPORTED.has(`${proposal.target_type}:${proposal.operation}`)) {
    return failInvalid(sql, proposalId, `unsupported ${proposal.target_type}:${proposal.operation}`)
  }
  if (!proposal.run_id) return failInvalid(sql, proposalId, 'missing run_id (no attributable actor)')
  // Every operation except a create names a target it acts on (work_item:update,
  // memory:supersede|retract|defer). A missing target is a permanent structural failure.
  if (proposal.operation !== 'create' && !proposal.target_id) {
    return failInvalid(sql, proposalId, `${proposal.operation} proposal has no target_id`)
  }

  // (3) CLAIM — the exactly-once gate (a single statement). It flips the lifecycle
  // columns AND, atomically in the SAME statement, persists the human's gold-label
  // correction when the approver edited the proposal (per-rule strength / pin lives
  // here). `edited_payload = coalesce($3::jsonb, edited_payload)` keeps the existing
  // value (normally null) when no edit was sent, so a no-body accept is unchanged and
  // the write can never race the claim. The applied payload is READ from the claimed
  // row below (`edited_payload ?? payload`).
  const claimedRows = await sqlQuery<ProposalRow>(
    sql,
    `update proposals set status = 'applied', decided_by = $1, decided_at = now(),
       updated_at = now(), edited_payload = coalesce($3::jsonb, edited_payload)
     where id = $2 and status = 'pending' returning *`,
    [approverUserId, proposalId, editedPayload == null ? null : JSON.stringify(editedPayload)],
  )
  const claimed = claimedRows[0]
  if (!claimed) return { applied: false, reason: 'not_pending' }

  // The payload actually applied is the human-edited one when present, else the
  // agent's original — read from the CLAIMED row (never re-stamped by the claim).
  const appliedPayload = (claimed.edited_payload ?? claimed.payload) as Record<string, unknown>

  // (2) actor — the winner writes as the agent acting on behalf of the approver.
  const actor: ActorContext = {
    actorType: 'agent',
    actorId: proposal.run_id,
    onBehalfOf: approverUserId,
    runId: proposal.run_id,
  }

  try {
    // (4) COMMAND — only the winner reaches here; dispatch (target_type, operation).
    let result: WorkItemRow | MemoryRow
    if (proposal.target_type === 'memory') {
      result = await applyMemoryCommand(sql, claimed, appliedPayload, approverUserId)
    } else if (proposal.operation === 'create') {
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
      // `stale` (work-item version moved) and `conflict` (a memory that is no longer
      // active — a concurrent supersede/retract won) are the SAME kind of outcome: the
      // target moved under us, so keep the proposal reviewable rather than terminally
      // failing it. Every other DomainError is a permanent invariant failure.
      if (cause.code === 'stale' || cause.code === 'conflict') {
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
