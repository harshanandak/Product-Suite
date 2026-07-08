import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { GET } from './route'

const CLAIMS = { subject: 'user-1', email: 'u@e.com', provider: 'neon' }

// team_members lookup: from -> select -> eq -> order (awaited)
function teamsClient(result: { data: unknown; error: unknown }) {
  const order = vi.fn(async () => result)
  const eq = vi.fn(() => ({ order }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  return { from, eq }
}

describe('/api/user/teams auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue({ from: vi.fn() })
    getAuthClaims.mockResolvedValue(null)

    const res = await GET(new NextRequest('http://localhost/api/user/teams'))

    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('scopes the team query by the claims subject', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { from, eq } = teamsClient({ data: [], error: null })
    createClient.mockResolvedValue({ from })

    const res = await GET(new NextRequest('http://localhost/api/user/teams'))

    expect(res.status).toBe(200)
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('returns 500 when the query errors', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { from } = teamsClient({ data: null, error: { message: 'db down' } })
    createClient.mockResolvedValue({ from })

    const res = await GET(new NextRequest('http://localhost/api/user/teams'))

    expect(res.status).toBe(500)
  })
})
