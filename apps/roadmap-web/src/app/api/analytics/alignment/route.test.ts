import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { GET } from './route'

const URL_WITH_PARAMS =
  'http://localhost/api/analytics/alignment?workspace_id=ws-1&team_id=team-1'

function membershipClient(membership: { id: string } | null) {
  const single = vi.fn(async () => ({ data: membership }))
  const eqUser = vi.fn(() => ({ single }))
  const eqTeam = vi.fn(() => ({ eq: eqUser }))
  const select = vi.fn(() => ({ eq: eqTeam }))
  const from = vi.fn(() => ({ select }))
  return { client: { from }, eqUser }
}

describe('GET /api/analytics/alignment auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 400 when workspace_id/team_id are missing', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue({ from: vi.fn() })
    const res = await GET(new NextRequest('http://localhost/api/analytics/alignment'))
    expect(res.status).toBe(400)
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue({ from: vi.fn() })
    getAuthClaims.mockResolvedValue(null)

    const res = await GET(new NextRequest(URL_WITH_PARAMS))

    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('scopes team membership by the claims subject and returns 403 for non-members', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    const { client, eqUser } = membershipClient(null)
    createClient.mockResolvedValue(client)

    const res = await GET(new NextRequest(URL_WITH_PARAMS))

    expect(res.status).toBe(403)
    expect(eqUser).toHaveBeenCalledWith('user_id', 'user-1')
  })
})
