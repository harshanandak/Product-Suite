import { Hono } from 'hono'

import type { AcceptResult } from '@product-suite/contracts'

import { callerTenantIds, callerUserId } from '../auth/tenant-scope'
import { sqlFrom } from '../db'
import type { AuthedEnv } from '../middleware/clerk-auth'
import { acceptHttpStatus, applyProposal } from '../proposals/apply'
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
      return c.json(
        { status: 'failed', proposal_id: id, message: 'No user identity for subject', retryable: false } satisfies AcceptResult,
        500,
      )
    }

    const res = await applyProposal(sql, { tenantIds, approverUserId }, id, editedPayload)
    return c.json(res, acceptHttpStatus(res.status))
  } catch (cause) {
    console.error('[proposals] accept failed', cause)
    // An unexpected error is a `failed` envelope (retryable) — the proposal stays pending.
    return c.json(
      { status: 'failed', proposal_id: id, message: 'Failed to accept proposal', retryable: true } satisfies AcceptResult,
      500,
    )
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
