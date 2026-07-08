import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { GET } from './route'

const CLAIMS = { subject: 'user-1', email: 'u@e.com', provider: 'neon' }

// team_members chain: from().select().eq().eq().single()
function membershipClient(membership: { id: string } | null) {
  const eqCalls: Array<[string, unknown]> = []
  const single = vi.fn(async () => ({ data: membership }))
  const eq2 = vi.fn((c: string, v: unknown) => {
    eqCalls.push([c, v])
    return { single }
  })
  const eq1 = vi.fn(() => ({ eq: eq2 }))
  const select = vi.fn(() => ({ eq: eq1 }))
  const from = vi.fn(() => ({ select }))
  return { client: { from }, eqCalls }
}

describe('GET /api/team/members auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue({ from: vi.fn() })
    getAuthClaims.mockResolvedValue(null)
    const res = await GET(new NextRequest('http://localhost/api/team/members?team_id=team-1'))
    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 400 when team_id is missing', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue({ from: vi.fn() })
    const res = await GET(new NextRequest('http://localhost/api/team/members'))
    expect(res.status).toBe(400)
  })

  it('scopes membership by the claims subject and returns 403 for non-members', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, eqCalls } = membershipClient(null)
    createClient.mockResolvedValue(client)
    const res = await GET(new NextRequest('http://localhost/api/team/members?team_id=team-1'))
    expect(res.status).toBe(403)
    expect(eqCalls).toContainEqual(['user_id', 'user-1'])
  })
})
