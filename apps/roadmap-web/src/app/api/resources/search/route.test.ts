import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { GET } from './route'

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

beforeEach(() => {
  getAuthClaims.mockReset()
  createClient.mockReset()
})

describe('GET /api/resources/search', () => {
  it('returns 400 when team_id is missing', async () => {
    getAuthClaims.mockResolvedValue(claims)
    createClient.mockResolvedValue(makeClient())
    const res = await GET(new NextRequest('http://localhost/api/resources/search?q=foo'))
    expect(res.status).toBe(400)
  })

  it('returns 400 when the search query is missing', async () => {
    getAuthClaims.mockResolvedValue(claims)
    createClient.mockResolvedValue(makeClient())
    const res = await GET(new NextRequest('http://localhost/api/resources/search?team_id=t1'))
    expect(res.status).toBe(400)
  })

  it('returns 401 without claims', async () => {
    createClient.mockResolvedValue(makeClient())
    getAuthClaims.mockResolvedValue(null)
    const res = await GET(
      new NextRequest('http://localhost/api/resources/search?team_id=t1&q=foo')
    )
    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 403 when the claims subject is not a team member', async () => {
    createClient.mockResolvedValue(makeClient({ team_members: { data: null } }))
    getAuthClaims.mockResolvedValue(claims)
    const res = await GET(
      new NextRequest('http://localhost/api/resources/search?team_id=t1&q=foo')
    )
    expect(res.status).toBe(403)
  })
})
