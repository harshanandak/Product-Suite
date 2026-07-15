import { Hono } from 'hono'

import { archiveThread, getThreadScoped, listThreads, reconstructThreadMessages } from '../agent/threads-repository'
import { callerTenantIds } from '../auth/tenant-scope'
import { sqlFrom } from '../db'
import type { AuthedEnv } from '../middleware/clerk-auth'

/**
 * Durable agent chat threads (see docs/design/2026-07-15-thread-persistence.md). A
 * thread groups the runs that produced it; its message history is DERIVED from those
 * runs' UIMessage deltas (no second write path). Everything is TENANT-SCOPED — a
 * SECURITY boundary: a foreign/unknown thread id resolves to 404, never a leak. The
 * panel list is anchored to ONE org (the caller's active org), mirroring how the chat
 * run and its proposals anchor.
 */
export const agentThreadsRoutes = new Hono<AuthedEnv>()

/**
 * Resolve the single org the list is anchored to: the requested `org_id` when the
 * caller belongs to it, else their sole org, else ambiguous. Mirrors the chat route
 * so a thread's list and its runs are one consistent org.
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

/** The caller's threads for one org: non-archived, newest first. */
agentThreadsRoutes.get('/', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})

  try {
    const tenantIds = await callerTenantIds(sql, claims)
    if (tenantIds.length === 0) return c.json([])
    const anchor = resolveAnchor(tenantIds, c.req.query('org_id'))
    // A multi-org caller who did not specify a valid org is ambiguous — never fan the
    // list out across orgs (that would surface another org's threads in the panel).
    if (!anchor.ok) return c.json({ error: 'Ambiguous organization; specify org_id' }, 400)
    const rows = await listThreads(sql, anchor.tenantId)
    return c.json(rows)
  } catch (cause) {
    console.error('[agent-threads] list failed', cause)
    return c.json({ error: 'Failed to load threads' }, 500)
  }
})

/**
 * The thread's reconstructed `UIMessage[]` history — what `useChat({ id, messages })`
 * rehydrates from. Tenant-checked: a thread that is not the caller's ⇒ 404.
 */
agentThreadsRoutes.get('/:id/messages', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})
  const id = c.req.param('id')

  try {
    const tenantIds = await callerTenantIds(sql, claims)
    if (tenantIds.length === 0) return c.json({ error: 'Not found' }, 404)
    const thread = await getThreadScoped(sql, id, tenantIds)
    if (!thread) return c.json({ error: 'Not found' }, 404)
    const messages = await reconstructThreadMessages(sql, id, thread.tenant_id)
    return c.json({ messages })
  } catch (cause) {
    console.error('[agent-threads] messages failed', cause)
    return c.json({ error: 'Failed to load thread' }, 500)
  }
})

/** Soft-delete (archive) a thread. Cross-tenant ⇒ 404 (rejected, never a leak). */
agentThreadsRoutes.post('/:id/archive', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})
  const id = c.req.param('id')

  try {
    const tenantIds = await callerTenantIds(sql, claims)
    if (tenantIds.length === 0) return c.json({ error: 'Not found' }, 404)
    const archived = await archiveThread(sql, id, tenantIds)
    if (!archived) return c.json({ error: 'Not found' }, 404)
    return c.json({ ok: true })
  } catch (cause) {
    console.error('[agent-threads] archive failed', cause)
    return c.json({ error: 'Failed to archive thread' }, 500)
  }
})
