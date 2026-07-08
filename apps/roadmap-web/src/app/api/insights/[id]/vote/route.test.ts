import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { GET, POST } from './route'

type Result = { data: unknown; error?: unknown }

function makeClient(results: Record<string, Result>) {
  const eqCalls: Array<[string, string, unknown]> = []
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {}
    const self = () => chain
    Object.assign(chain, {
      select: vi.fn(self),
      eq: vi.fn((col: string, val: unknown) => {
        eqCalls.push([table, col, val])
        return chain
      }),
      in: vi.fn(self),
      update: vi.fn(self),
      insert: vi.fn(self),
      delete: vi.fn(self),
      single: vi.fn(async () => results[table] ?? { data: null }),
    })
    return chain
  })
  return { client: { from }, eqCalls }
}

const params = { params: Promise.resolve({ id: 'insight-1' }) }
const postReq = (body: unknown) =>
  new NextRequest('http://localhost/api/insights/insight-1/vote', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

const INSIGHT = { customer_insights: { data: { id: 'insight-1', team_id: 'team-1' } } }

describe('POST /api/insights/[id]/vote auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 400 for an invalid vote_type', async () => {
    createClient.mockResolvedValue(makeClient({}).client)
    const res = await POST(postReq({ vote_type: 'sideways' }), params)
    expect(res.status).toBe(400)
  })

  it('returns 404 when the insight does not exist', async () => {
    createClient.mockResolvedValue(
      makeClient({ customer_insights: { data: null, error: { message: 'x' } } }).client
    )
    const res = await POST(postReq({ vote_type: 'upvote' }), params)
    expect(res.status).toBe(404)
  })

  it('scopes membership by the claims subject and returns 403 for authenticated non-members', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    const { client, eqCalls } = makeClient({ ...INSIGHT, team_members: { data: null } })
    createClient.mockResolvedValue(client)
    const res = await POST(postReq({ vote_type: 'upvote' }), params)
    expect(res.status).toBe(403)
    expect(eqCalls).toContainEqual(['team_members', 'user_id', 'user-1'])
  })

  it('returns 400 for an external voter (no claims) missing voter_email', async () => {
    getAuthClaims.mockResolvedValue(null)
    createClient.mockResolvedValue(makeClient({ ...INSIGHT }).client)
    const res = await POST(postReq({ vote_type: 'upvote' }), params)
    expect(res.status).toBe(400)
  })
})

describe('GET /api/insights/[id]/vote auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 400 when no voter can be determined (no claims, no voter_email)', async () => {
    getAuthClaims.mockResolvedValue(null)
    createClient.mockResolvedValue(makeClient({}).client)
    const res = await GET(
      new NextRequest('http://localhost/api/insights/insight-1/vote'),
      params
    )
    expect(res.status).toBe(400)
  })
})
