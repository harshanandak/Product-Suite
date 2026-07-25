import { Hono } from 'hono'

import { callerTenantIds } from '../auth/tenant-scope'
import { sqlFrom } from '../db'
import { listMeetingCandidates } from '../meeting/candidates'
import { meetingTenantMapFrom, resolveMeetingAnchor } from '../meeting/request-scope'
import type { AuthedEnv } from '../middleware/clerk-auth'

/**
 * The read behind the meeting triage screen: this org's promoted action items,
 * each with its TRUE promotion state (unpromoted / proposal pending / accepted /
 * dismissed) plus the proposal and work-item ids to link to.
 *
 * Separate from the ingest route because it is a different verb on a different
 * resource — the ingest's summary counts cannot back a list, and conflating them
 * would make an idempotent read share a path with a write.
 */
export const meetingCandidatesRoutes = new Hono<AuthedEnv>()

/** GET /api/agent/meeting-candidates?org_id=… — tenant-scoped candidate list. */
meetingCandidatesRoutes.get('/', async (c) => {
  const claims = c.get('claims')
  const env = c.env ?? {}
  const sql = sqlFrom(env)

  try {
    const tenantIds = await callerTenantIds(sql, claims)
    const anchor = resolveMeetingAnchor(tenantIds, c.req.query('org_id'))
    if (!anchor.ok) {
      return anchor.status === 403
        ? c.json({ error: 'Not a member of that organization' }, 403)
        : c.json({ error: 'Ambiguous organization; specify org_id' }, 400)
    }

    const candidates = await listMeetingCandidates(sql, {
      tenantId: anchor.tenantId,
      tenantMap: meetingTenantMapFrom(env),
    })
    return c.json({ candidates })
  } catch (cause) {
    console.error('[meeting-candidates] read failed', cause)
    return c.json({ error: 'Failed to read meeting candidates' }, 500)
  }
})
