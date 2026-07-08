import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { GET, POST } from './route'

const URL = 'http://localhost/api/documents'

function teamClient(membership: { team_id: string } | null) {
  const single = vi.fn(async () => ({
    data: membership,
    error: membership ? null : { message: 'not found' },
  }))
  const eq = vi.fn(() => ({ single }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  return { client: { from }, eq }
}

const claims = { subject: 'user-1', email: 'u@e.com', provider: 'neon' }

describe('GET/POST /api/documents auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('GET returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue({ from: vi.fn() })
    getAuthClaims.mockResolvedValue(null)

    const res = await GET(new NextRequest(URL))

    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('GET returns 404 when the claims subject has no team membership', async () => {
    getAuthClaims.mockResolvedValue(claims)
    const { client, eq } = teamClient(null)
    createClient.mockResolvedValue(client)

    const res = await GET(new NextRequest(URL))

    expect(res.status).toBe(404)
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('POST returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue({ from: vi.fn() })
    getAuthClaims.mockResolvedValue(null)

    const res = await POST(new NextRequest(URL, { method: 'POST' }))

    expect(res.status).toBe(401)
  })

  it('POST returns 400 when no file is provided', async () => {
    getAuthClaims.mockResolvedValue(claims)
    createClient.mockResolvedValue(teamClient({ team_id: 'team-1' }).client)

    const form = new FormData()
    const res = await POST(new NextRequest(URL, { method: 'POST', body: form }))

    expect(res.status).toBe(400)
  })
})
