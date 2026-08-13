import { Hono } from 'hono'

import type { AcceptResult } from '@product-suite/contracts'

import { callerTenantIds, callerUserId } from '../auth/tenant-scope'
import { authorizeCapability } from '../auth/capabilities'
import { curateProposal } from '../curator/curate'
import { sqlFrom } from '../db'
import type { AuthedEnv } from '../middleware/clerk-auth'
import { acceptHttpStatus, applyProposal, isUuid } from '../proposals/apply'
import { approveProposalForCommand, getProposalScoped, listPending } from '../proposals/repository'
import { undoHttpStatus, undoProposal } from '../proposals/undo'

/**
 * The agent decision inbox. A proposal is a module-agnostic, reviewable intent to
 * change something that an agent (or a future policy engine) drafted; a human
 * approver accepts or rejects it here. Accepting APPLIES the change through the SAME
 * validated domain command the human UI uses — the single write path (see
 * `proposals/apply.ts`). Everything is tenant-scoped: a caller only ever sees or
 * acts on proposals in an org they are an *active* member of.
 */
export const proposalsRoutes = new Hono<AuthedEnv>()

/** The caller's pending inbox — every pending proposal in their active orgs. */
proposalsRoutes.get('/', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})

  try {
    const tenantIds = await callerTenantIds(sql, claims)
    if (tenantIds.length === 0) return c.json([])
    const rows = await listPending(sql, tenantIds)
    return c.json(rows)
  } catch (cause) {
    console.error('[proposals] inbox query failed', cause)
    return c.json({ error: 'Failed to load proposals' }, 500)
  }
})

/**
 * ONE proposal by id, in ANY status (tenant-scoped; 404 when it isn't the caller's or
 * does not exist). The inbox list returns only PENDING proposals, so a `?proposal=<id>`
 * deep-link whose target has been disposed of is indistinguishable from a bogus id
 * without this — and the Review Inbox must never respond to a dead link by putting a
 * DIFFERENT pending change under the reviewer's Accept button. This is the read that
 * lets it say "already accepted" / "already rejected" instead.
 */
proposalsRoutes.get('/:id', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})
  const id = c.req.param('id')

  try {
    // A hand-edited/junk id would `22P02` against the `uuid` column and surface as a
    // 500; it is simply not found.
    if (!isUuid(id)) return c.json({ error: 'Not found' }, 404)
    const tenantIds = await callerTenantIds(sql, claims)
    if (tenantIds.length === 0) return c.json({ error: 'Not found' }, 404)
    const proposal = await getProposalScoped(sql, id, tenantIds)
    if (!proposal) return c.json({ error: 'Not found' }, 404)
    return c.json(proposal)
  } catch (cause) {
    console.error('[proposals] lookup failed', cause)
    return c.json({ error: 'Failed to load this proposal' }, 500)
  }
})

/**
 * Accept a proposal: apply it EXACTLY ONCE through the domain command, attributed to
 * the agent run acting on behalf of THIS approver. `applyProposal` owns the write-first/
 * flip-last exactly-once gate and returns the stable {@link AcceptResult} envelope. The
 * route ALWAYS emits that envelope in the JSON body (so the Review Inbox reads `status`
 * from the body, not just the HTTP code) and maps `status` → HTTP via `acceptHttpStatus`.
 */
proposalsRoutes.post('/:id/accept', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})
  const id = c.req.param('id')
  // Optional human gold-label correction (per-rule strength / pin, or any merged
  // edit) the Inbox sends on accept. Absent/non-object body → no edit (backward
  // compatible). Deeper validation happens in applyProposal's payload parse.
  const body = (await c.req.json().catch(() => ({}))) as { edited_payload?: unknown }
  const editedPayload =
    body.edited_payload && typeof body.edited_payload === 'object'
      ? (body.edited_payload as Record<string, unknown>)
      : undefined

  try {
    const tenantIds = await callerTenantIds(sql, claims)
    if (tenantIds.length === 0) {
      return c.json({ status: 'not_found', proposal_id: id } satisfies AcceptResult, 404)
    }

    const approverUserId = await callerUserId(sql, claims)
    if (!approverUserId) {
      console.error('[proposals] accept: tenant resolved but no user identity for subject')
      // Deterministic (a retry won't conjure an identity mapping) → non-retryable → 422,
      // so a per-request provisioning gap never pages the on-call as a 5xx.
      const noIdentity: AcceptResult = {
        status: 'failed',
        proposal_id: id,
        message: 'No user identity for subject',
        retryable: false,
      }
      return c.json(noIdentity, acceptHttpStatus(noIdentity))
    }

    const res = await applyProposal(sql, { tenantIds, approverUserId }, id, editedPayload)
    return c.json(res, acceptHttpStatus(res))
  } catch (cause) {
    console.error('[proposals] accept failed', cause)
    // An unexpected error is a genuine (transient) server fault → retryable → 500 (alerts).
    const failure: AcceptResult = {
      status: 'failed',
      proposal_id: id,
      message: 'Failed to accept proposal',
      retryable: true,
    }
    return c.json(failure, acceptHttpStatus(failure))
  }
})

proposalsRoutes.post('/:id/approve-command', async (c) => {
  const tenantId = c.req.header('x-workspace-id')
  const id = c.req.param('id')
  if (!tenantId || !isUuid(id)) return c.json({ error: 'Not found' }, 404)
  const sql = sqlFrom(c.env ?? {})
  const authorization = await authorizeCapability(sql, c.get('claims'), tenantId, 'edit')
  if (!authorization.ok) return c.json({ error: authorization.reason }, authorization.status)
  const body = (await c.req.json().catch(() => ({}))) as { edited_payload?: unknown }
  if (body.edited_payload !== undefined && (body.edited_payload === null || typeof body.edited_payload !== 'object' || Array.isArray(body.edited_payload))) {
    return c.json({ error: 'Invalid edited payload' }, 400)
  }
  const proposal = await approveProposalForCommand(sql, {
    tenantId,
    approverUserId: authorization.context.userId,
    proposalId: id,
    ...(body.edited_payload === undefined ? {} : { editedPayload: body.edited_payload as Record<string, unknown> }),
  })
  if (!proposal) return c.json({ error: 'Proposal is not pending' }, 409)
  return c.json({ proposal })
})

/**
 * Undo an accepted change: reverse an applied `work_item:update` by writing its
 * pre-image back through the SAME validated domain command the accept used. This
 * is what makes accepting reversible rather than a one-way door.
 *
 * It is a NEW validated write, never a status rollback — the proposal stays
 * `applied` (the accept really did apply; the undo is a later fact recorded inside
 * `applied_write`). Before reversing, the target's CURRENT values are compared to
 * what the accept applied: any drift ⇒ 409 and nothing is written, because a human
 * edit made after the accept must never be silently clobbered. `undoProposal` owns
 * that logic and returns a surfaced envelope; the route maps it to HTTP and, like
 * accept, ALWAYS emits the envelope in the body.
 */
proposalsRoutes.post('/:id/undo', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})
  const id = c.req.param('id')

  try {
    const tenantIds = await callerTenantIds(sql, claims)
    if (tenantIds.length === 0) return c.json({ status: 'not_found', proposal_id: id }, 404)

    const approverUserId = await callerUserId(sql, claims)
    if (!approverUserId) {
      console.error('[proposals] undo: tenant resolved but no user identity for subject')
      // Deterministic (a retry won't conjure an identity mapping) → 422, not a 5xx.
      return c.json(
        { status: 'not_undoable', proposal_id: id, message: 'No user identity for subject' },
        422,
      )
    }

    const result = await undoProposal(sql, { tenantIds, approverUserId }, id)
    return c.json(result, undoHttpStatus(result))
  } catch (cause) {
    console.error('[proposals] undo failed', cause)
    return c.json({ error: 'Failed to undo this change' }, 500)
  }
})

/**
 * The `kind='rule'` memories that were active during the run that authored this
 * proposal — provenance for the "Rules active during this run" badge. Scoped exactly
 * like reject: load the proposal in the caller's tenants first (404 when not theirs),
 * then join its `run_id` to the non-suppressed rule attributions. A holdout run logged
 * its attributions `suppressed=true` (memory was NOT applied), so a holdout-run proposal
 * correctly returns NO rules. Empty array (never 404) when the proposal has no `run_id`
 * or no rule attributions.
 */
proposalsRoutes.get('/:id/active-rules', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})
  const id = c.req.param('id')

  try {
    const tenantIds = await callerTenantIds(sql, claims)
    if (tenantIds.length === 0) return c.json({ error: 'Not found' }, 404)

    const proposal = await getProposalScoped(sql, id, tenantIds)
    if (!proposal) return c.json({ error: 'Not found' }, 404)
    // No authoring run → nothing could have been injected. Not an error.
    if (!proposal.run_id) return c.json({ rules: [] })

    const rules = (await sql`
      select m.id, m.title
      from run_memory_attributions a
      join memories m on m.id = a.memory_id
      where a.run_id = ${proposal.run_id}
        and a.tenant_id = ${proposal.tenant_id}
        and m.tenant_id = ${proposal.tenant_id}
        and a.suppressed = false
        and m.kind = 'rule'
      order by a.rank asc
    `) as { id: string; title: string }[]
    return c.json({ rules })
  } catch (cause) {
    console.error('[proposals] active-rules query failed', cause)
    return c.json({ error: 'Failed to load active rules' }, 500)
  }
})

/**
 * The CURATOR VERDICT for a memory proposal — SAP's Global Memory Curator run before a
 * human decides (research rec #3, arXiv 2607.03228 §5.2). Two classes of check: is the
 * candidate well-formed on its own, and does it duplicate / overlap with / contradict a
 * memory already in this tenant — naming the specific colliding memory.
 *
 * ADVISORY. A GET that writes nothing and is not reachable from the accept path, so it
 * cannot auto-accept, auto-reject, or block. Its job is to stop the review gate becoming
 * a rubber stamp; a gate that decides for the human would not be a gate at all.
 *
 * Scoped exactly like active-rules: load the proposal in the caller's tenants first (404
 * when not theirs), then curate against THAT tenant. The reviewer's own user id opens the
 * personal lane, so the verdict can only ever name a memory this reviewer may already
 * read; an unresolvable identity degrades to an org-only verdict (`private_lane_skipped`)
 * rather than a 500 or a widened lane.
 */
proposalsRoutes.get('/:id/curator', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})
  const id = c.req.param('id')

  try {
    const tenantIds = await callerTenantIds(sql, claims)
    if (tenantIds.length === 0) return c.json({ error: 'Not found' }, 404)

    const proposal = await getProposalScoped(sql, id, tenantIds)
    if (!proposal) return c.json({ error: 'Not found' }, 404)

    const reviewerUserId = await callerUserId(sql, claims)
    const verdict = await curateProposal(sql, proposal, {
      tenantId: proposal.tenant_id,
      reviewerUserId,
    })
    return c.json({ verdict })
  } catch (cause) {
    console.error('[proposals] curator verdict failed', cause)
    return c.json({ error: 'Failed to load the curator verdict' }, 500)
  }
})

/**
 * Reject a proposal: a human decision that terminally declines it (distinct from the
 * agent-side `failed`). Scoped + guarded — only a `pending` proposal the caller owns
 * can be rejected (404 when not theirs, 409 when already decided).
 */
proposalsRoutes.post('/:id/reject', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as { reason?: string }

  try {
    const tenantIds = await callerTenantIds(sql, claims)
    if (tenantIds.length === 0) return c.json({ error: 'Not found' }, 404)

    const proposal = await getProposalScoped(sql, id, tenantIds)
    if (!proposal) return c.json({ error: 'Not found' }, 404)
    if (proposal.status !== 'pending') {
      return c.json({ error: 'Proposal is no longer pending' }, 409)
    }

    const approverUserId = await callerUserId(sql, claims)
    if (!approverUserId) {
      console.error('[proposals] reject: tenant resolved but no user identity for subject')
      return c.json({ error: 'Failed to reject proposal' }, 500)
    }

    const rows = (await sql`
      update proposals
        set status = 'rejected', decided_by = ${approverUserId}, decided_at = now(),
            rejection_reason = ${body.reason ?? null}, updated_at = now()
      where id = ${id} and tenant_id = any(${tenantIds}) and status = 'pending'
      returning *
    `) as unknown[]
    // Lost a race to another decider between the read and the guarded write.
    if (rows.length === 0) return c.json({ error: 'Proposal is no longer pending' }, 409)
    return c.json(rows[0])
  } catch (cause) {
    console.error('[proposals] reject failed', cause)
    return c.json({ error: 'Failed to reject proposal' }, 500)
  }
})
