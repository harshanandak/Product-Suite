import { Hono } from 'hono'

import type { UIMessage } from 'ai'

import { agentModel } from '../agent/models'
import { runAgentChat } from '../agent/runtime'
import { callerTenantIds, callerUserId } from '../auth/tenant-scope'
import { sqlFrom } from '../db'
import type { AuthedEnv } from '../middleware/clerk-auth'

export const agentChatRoutes = new Hono<AuthedEnv>()

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
    const tenantId = tenantIds[0]
    if (!tenantId) {
      return c.json({ error: 'No active organization' }, 403)
    }

    // The human the agent acts on behalf of. Any caller who passed tenant scoping
    // resolves here; a null is a server-side integrity anomaly, not a client error.
    const userId = await callerUserId(sql, claims)
    if (!userId) {
      console.error('[agent-chat] tenant resolved but no user identity for subject')
      return c.json({ error: 'Failed to start agent run' }, 500)
    }

    const body = (await c.req.json().catch(() => ({}))) as { messages?: UIMessage[] }
    const messages = body.messages
    if (!Array.isArray(messages) || messages.length === 0) {
      return c.json({ error: 'messages is required' }, 400)
    }

    const model = agentModel(c.env ?? {})
    return await runAgentChat(sql, { tenantIds, tenantId, userId, model }, messages)
  } catch (cause) {
    console.error('[agent-chat] run failed', cause)
    return c.json({ error: 'Failed to start agent run' }, 500)
  }
})
