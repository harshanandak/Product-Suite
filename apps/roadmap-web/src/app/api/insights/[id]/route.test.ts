import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { GET, PATCH, DELETE } from './route'

type Result = { data: unknown; error?: unknown }

// Flexible Supabase client: chain methods return `this`; `.single()` resolves the
// per-table configured result. Captures eq() calls so tests can assert the
// membership query is scoped by the claims subject.
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
      order: vi.fn(self),
      range: vi.fn(self),
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
const req = (method = 'GET') =>
  new NextRequest('http://localhost/api/insights/insight-1', {
    method,
    ...(method === 'GET' ? {} : { body: '{}', headers: { 'content-type': 'application/json' } }),
  })

describe.each([
  ['GET', GET],
  ['PATCH', PATCH],
  ['DELETE', DELETE],
] as const)('%s /api/insights/[id] auth', (method, handler) => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient({}).client)
    getAuthClaims.mockResolvedValue(null)
    const res = await handler(req(method), params)
    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 404 when the insight does not exist', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(
      makeClient({ customer_insights: { data: null, error: { message: 'x' } } }).client
    )
    const res = await handler(req(method), params)
    expect(res.status).toBe(404)
  })

  it('scopes membership by the claims subject and returns 403 for non-members', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, eqCalls } = makeClient({
      customer_insights: { data: { id: 'insight-1', team_id: 'team-1' } },
      team_members: { data: null },
    })
    createClient.mockResolvedValue(client)
    const res = await handler(req(method), params)
    expect(res.status).toBe(403)
    expect(eqCalls).toContainEqual(['team_members', 'user_id', 'user-1'])
  })
})

describe('DELETE /api/insights/[id] admin gate', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 403 when a non-admin member attempts deletion', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(
      makeClient({
        customer_insights: { data: { id: 'insight-1', team_id: 'team-1' } },
        team_members: { data: { role: 'member' } },
      }).client
    )
    const res = await DELETE(req('DELETE'), params)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/admin/i)
  })
})
