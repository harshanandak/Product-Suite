import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { GET, POST } from './route'

const CLAIMS = { subject: 'user-1', email: 'u@e.com', provider: 'neon' }

// Self-chaining Supabase mock. Every builder method returns the same chain so
// any `.from().select().eq()...` sequence resolves; `single` is configurable.
function makeClient() {
  const chain: Record<string, unknown> = {}
  const single = vi.fn()
  const eq = vi.fn(() => chain)
  const pass = vi.fn(() => chain)
  Object.assign(chain, {
    select: pass, order: pass, or: pass, eq, single,
    insert: pass, update: pass, delete: pass, limit: pass, gte: pass, lte: pass,
  })
  const from = vi.fn(() => chain)
  return { client: { from }, single, eq }
}

function postReq(body: unknown) {
  return new NextRequest('http://localhost/api/templates', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('GET /api/templates', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient().client)
    getAuthClaims.mockResolvedValue(null)

    const res = await GET(new NextRequest('http://localhost/api/templates?team_id=team-1'))

    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('scopes membership by the claims subject and returns 403 for non-members', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, single, eq } = makeClient()
    single.mockResolvedValueOnce({ data: null })
    createClient.mockResolvedValue(client)

    const res = await GET(new NextRequest('http://localhost/api/templates?team_id=team-1'))

    expect(res.status).toBe(403)
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1')
  })
})

describe('POST /api/templates', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 400 when team_id is missing', async () => {
    createClient.mockResolvedValue(makeClient().client)
    const res = await POST(postReq({ name: 'T', mode: 'launch' }))
    expect(res.status).toBe(400)
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient().client)
    getAuthClaims.mockResolvedValue(null)
    const res = await POST(postReq({ team_id: 'team-1', name: 'T', mode: 'launch' }))
    expect(res.status).toBe(401)
  })

  it('returns 403 when the member is not an admin/owner', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, single, eq } = makeClient()
    single.mockResolvedValueOnce({ data: { role: 'member' } })
    createClient.mockResolvedValue(client)

    const res = await POST(postReq({ team_id: 'team-1', name: 'T', mode: 'launch' }))

    expect(res.status).toBe(403)
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1')
  })
})
