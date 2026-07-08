import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))
const { approve, approveAll } = vi.hoisted(() => ({ approve: vi.fn(), approveAll: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))
vi.mock('@/lib/ai/agent-executor', () => ({ agentExecutor: { approve, approveAll } }))
vi.mock('@/lib/ai/tools/creation-tools', () => ({}))
vi.mock('@/lib/ai/tools/analysis-tools', () => ({}))
vi.mock('@/lib/ai/tools/optimization-tools', () => ({}))
vi.mock('@/lib/ai/tools/strategy-tools', () => ({}))

import { POST } from './route'

function req(body: unknown) {
  return new Request('http://localhost/api/ai/agent/approve', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// Flexible chain resolving single() per table.
function client(tables: Record<string, { data: unknown }>) {
  const from = vi.fn((table: string) => {
    const single = vi.fn(async () => {
      const row = tables[table]?.data ?? null
      return { data: row, error: row ? null : { message: 'not found' } }
    })
    const chain: Record<string, unknown> = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      single,
    }
    return chain
  })
  return { from }
}

describe('POST /api/ai/agent/approve auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
    approve.mockReset()
    approveAll.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue({ from: vi.fn() })
    getAuthClaims.mockResolvedValue(null)

    const res = await POST(req({ actionId: 'act-1' }))

    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 400 for an invalid request body', async () => {
    createClient.mockResolvedValue({ from: vi.fn() })
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })

    const res = await POST(req({}))

    expect(res.status).toBe(400)
  })

  it('returns 404 when the single action does not exist', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(client({ ai_action_history: { data: null } }))

    const res = await POST(req({ actionId: 'act-1' }))

    expect(res.status).toBe(404)
  })

  it('returns 400 when the action is not pending', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(
      client({ ai_action_history: { data: { team_id: 'team-1', status: 'completed' } } })
    )

    const res = await POST(req({ actionId: 'act-1' }))

    expect(res.status).toBe(400)
  })

  it('returns 403 when the claims subject is not a team member', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(
      client({
        ai_action_history: { data: { team_id: 'team-1', status: 'pending' } },
        team_members: { data: null },
      })
    )

    const res = await POST(req({ actionId: 'act-1' }))

    expect(res.status).toBe(403)
    expect(approve).not.toHaveBeenCalled()
  })
})
