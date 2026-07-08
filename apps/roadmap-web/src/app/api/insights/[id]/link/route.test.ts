import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { POST, DELETE } from './route'

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

const CLAIMS = { subject: 'user-1', email: 'u@e.com', provider: 'neon' }
const params = { params: Promise.resolve({ id: 'insight-1' }) }
const postReq = (body: unknown) =>
  new NextRequest('http://localhost/api/insights/insight-1/link', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
const deleteReq = (query = '') =>
  new NextRequest(`http://localhost/api/insights/insight-1/link${query}`, { method: 'DELETE' })

const INSIGHT = { customer_insights: { data: { id: 'insight-1', team_id: 'team-1' } } }

describe('POST /api/insights/[id]/link auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 400 when work_item_id is missing', async () => {
    createClient.mockResolvedValue(makeClient({}).client)
    const res = await POST(postReq({}), params)
    expect(res.status).toBe(400)
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    getAuthClaims.mockResolvedValue(null)
    createClient.mockResolvedValue(makeClient({}).client)
    const res = await POST(postReq({ work_item_id: 'wi-1' }), params)
    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 404 when the insight does not exist', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(
      makeClient({ customer_insights: { data: null, error: { message: 'x' } } }).client
    )
    const res = await POST(postReq({ work_item_id: 'wi-1' }), params)
    expect(res.status).toBe(404)
  })

  it('scopes membership by the claims subject and returns 403 for non-members', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, eqCalls } = makeClient({ ...INSIGHT, team_members: { data: null } })
    createClient.mockResolvedValue(client)
    const res = await POST(postReq({ work_item_id: 'wi-1' }), params)
    expect(res.status).toBe(403)
    expect(eqCalls).toContainEqual(['team_members', 'user_id', 'user-1'])
  })
})

describe('DELETE /api/insights/[id]/link auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 400 when work_item_id query param is missing', async () => {
    createClient.mockResolvedValue(makeClient({}).client)
    const res = await DELETE(deleteReq(), params)
    expect(res.status).toBe(400)
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    getAuthClaims.mockResolvedValue(null)
    createClient.mockResolvedValue(makeClient({}).client)
    const res = await DELETE(deleteReq('?work_item_id=wi-1'), params)
    expect(res.status).toBe(401)
  })

  it('returns 404 when the link does not exist', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(
      makeClient({ work_item_insights: { data: null, error: { message: 'x' } } }).client
    )
    const res = await DELETE(deleteReq('?work_item_id=wi-1'), params)
    expect(res.status).toBe(404)
  })

  it('scopes membership by the claims subject and returns 403 for non-members', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, eqCalls } = makeClient({
      work_item_insights: { data: { id: 'link-1', team_id: 'team-1' } },
      team_members: { data: null },
    })
    createClient.mockResolvedValue(client)
    const res = await DELETE(deleteReq('?work_item_id=wi-1'), params)
    expect(res.status).toBe(403)
    expect(eqCalls).toContainEqual(['team_members', 'user_id', 'user-1'])
  })
})
