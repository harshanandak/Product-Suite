import { Hono } from 'hono'

import { computeMemoryImpact } from '../agent/memory-impact'
import { callerTenantIds } from '../auth/tenant-scope'
import { sqlFrom } from '../db'
import type { AuthedEnv } from '../middleware/clerk-auth'

/**
 * Memory-impact metric API: exposes {@link computeMemoryImpact} to the web surface.
 * Anchored to ONE org per request (mirrors the chat/threads/reflection routes), so
 * the comparison never crosses tenants.
 */
export const agentMemoryImpactRoutes = new Hono<AuthedEnv>()

const DEFAULT_WINDOW_DAYS = 30
const MIN_WINDOW_DAYS = 1
const MAX_WINDOW_DAYS = 365

/**
 * Resolve the single org the metric anchors to: the requested `org_id` when the
 * caller belongs to it, else their sole org, else ambiguous. Mirrors the chat/threads
 * routes.
 */
function resolveAnchor(
  tenantIds: string[],
  orgId: string | undefined,
): { ok: true; tenantId: string } | { ok: false } {
  if (orgId && tenantIds.includes(orgId)) return { ok: true, tenantId: orgId }
  if (orgId) return { ok: false }
  if (tenantIds.length === 1) return { ok: true, tenantId: tenantIds[0]! }
  return { ok: false }
}

/** Parse the `window` query param: an integer, default 30, clamped to 1..365. */
function parseWindow(raw: string | undefined): number {
  const n = raw ? Number.parseInt(raw, 10) : NaN
  if (!Number.isFinite(n)) return DEFAULT_WINDOW_DAYS
  return Math.min(MAX_WINDOW_DAYS, Math.max(MIN_WINDOW_DAYS, n))
}

/**
 * GET /api/agent/memory-impact?window=30 — does memory measurably reduce the human
 * editing burden vs. the holdout cohort, over the trailing `window` days? 403 when the
 * caller belongs to no org; 400 when a multi-org caller does not disambiguate.
 */
agentMemoryImpactRoutes.get('/', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})

  try {
    const tenantIds = await callerTenantIds(sql, claims)
    if (tenantIds.length === 0) return c.json({ error: 'No active organization' }, 403)

    const anchor = resolveAnchor(tenantIds, c.req.query('org_id'))
    if (!anchor.ok) return c.json({ error: 'Ambiguous organization; specify org_id' }, 400)

    const windowDays = parseWindow(c.req.query('window'))
    const result = await computeMemoryImpact(sql, [anchor.tenantId], windowDays)
    return c.json(result)
  } catch (cause) {
    console.error('[agent-memory-impact] compute failed', cause)
    return c.json({ error: 'Failed to compute memory impact' }, 500)
  }
})
