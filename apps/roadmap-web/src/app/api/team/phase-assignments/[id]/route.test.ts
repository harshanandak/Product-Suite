import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { PATCH, DELETE } from './route'

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
      update: vi.fn(self),
      delete: vi.fn(self),
      single: vi.fn(resolve),
      maybeSingle: vi.fn(resolve),
    })
    return chain
  })
  return { client: { from }, eqCalls }
}

const CLAIMS = { subject: 'user-1', email: 'u@e.com', provider: 'neon' }
const params = { params: Promise.resolve({ id: 'pa-1' }) }
const patchReq = (body: unknown = { can_edit: true }) =>
  new NextRequest('http://localhost/api/team/phase-assignments/pa-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
const delReq = () =>
  new NextRequest('http://localhost/api/team/phase-assignments/pa-1', { method: 'DELETE' })

const ASSIGNMENT = { data: { id: 'pa-1', workspace_id: 'ws-1', workspace: { id: 'ws-1', team_id: 'team-1' } } }

describe('PATCH /api/team/phase-assignments/[id] auth', () => {
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

  it('returns 400 for an invalid request body', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(makeClient({}).client)
    const res = await PATCH(patchReq({ can_edit: 'nope' }), params)
    expect(res.status).toBe(400)
  })

  it('returns 404 when the assignment does not exist', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(makeClient({ user_phase_assignments: { data: null, error: { message: 'x' } } }).client)
    const res = await PATCH(patchReq(), params)
    expect(res.status).toBe(404)
  })

  it('scopes membership by the claims subject and returns 403 for non-members', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, eqCalls } = makeClient({ user_phase_assignments: ASSIGNMENT, team_members: { data: null } })
    createClient.mockResolvedValue(client)
    const res = await PATCH(patchReq(), params)
    expect(res.status).toBe(403)
    expect(eqCalls).toContainEqual(['team_members', 'user_id', 'user-1'])
  })

  it('returns 403 when a non-admin member attempts an update', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(makeClient({ user_phase_assignments: ASSIGNMENT, team_members: { data: { role: 'member' } } }).client)
    const res = await PATCH(patchReq(), params)
    expect(res.status).toBe(403)
  })
})

describe('DELETE /api/team/phase-assignments/[id] auth', () => {
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

  it('returns 404 when the assignment does not exist', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(makeClient({ user_phase_assignments: { data: null, error: { message: 'x' } } }).client)
    const res = await DELETE(delReq(), params)
    expect(res.status).toBe(404)
  })

  it('returns 403 when a non-admin member attempts a delete', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, eqCalls } = makeClient({ user_phase_assignments: ASSIGNMENT, team_members: { data: { role: 'member' } } })
    createClient.mockResolvedValue(client)
    const res = await DELETE(delReq(), params)
    expect(res.status).toBe(403)
    expect(eqCalls).toContainEqual(['team_members', 'user_id', 'user-1'])
  })
})
