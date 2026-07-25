import { Hono } from 'hono'

import { callerTenantIds } from '../auth/tenant-scope'
import { sqlFrom } from '../db'
import { runMeetingIngest } from '../meeting/ingest'
import { parseMeetingTenantMap } from '../meeting/tenant-map'
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

type Anchor = { ok: true; tenantId: string } | { ok: false; status: 400 | 403 }

/**
 * Resolve the single org this ingest anchors to. A requested org the caller does
 * NOT belong to is a 403 (a cross-tenant attempt, not an ambiguity); a multi-org
 * caller who names none is a 400 they can fix by naming one.
 */
function resolveAnchor(tenantIds: string[], orgId: string | undefined): Anchor {
  if (tenantIds.length === 0) return { ok: false, status: 403 }
  if (orgId !== undefined) {
    return tenantIds.includes(orgId) ? { ok: true, tenantId: orgId } : { ok: false, status: 403 }
  }
  if (tenantIds.length === 1) return { ok: true, tenantId: tenantIds[0]! }
  return { ok: false, status: 400 }
}

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
    const anchor = resolveAnchor(tenantIds, body.org_id)
    if (!anchor.ok) {
      return anchor.status === 403
        ? c.json({ error: 'Not a member of that organization' }, 403)
        : c.json({ error: 'Ambiguous organization; specify org_id' }, 400)
    }

    const tenantMap = parseMeetingTenantMap(
      (env as { MEETING_TENANT_MAP?: string }).MEETING_TENANT_MAP ?? process.env.MEETING_TENANT_MAP,
    )
    const result = await runMeetingIngest(sql, { tenantId: anchor.tenantId, tenantMap })

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
