import { Hono } from 'hono'

import type { UIMessage } from 'ai'

import { agentModel } from '../agent/models'
import { runAgentChat, type AgentScope } from '../agent/runtime'
import { createThread, getThreadScoped, titleFromFirstMessage } from '../agent/threads-repository'
import { callerTenantIds, callerUserId } from '../auth/tenant-scope'
import { sqlFrom } from '../db'
import type { AuthedEnv } from '../middleware/clerk-auth'

export const agentChatRoutes = new Hono<AuthedEnv>()

/**
 * Validate the client-supplied object-scoping `context`. Trust nothing: keep it
 * only when `workspace` is a string, and the optional `object` only when all
 * three of its string fields are present. Any other shape ⇒ undefined (ignored),
 * never a throw — a malformed context must not fail an otherwise-valid run.
 */
function parseScope(raw: unknown): AgentScope | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const candidate = raw as { workspace?: unknown; object?: unknown }
  if (typeof candidate.workspace !== 'string') return undefined
  const scope: AgentScope = { workspace: candidate.workspace }
  const object = candidate.object
  if (object && typeof object === 'object') {
    const o = object as { type?: unknown; id?: unknown; title?: unknown }
    if (typeof o.type === 'string' && typeof o.id === 'string' && typeof o.title === 'string') {
      scope.object = { type: o.type, id: o.id, title: o.title }
    }
  }
  return scope
}

/**
 * The moat loop, provable end-to-end: a chat prompt runs the agent, which reads the
 * workboard and PROPOSES work-item changes into the PR1 queue — accepting a
 * proposal is the single validated write path. The agent's authority IS the
 * chatting user's Clerk identity (no agent token): reads are scoped to the orgs the
 * user belongs to, and every proposal is stamped on_behalf_of that user.
 *
 * 401 without a token (the mounted `clerkAuth` gate). 403 when the caller is in no
 * org. The response is the streamed UI message stream from `runAgentChat`.
 */
agentChatRoutes.post('/', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})

  try {
    const tenantIds = await callerTenantIds(sql, claims)
    if (tenantIds.length === 0) {
      return c.json({ error: 'No active organization' }, 403)
    }

    const body = (await c.req.json().catch(() => ({}))) as {
      messages?: UIMessage[]
      org_id?: string
      thread_id?: string
      context?: unknown
    }

    // Anchor the ENTIRE run to ONE org: reads, retrieval, and proposals all scope to
    // this single tenant, so nothing crosses tenants. Use the requested `org_id` when
    // the caller belongs to it; else the sole org; else refuse as ambiguous.
    let tenantId: string
    if (body.org_id && tenantIds.includes(body.org_id)) {
      tenantId = body.org_id
    } else if (body.org_id) {
      // A requested org the caller is not a member of — treat as ambiguous, never
      // silently fall through to another org.
      return c.json({ error: 'Ambiguous organization; specify org_id' }, 400)
    } else if (tenantIds.length === 1) {
      tenantId = tenantIds[0]!
    } else {
      return c.json({ error: 'Ambiguous organization; specify org_id' }, 400)
    }

    // The human the agent acts on behalf of. Any caller who passed tenant scoping
    // resolves here; a null is a server-side integrity anomaly, not a client error.
    const userId = await callerUserId(sql, claims)
    if (!userId) {
      console.error('[agent-chat] tenant resolved but no user identity for subject')
      return c.json({ error: 'Failed to start agent run' }, 500)
    }

    const messages = body.messages
    if (!Array.isArray(messages) || messages.length === 0) {
      return c.json({ error: 'messages is required' }, 400)
    }

    // Workers `executionCtx.waitUntil`, when reachable, keeps the run's persistence
    // alive past the response. The getter throws off-Workers, so guard it.
    let waitUntil: ((promise: Promise<unknown>) => void) | undefined
    try {
      const ec = c.executionCtx
      if (ec && typeof ec.waitUntil === 'function') waitUntil = ec.waitUntil.bind(ec)
    } catch {
      waitUntil = undefined
    }

    const model = agentModel(c.env ?? {})
    const scope = parseScope(body.context)

    // The SERVER owns thread creation — kills the first-message race STRUCTURALLY (no
    // client-create-then-save). With a `thread_id`, verify it belongs to THIS org
    // (a foreign/unknown id ⇒ 404, never a cross-tenant write). Without one, mint a
    // thread anchored to this org, titled from the first user message (NOT an LLM
    // call), linked to the scoping object; return its id so the client can send it
    // on later turns.
    let threadId: string
    if (body.thread_id) {
      const existing = await getThreadScoped(sql, body.thread_id, [tenantId])
      if (!existing) return c.json({ error: 'Not found' }, 404)
      threadId = existing.id
    } else {
      threadId = await createThread(sql, {
        tenantId,
        title: titleFromFirstMessage(messages),
        linkedObject: scope?.object ?? null,
      })
    }

    const res = await runAgentChat(sql, { tenantId, userId, model, waitUntil, scope, threadId }, messages)
    // Hand the thread id back to the client (the new-thread flow reads it and sends
    // it on subsequent turns). Exposed for cross-origin reads by the SPA.
    res.headers.set('x-thread-id', threadId)
    res.headers.set('Access-Control-Expose-Headers', 'x-thread-id')
    return res
  } catch (cause) {
    console.error('[agent-chat] run failed', cause)
    return c.json({ error: 'Failed to start agent run' }, 500)
  }
})
