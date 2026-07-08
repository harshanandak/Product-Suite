import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { GET, PATCH, DELETE } from './route'

const CLAIMS = { subject: 'user-1', email: 'u@e.com', provider: 'neon' }
const ctx = { params: Promise.resolve({ id: 'int-1' }) }

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

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/integrations/int-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('/api/integrations/[id] auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('GET returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue({ from: vi.fn() })
    getAuthClaims.mockResolvedValue(null)

    const res = await GET(new NextRequest('http://localhost/api/integrations/int-1'), ctx)

    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('GET returns 404 and scopes team lookup by claims subject when no team', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { from, eq } = teamClient(null)
    createClient.mockResolvedValue({ from })

    const res = await GET(new NextRequest('http://localhost/api/integrations/int-1'), ctx)

    expect(res.status).toBe(404)
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('PATCH returns 400 for invalid status', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { from } = teamClient({ team_id: 'team-1' })
    createClient.mockResolvedValue({ from })

    const res = await PATCH(patchRequest({ status: 'bogus' }), ctx)

    expect(res.status).toBe(400)
  })

  it('DELETE returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue({ from: vi.fn() })
    getAuthClaims.mockResolvedValue(null)

    const res = await DELETE(new NextRequest('http://localhost/api/integrations/int-1'), ctx)

    expect(res.status).toBe(401)
  })
})
