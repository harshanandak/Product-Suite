import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { GET, POST } from './route'

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
  return new NextRequest('http://localhost/api/review-links', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  getAuthClaims.mockReset()
  createClient.mockReset()
})

describe('GET /api/review-links', () => {
  it('returns 400 when workspace_id is missing', async () => {
    createClient.mockResolvedValue(makeClient())
    const res = await GET(new NextRequest('http://localhost/api/review-links'))
    expect(res.status).toBe(400)
  })

  it('returns 401 without claims', async () => {
    createClient.mockResolvedValue(makeClient())
    getAuthClaims.mockResolvedValue(null)
    const res = await GET(new NextRequest('http://localhost/api/review-links?workspace_id=w1'))
    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 404 when the workspace is missing', async () => {
    createClient.mockResolvedValue(makeClient({ workspaces: { data: null, error: {} } }))
    getAuthClaims.mockResolvedValue(claims)
    const res = await GET(new NextRequest('http://localhost/api/review-links?workspace_id=w1'))
    expect(res.status).toBe(404)
  })

  it('returns 403 when the claims subject is not a team member', async () => {
    createClient.mockResolvedValue(
      makeClient({ workspaces: { data: { team_id: 't1' } }, team_members: { data: null } })
    )
    getAuthClaims.mockResolvedValue(claims)
    const res = await GET(new NextRequest('http://localhost/api/review-links?workspace_id=w1'))
    expect(res.status).toBe(403)
  })
})

describe('POST /api/review-links', () => {
  it('returns 400 when required fields are missing', async () => {
    createClient.mockResolvedValue(makeClient())
    const res = await POST(postReq({ workspace_id: 'w1' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for an invalid type', async () => {
    createClient.mockResolvedValue(makeClient())
    const res = await POST(postReq({ workspace_id: 'w1', type: 'bogus' }))
    expect(res.status).toBe(400)
  })

  it('returns 401 without claims', async () => {
    createClient.mockResolvedValue(makeClient())
    getAuthClaims.mockResolvedValue(null)
    const res = await POST(postReq({ workspace_id: 'w1', type: 'public' }))
    expect(res.status).toBe(401)
  })

  it('returns 404 when the workspace is missing', async () => {
    createClient.mockResolvedValue(makeClient({ workspaces: { data: null, error: {} } }))
    getAuthClaims.mockResolvedValue(claims)
    const res = await POST(postReq({ workspace_id: 'w1', type: 'public' }))
    expect(res.status).toBe(404)
  })

  it('returns 403 when the claims subject is not a team member', async () => {
    createClient.mockResolvedValue(
      makeClient({ workspaces: { data: { team_id: 't1', name: 'WS' } }, team_members: { data: null } })
    )
    getAuthClaims.mockResolvedValue(claims)
    const res = await POST(postReq({ workspace_id: 'w1', type: 'public' }))
    expect(res.status).toBe(403)
  })
})
