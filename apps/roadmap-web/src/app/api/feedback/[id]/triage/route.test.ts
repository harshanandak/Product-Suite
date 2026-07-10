import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { POST } from './route'

const CLAIMS = { subject: 'user-1', email: 'u@e.com', provider: 'neon' }
const PARAMS = { params: Promise.resolve({ id: 'f-1' }) }

// team_members lookup chain: from().select().eq().single()
function teamClient(teamMember: { team_id: string } | null) {
  const single = vi.fn(async () => ({ data: teamMember }))
  const eq = vi.fn(() => ({ single }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  return { client: { from }, eq }
}

function jsonReq(body: unknown) {
  return new Request('http://localhost/api/feedback/f-1/triage', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/feedback/[id]/triage auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue({ from: vi.fn() })
    getAuthClaims.mockResolvedValue(null)

    const res = await POST(jsonReq({}), PARAMS)

    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 404 when the claims subject has no team', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, eq } = teamClient(null)
    createClient.mockResolvedValue(client)

    const res = await POST(jsonReq({ decision: 'defer' }), PARAMS)

    expect(res.status).toBe(404)
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('returns 400 for an invalid decision', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client } = teamClient({ team_id: 'team-1' })
    createClient.mockResolvedValue(client)

    const res = await POST(jsonReq({ decision: 'nope' }), PARAMS)

    expect(res.status).toBe(400)
  })
})
