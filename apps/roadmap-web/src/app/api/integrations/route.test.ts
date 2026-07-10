import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { GET, POST } from './route'

const CLAIMS = { subject: 'user-1', email: 'u@e.com', provider: 'neon' }

// team_members lookup: from -> select -> eq -> single
function teamClient(membership: { team_id: string } | null) {
  const single = vi.fn(async () => ({
    data: membership,
    error: membership ? null : { message: 'not found' },
  }))
  const eq = vi.fn(() => ({ single }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  return { from, eq }
}

function jsonRequest(body: unknown) {
  return new NextRequest('http://localhost/api/integrations', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('/api/integrations auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('GET returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue({ from: vi.fn() })
    getAuthClaims.mockResolvedValue(null)

    const res = await GET(new NextRequest('http://localhost/api/integrations'))

    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('GET scopes team lookup by claims subject and returns 404 when no team', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { from, eq } = teamClient(null)
    createClient.mockResolvedValue({ from })

    const res = await GET(new NextRequest('http://localhost/api/integrations'))

    expect(res.status).toBe(404)
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('POST returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue({ from: vi.fn() })
    getAuthClaims.mockResolvedValue(null)

    const res = await POST(jsonRequest({ provider: 'github' }))

    expect(res.status).toBe(401)
  })

  it('POST returns 400 when provider is missing', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { from } = teamClient({ team_id: 'team-1' })
    createClient.mockResolvedValue({ from })

    const res = await POST(jsonRequest({}))

    expect(res.status).toBe(400)
  })
})
