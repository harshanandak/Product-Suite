import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))
const { preview } = vi.hoisted(() => ({ preview: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))
vi.mock('@/lib/ai/agent-executor', () => ({ agentExecutor: { preview } }))

import { POST } from './route'

const VALID_BODY = {
  toolName: 'createWorkItem',
  params: {},
  workspaceId: 'ws-1',
  teamId: 'team-1',
}

function req(body: unknown) {
  return new Request('http://localhost/api/ai/agent/preview', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function membershipClient(member: { role: string } | null) {
  const single = vi.fn(async () => ({ data: member, error: member ? null : { message: 'x' } }))
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    single,
  }
  const from = vi.fn(() => chain)
  return { from }
}

describe('POST /api/ai/agent/preview auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
    preview.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue({ from: vi.fn() })
    getAuthClaims.mockResolvedValue(null)

    const res = await POST(req(VALID_BODY))

    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 400 for an invalid request body', async () => {
    createClient.mockResolvedValue({ from: vi.fn() })
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })

    const res = await POST(req({}))

    expect(res.status).toBe(400)
  })

  it('returns 403 when the claims subject is not a team member', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(membershipClient(null))

    const res = await POST(req(VALID_BODY))

    expect(res.status).toBe(403)
  })
})
