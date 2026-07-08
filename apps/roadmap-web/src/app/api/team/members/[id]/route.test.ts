import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { PATCH, DELETE } from './route'

type Result = { data: unknown; error?: unknown }

// Per-table result queues — team_members is queried several times per handler
// (target member, requester membership), so each single() shifts the next result.
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
      update: vi.fn(self),
      delete: vi.fn(self),
      single: vi.fn(resolve),
    })
    return chain
  })
  return { client: { from }, eqCalls }
}

const CLAIMS = { subject: 'user-1', email: 'u@e.com', provider: 'neon' }
const params = { params: Promise.resolve({ id: 'm-2' }) }
const patchReq = (body: unknown = { role: 'member' }) =>
  new NextRequest('http://localhost/api/team/members/m-2', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
const delReq = () => new NextRequest('http://localhost/api/team/members/m-2', { method: 'DELETE' })

// A different user than the caller (subject user-1)
const TARGET = { data: { id: 'm-2', team_id: 'team-1', user_id: 'user-2', role: 'member' } }

describe('PATCH /api/team/members/[id] auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient({}).client)
    getAuthClaims.mockResolvedValue(null)
    const res = await PATCH(patchReq(), params)
    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 400 for an invalid role', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(makeClient({}).client)
    const res = await PATCH(patchReq({ role: 'superadmin' }), params)
    expect(res.status).toBe(400)
  })

  it('returns 404 when the target member does not exist', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(makeClient({ team_members: { data: null, error: { message: 'x' } } }).client)
    const res = await PATCH(patchReq(), params)
    expect(res.status).toBe(404)
  })

  it('returns 400 when the caller targets their own role (matched via claims subject)', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(
      makeClient({ team_members: { data: { id: 'm-2', team_id: 'team-1', user_id: 'user-1', role: 'member' } } }).client
    )
    const res = await PATCH(patchReq(), params)
    expect(res.status).toBe(400)
  })

  it('scopes requester membership by the claims subject and returns 403 for non-members', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, eqCalls } = makeClient({ team_members: [TARGET, { data: null }] })
    createClient.mockResolvedValue(client)
    const res = await PATCH(patchReq(), params)
    expect(res.status).toBe(403)
    expect(eqCalls).toContainEqual(['team_members', 'user_id', 'user-1'])
  })

  it('returns 403 when a non-owner attempts a role change', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(makeClient({ team_members: [TARGET, { data: { role: 'admin' } }] }).client)
    const res = await PATCH(patchReq(), params)
    expect(res.status).toBe(403)
  })
})

describe('DELETE /api/team/members/[id] auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient({}).client)
    getAuthClaims.mockResolvedValue(null)
    const res = await DELETE(delReq(), params)
    expect(res.status).toBe(401)
  })

  it('returns 404 when the target member does not exist', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(makeClient({ team_members: { data: null, error: { message: 'x' } } }).client)
    const res = await DELETE(delReq(), params)
    expect(res.status).toBe(404)
  })

  it('scopes requester membership by the claims subject and returns 403 for non-members', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, eqCalls } = makeClient({ team_members: [TARGET, { data: null }] })
    createClient.mockResolvedValue(client)
    const res = await DELETE(delReq(), params)
    expect(res.status).toBe(403)
    expect(eqCalls).toContainEqual(['team_members', 'user_id', 'user-1'])
  })
})
