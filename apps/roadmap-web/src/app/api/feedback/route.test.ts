import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { GET, POST } from './route'

const CLAIMS = { subject: 'user-1', email: 'u@e.com', provider: 'neon' }

// team_members lookup chain: from().select().eq().single()
function teamClient(teamMember: { team_id: string } | null) {
  const single = vi.fn(async () => ({ data: teamMember }))
  const eq = vi.fn(() => ({ single }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  return { client: { from }, eq }
}

function jsonReq(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('GET /api/feedback auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue({ from: vi.fn() })
    getAuthClaims.mockResolvedValue(null)

    const res = await GET(new Request('http://localhost/api/feedback'))

    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('scopes team lookup by the claims subject and returns 404 when no team', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, eq } = teamClient(null)
    createClient.mockResolvedValue(client)

    const res = await GET(new Request('http://localhost/api/feedback'))

    expect(res.status).toBe(404)
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1')
  })
})

describe('POST /api/feedback auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue({ from: vi.fn() })
    getAuthClaims.mockResolvedValue(null)

    const res = await POST(jsonReq('http://localhost/api/feedback', {}))

    expect(res.status).toBe(401)
  })

  it('returns 404 when the claims subject has no team', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, eq } = teamClient(null)
    createClient.mockResolvedValue(client)

    const res = await POST(jsonReq('http://localhost/api/feedback', {}))

    expect(res.status).toBe(404)
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('returns 400 when required fields are missing', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client } = teamClient({ team_id: 'team-1' })
    createClient.mockResolvedValue(client)

    const res = await POST(jsonReq('http://localhost/api/feedback', {}))

    expect(res.status).toBe(400)
  })
})
