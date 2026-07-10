import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { POST } from './route'

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
      insert: vi.fn(self),
      update: vi.fn(self),
      single: vi.fn(resolve),
      maybeSingle: vi.fn(resolve),
    })
    return chain
  })
  return { client: { from }, eqCalls }
}

const CLAIMS = { subject: 'user-1', email: 'u@e.com', provider: 'neon' }
const req = (body: unknown) =>
  new NextRequest('http://localhost/api/team/invitations/accept', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
const future = new Date(Date.now() + 86_400_000).toISOString()

describe('POST /api/team/invitations/accept auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient({}).client)
    getAuthClaims.mockResolvedValue(null)
    const res = await POST(req({ token: 'tok' }))
    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 400 for an invalid request body', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(makeClient({}).client)
    const res = await POST(req({}))
    expect(res.status).toBe(400)
  })

  it('returns 404 for an invalid invitation token', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(makeClient({ invitations: { data: null, error: { message: 'x' } } }).client)
    const res = await POST(req({ token: 'tok' }))
    expect(res.status).toBe(404)
  })

  it('resolves the user email via the claims subject and returns 403 on email mismatch', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, eqCalls } = makeClient({
      invitations: { data: { id: 'inv-1', token: 'tok', accepted_at: null, expires_at: future, email: 'invited@e.com', team_id: 'team-1' } },
      users: { data: { email: 'someone-else@e.com' } },
    })
    createClient.mockResolvedValue(client)
    const res = await POST(req({ token: 'tok' }))
    expect(res.status).toBe(403)
    expect(eqCalls).toContainEqual(['users', 'id', 'user-1'])
  })
})
