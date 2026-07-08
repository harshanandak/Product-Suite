import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { GET, POST } from './route'

// A chainable Supabase mock: every method returns the same proxy; `single`
// resolves to the preset result and the proxy is awaitable.
function chainable(result: unknown) {
  const proxy: unknown = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'single' || prop === 'maybeSingle') return () => Promise.resolve(result)
      if (prop === 'then') return (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(onF, onR)
      return () => proxy
    },
  })
  return proxy
}

function makeClient(tables: Record<string, unknown> = {}) {
  return {
    from: vi.fn((t: string) => chainable(tables[t] ?? { data: null })),
    rpc: vi.fn(() => chainable({ data: null })),
    auth: { getUser: vi.fn() },
  }
}

const claims = { subject: 'user-1', email: 'u@e.com', provider: 'neon' }

function postReq(body: unknown) {
  return new NextRequest('http://localhost/api/resources', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  getAuthClaims.mockReset()
  createClient.mockReset()
})

describe('GET /api/resources', () => {
  it('returns 400 when team_id is missing', async () => {
    createClient.mockResolvedValue(makeClient())
    const res = await GET(new NextRequest('http://localhost/api/resources'))
    expect(res.status).toBe(400)
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient())
    getAuthClaims.mockResolvedValue(null)
    const res = await GET(new NextRequest('http://localhost/api/resources?team_id=t1'))
    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 403 when the claims subject is not a team member', async () => {
    createClient.mockResolvedValue(makeClient({ team_members: { data: null } }))
    getAuthClaims.mockResolvedValue(claims)
    const res = await GET(new NextRequest('http://localhost/api/resources?team_id=t1'))
    expect(res.status).toBe(403)
  })
})

describe('POST /api/resources', () => {
  it('returns 400 when required fields are missing', async () => {
    createClient.mockResolvedValue(makeClient())
    const res = await POST(postReq({ team_id: 't1' }))
    expect(res.status).toBe(400)
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient())
    getAuthClaims.mockResolvedValue(null)
    const res = await POST(postReq({ workspace_id: 'w1', team_id: 't1', title: 'T' }))
    expect(res.status).toBe(401)
  })

  it('returns 403 when the claims subject is not a team member', async () => {
    createClient.mockResolvedValue(makeClient({ team_members: { data: null } }))
    getAuthClaims.mockResolvedValue(claims)
    const res = await POST(postReq({ workspace_id: 'w1', team_id: 't1', title: 'T' }))
    expect(res.status).toBe(403)
  })
})
