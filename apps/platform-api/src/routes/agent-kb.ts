import { Hono } from 'hono'

import { embed as embedClient } from '../agent/embeddings'
import { ingestKnowledge } from '../agent/kb-ingest'
import { callerTenantIds } from '../auth/tenant-scope'
import { sqlFrom } from '../db'
import type { AuthedEnv } from '../middleware/clerk-auth'

/**
 * KB ingestion (Memory Brain P3a §4B): backfill memory embeddings + ingest past
 * completed work-items as project-scoped `knowledge_chunks`. On-demand (like the
 * reflection route); scheduling is deferred. Anchored to ONE org per run so nothing
 * crosses tenants. The real OpenRouter `embed` client is built from the request env
 * and injected into {@link ingestKnowledge} (tests inject a mock instead).
 */
export const agentKbRoutes = new Hono<AuthedEnv>()

/**
 * Resolve the single org the run anchors to: the requested `org_id` when the caller
 * belongs to it, else their sole org, else ambiguous. Mirrors the reflection route.
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

/**
 * POST /api/agent/kb/ingest — backfill memory embeddings + ingest completed
 * work-items as chunks. 403 when the caller belongs to no org; 400 when a
 * multi-org caller does not disambiguate. Response = the {@link ingestKnowledge}
 * counts `{ memoriesEmbedded, chunksIngested }`.
 */
agentKbRoutes.post('/ingest', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})

  try {
    const tenantIds = await callerTenantIds(sql, claims)
    if (tenantIds.length === 0) return c.json({ error: 'No active organization' }, 403)

    const body = (await c.req.json().catch(() => ({}))) as { org_id?: string }
    const anchor = resolveAnchor(tenantIds, body.org_id)
    if (!anchor.ok) return c.json({ error: 'Ambiguous organization; specify org_id' }, 400)

    const env = c.env ?? {}
    const embed = (texts: string[]) => embedClient(texts, env)

    const result = await ingestKnowledge(sql, { tenantId: anchor.tenantId, embed })
    return c.json(result)
  } catch (cause) {
    console.error('[agent-kb] ingest failed', cause)
    return c.json({ error: 'Failed to ingest knowledge' }, 500)
  }
})
