import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { GET } from './route'

const CLAIMS = { subject: 'user-1', email: 'u@e.com', provider: 'neon' }
const PARAMS = { params: Promise.resolve({ reviewLinkId: 'rl-1' }) }

// Dispatch supabase chains by table name.
function makeClient(opts: {
  reviewLink: { data: unknown; error?: unknown }
  teamMember: { id: string } | null
}) {
  const eqUser = vi.fn()
  const from = vi.fn((table: string) => {
    if (table === 'review_links') {
      const single = vi.fn(async () => opts.reviewLink)
      const eq = vi.fn(() => ({ single }))
      const select = vi.fn(() => ({ eq }))
      return { select }
    }
    if (table === 'team_members') {
      const single = vi.fn(async () => ({ data: opts.teamMember }))
      eqUser.mockImplementation(() => ({ single }))
      const eqTeam = vi.fn(() => ({ eq: eqUser }))
      const select = vi.fn(() => ({ eq: eqTeam }))
      return { select }
    }
    // feedback list
    const order = vi.fn(async () => ({ data: [] }))
    const eq = vi.fn(() => ({ order }))
    const select = vi.fn(() => ({ eq }))
    return { select }
  })
  return { client: { from }, eqUser }
}

const REVIEW_LINK_OK = {
  data: { id: 'rl-1', workspaces: { team_id: 'team-1', name: 'WS' } },
}

describe('GET /api/feedback/by-review/[reviewLinkId] auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue({ from: vi.fn() })
    getAuthClaims.mockResolvedValue(null)

    const res = await GET(new Request('http://localhost/api/feedback/by-review/rl-1'), PARAMS)

    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 404 when the review link is not found', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client } = makeClient({
      reviewLink: { data: null, error: { message: 'not found' } },
      teamMember: null,
    })
    createClient.mockResolvedValue(client)

    const res = await GET(new Request('http://localhost/api/feedback/by-review/rl-1'), PARAMS)

    expect(res.status).toBe(404)
  })

  it('returns 403 when the claims subject is not a team member', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, eqUser } = makeClient({
      reviewLink: REVIEW_LINK_OK,
      teamMember: null,
    })
    createClient.mockResolvedValue(client)

    const res = await GET(new Request('http://localhost/api/feedback/by-review/rl-1'), PARAMS)

    expect(res.status).toBe(403)
    expect(eqUser).toHaveBeenCalledWith('user_id', 'user-1')
  })
})
