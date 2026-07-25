import { Hono } from 'hono'

import { callerTenantIds } from '../auth/tenant-scope'
import { sqlFrom } from '../db'
import { runMeetingIngest } from '../meeting/ingest'
import { meetingTenantMapFrom, resolveMeetingAnchor } from '../meeting/request-scope'
import type { AuthedEnv } from '../middleware/clerk-auth'

/**
 * Meeting ingest: turn promoted meeting action items into pending proposals in the
 * SAME review queue as every other agent proposal. Nothing reaches the board
 * without a human accepting it.
 *
 * HUMAN-TRIGGERED ONLY in this slice — there is deliberately no cron or scheduled
 * trigger. A background job that quietly files proposals is only worth having once
 * a human has watched the ingest behave; until then the button is the safety.
 *
 * Anchored to ONE org per call (mirrors the chat/threads/reflection routes), so
 * nothing crosses tenants.
 */
export const meetingIngestRoutes = new Hono<AuthedEnv>()

/**
 * POST /api/agent/meeting-ingest — propose the promoted action items this org has
 * not already had proposed.
 *
 * The response reports the two skip reasons alongside the created count. The
 * unmapped-tenant count especially: a fail-closed tenant map that reports nothing
 * is indistinguishable from a correctly-configured one, and "why did no proposals
 * appear" has to be answerable without database access.
 */
meetingIngestRoutes.post('/', async (c) => {
  const claims = c.get('claims')
  const env = c.env ?? {}
  const sql = sqlFrom(env)

  try {
    const tenantIds = await callerTenantIds(sql, claims)
    const body = (await c.req.json().catch(() => ({}))) as { org_id?: string }
    const anchor = resolveMeetingAnchor(tenantIds, body.org_id)
    if (!anchor.ok) {
      return anchor.status === 403
        ? c.json({ error: 'Not a member of that organization' }, 403)
        : c.json({ error: 'Ambiguous organization; specify org_id' }, 400)
    }

    const result = await runMeetingIngest(sql, {
      tenantId: anchor.tenantId,
      tenantMap: meetingTenantMapFrom(env),
    })

    return c.json({
      proposalsCreated: result.proposalsCreated,
      skippedDuplicate: result.skippedDuplicate,
      skippedUnmappedTenant: result.skippedUnmappedTenant,
    })
  } catch (cause) {
    console.error('[meeting-ingest] run failed', cause)
    return c.json({ error: 'Failed to run meeting ingest' }, 500)
  }
})
