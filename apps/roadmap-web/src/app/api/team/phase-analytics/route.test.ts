import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { GET } from './route'

type Result = { data: unknown; error?: unknown }

// Flexible Supabase mock. Per-table result queues; each single()/maybeSingle()
// shifts the next configured result (falls back to the last / a null default).
// Captures eq() calls so tests can assert queries are scoped by the claims subject.
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
      in: vi.fn(self),
      is: vi.fn(self),
      gt: vi.fn(self),
      order: vi.fn(self),
      range: vi.fn(self),
      limit: vi.fn(self),
      update: vi.fn(self),
      insert: vi.fn(self),
      delete: vi.fn(self),
      single: vi.fn(resolve),
      maybeSingle: vi.fn(resolve),
    })
    return chain
  })
  return { client: { from }, eqCalls }
}

const CLAIMS = { subject: 'user-1', email: 'u@e.com', provider: 'neon' }
const url = (qs = '?workspace_id=ws-1') => new NextRequest(`http://localhost/api/team/phase-analytics${qs}`)

describe('GET /api/team/phase-analytics auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient({}).client)
    getAuthClaims.mockResolvedValue(null)
    const res = await GET(url())
    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 400 when workspace_id is missing', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(makeClient({}).client)
    const res = await GET(url(''))
    expect(res.status).toBe(400)
  })

  it('returns 404 when the workspace does not exist', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(makeClient({ workspaces: { data: null, error: { message: 'x' } } }).client)
    const res = await GET(url())
    expect(res.status).toBe(404)
  })

  it('scopes membership by the claims subject and returns 403 for non-members', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, eqCalls } = makeClient({
      workspaces: { data: { id: 'ws-1', name: 'WS', team_id: 'team-1' } },
      team_members: { data: null },
    })
    createClient.mockResolvedValue(client)
    const res = await GET(url())
    expect(res.status).toBe(403)
    expect(eqCalls).toContainEqual(['team_members', 'user_id', 'user-1'])
  })
})
