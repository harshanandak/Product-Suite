import { Hono } from 'hono'

import { callerTenantIds, callerUserId } from '../auth/tenant-scope'
import { sqlFrom } from '../db'
import type { AuthedEnv } from '../middleware/clerk-auth'
import { applyProposal } from '../proposals/apply'
import { getProposalScoped, listPending } from '../proposals/repository'

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
 * Accept a proposal: apply it EXACTLY ONCE through the domain command, attributed to
 * the agent run acting on behalf of THIS approver. `applyProposal` owns the
 * claim-then-command exactly-once gate; the route only maps its outcome to a status:
 * applied → 200, not_found → 404, not_pending|stale → 409, invalid → 422.
 */
proposalsRoutes.post('/:id/accept', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})
  const id = c.req.param('id')

  try {
    const tenantIds = await callerTenantIds(sql, claims)
    if (tenantIds.length === 0) return c.json({ error: 'Not found' }, 404)

    const approverUserId = await callerUserId(sql, claims)
    if (!approverUserId) {
      console.error('[proposals] accept: tenant resolved but no user identity for subject')
      return c.json({ error: 'Failed to accept proposal' }, 500)
    }

    const res = await applyProposal(sql, { tenantIds, approverUserId }, id)
    if (res.applied) return c.json(res.result, 200)
    switch (res.reason) {
      case 'not_found':
        return c.json({ error: 'Not found' }, 404)
      case 'not_pending':
        return c.json({ error: 'Proposal is no longer pending' }, 409)
      case 'stale':
        return c.json({ error: 'Target changed; proposal is stale' }, 409)
      case 'invalid':
        return c.json({ error: 'Proposal could not be applied' }, 422)
    }
  } catch (cause) {
    console.error('[proposals] accept failed', cause)
    return c.json({ error: 'Failed to accept proposal' }, 500)
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
