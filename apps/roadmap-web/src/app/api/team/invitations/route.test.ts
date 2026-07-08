import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { GET, POST } from './route'

type Result = { data: unknown; error?: unknown }

function makeClient(results: Record<string, Result | Result[]>) {
  const eqCalls: Array<[string, string, unknown]> = []
  const queues: Record<string, Result[]> = {}
  for (const [k, v] of Object.entries(results)) queues[k] = Array.isArray(v) ? [...v] : [v]
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {}
    const self = () => chain
    const resolve = async () => {
      const q = queues[table]
      if (q && q.length > 1) return q.shift() as Result
      return (q && q[0]) ?? { data: null }
    }
    Object.assign(chain, {
      select: vi.fn(self),
      eq: vi.fn((col: string, val: unknown) => {
        eqCalls.push([table, col, val])
        return chain
      }),
      is: vi.fn(self),
      gt: vi.fn(self),
      order: vi.fn(self),
      insert: vi.fn(self),
      single: vi.fn(resolve),
      maybeSingle: vi.fn(resolve),
    })
    return chain
  })
  return { client: { from }, eqCalls }
}

const CLAIMS = { subject: 'user-1', email: 'u@e.com', provider: 'neon' }
const getUrl = (qs = '?team_id=team-1') => new NextRequest(`http://localhost/api/team/invitations${qs}`)
const postReq = (body: unknown) =>
  new NextRequest('http://localhost/api/team/invitations', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
const VALID_BODY = { team_id: 'team-1', email: 'new@e.com', role: 'member' }

describe('GET /api/team/invitations auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient({}).client)
    getAuthClaims.mockResolvedValue(null)
    const res = await GET(getUrl())
    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 400 when team_id is missing', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(makeClient({}).client)
    const res = await GET(getUrl(''))
    expect(res.status).toBe(400)
  })

  it('scopes membership by the claims subject and returns 403 for non-members', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, eqCalls } = makeClient({ team_members: { data: null } })
    createClient.mockResolvedValue(client)
    const res = await GET(getUrl())
    expect(res.status).toBe(403)
    expect(eqCalls).toContainEqual(['team_members', 'user_id', 'user-1'])
  })
})

describe('POST /api/team/invitations auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient({}).client)
    getAuthClaims.mockResolvedValue(null)
    const res = await POST(postReq(VALID_BODY))
    expect(res.status).toBe(401)
  })

  it('returns 400 for an invalid request body', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(makeClient({}).client)
    const res = await POST(postReq({ team_id: 'team-1' }))
    expect(res.status).toBe(400)
  })

  it('scopes membership by the claims subject and returns 403 for non-members', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, eqCalls } = makeClient({ team_members: { data: null } })
    createClient.mockResolvedValue(client)
    const res = await POST(postReq(VALID_BODY))
    expect(res.status).toBe(403)
    expect(eqCalls).toContainEqual(['team_members', 'user_id', 'user-1'])
  })

  it('returns 403 when a non-admin member attempts to invite', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(makeClient({ team_members: { data: { role: 'member' } } }).client)
    const res = await POST(postReq(VALID_BODY))
    expect(res.status).toBe(403)
  })
})
