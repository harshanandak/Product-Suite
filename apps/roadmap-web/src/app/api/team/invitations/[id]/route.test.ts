import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { DELETE } from './route'

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
      delete: vi.fn(self),
      single: vi.fn(resolve),
    })
    return chain
  })
  return { client: { from }, eqCalls }
}

const CLAIMS = { subject: 'user-1', email: 'u@e.com', provider: 'neon' }
const params = { params: Promise.resolve({ id: 'inv-1' }) }
const req = () => new NextRequest('http://localhost/api/team/invitations/inv-1', { method: 'DELETE' })
const INVITATION = { data: { id: 'inv-1', team_id: 'team-1', invited_by: 'user-2', accepted_at: null } }

describe('DELETE /api/team/invitations/[id] auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient({}).client)
    getAuthClaims.mockResolvedValue(null)
    const res = await DELETE(req(), params)
    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 404 when the invitation does not exist', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(makeClient({ invitations: { data: null, error: { message: 'x' } } }).client)
    const res = await DELETE(req(), params)
    expect(res.status).toBe(404)
  })

  it('returns 400 when the invitation was already accepted', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(
      makeClient({ invitations: { data: { id: 'inv-1', team_id: 'team-1', invited_by: 'user-2', accepted_at: '2026-01-01' } } }).client
    )
    const res = await DELETE(req(), params)
    expect(res.status).toBe(400)
  })

  it('scopes membership by the claims subject and returns 403 for non-members', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, eqCalls } = makeClient({ invitations: INVITATION, team_members: { data: null } })
    createClient.mockResolvedValue(client)
    const res = await DELETE(req(), params)
    expect(res.status).toBe(403)
    expect(eqCalls).toContainEqual(['team_members', 'user_id', 'user-1'])
  })

  it('returns 403 when a non-inviter, non-admin member attempts to cancel', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(makeClient({ invitations: INVITATION, team_members: { data: { role: 'member' } } }).client)
    const res = await DELETE(req(), params)
    expect(res.status).toBe(403)
  })
})
