import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { GET, PUT, DELETE } from './route'

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
const params = { params: Promise.resolve({ id: 'l1' }) }
const url = 'http://localhost/api/review-links/l1'

function req(init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(url, init)
}
function putReq(body: unknown) {
  return new NextRequest(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  getAuthClaims.mockReset()
  createClient.mockReset()
})

const linkFound = { review_links: { data: { id: 'l1', workspaces: { team_id: 't1' } } } }
const linkMissing = { review_links: { data: null, error: {} } }

describe('GET /api/review-links/[id]', () => {
  it('returns 401 without claims', async () => {
    createClient.mockResolvedValue(makeClient())
    getAuthClaims.mockResolvedValue(null)
    expect((await GET(req(), params)).status).toBe(401)
  })

  it('returns 404 when the link is missing', async () => {
    createClient.mockResolvedValue(makeClient(linkMissing))
    getAuthClaims.mockResolvedValue(claims)
    expect((await GET(req(), params)).status).toBe(404)
  })

  it('returns 403 when the claims subject is not a team member', async () => {
    createClient.mockResolvedValue(makeClient({ ...linkFound, team_members: { data: null } }))
    getAuthClaims.mockResolvedValue(claims)
    expect((await GET(req(), params)).status).toBe(403)
  })
})

describe('PUT /api/review-links/[id]', () => {
  it('returns 401 without claims', async () => {
    createClient.mockResolvedValue(makeClient())
    getAuthClaims.mockResolvedValue(null)
    expect((await PUT(putReq({ name: 'x' }), params)).status).toBe(401)
  })

  it('returns 404 when the link is missing', async () => {
    createClient.mockResolvedValue(makeClient(linkMissing))
    getAuthClaims.mockResolvedValue(claims)
    expect((await PUT(putReq({ name: 'x' }), params)).status).toBe(404)
  })

  it('returns 403 when the claims subject is not a team member', async () => {
    createClient.mockResolvedValue(makeClient({ ...linkFound, team_members: { data: null } }))
    getAuthClaims.mockResolvedValue(claims)
    expect((await PUT(putReq({ name: 'x' }), params)).status).toBe(403)
  })
})

describe('DELETE /api/review-links/[id]', () => {
  it('returns 401 without claims', async () => {
    createClient.mockResolvedValue(makeClient())
    getAuthClaims.mockResolvedValue(null)
    expect((await DELETE(req({ method: 'DELETE' }), params)).status).toBe(401)
  })

  it('returns 404 when the link is missing', async () => {
    createClient.mockResolvedValue(makeClient(linkMissing))
    getAuthClaims.mockResolvedValue(claims)
    expect((await DELETE(req({ method: 'DELETE' }), params)).status).toBe(404)
  })

  it('returns 403 when the claims subject is not a team member', async () => {
    createClient.mockResolvedValue(makeClient({ ...linkFound, team_members: { data: null } }))
    getAuthClaims.mockResolvedValue(claims)
    expect((await DELETE(req({ method: 'DELETE' }), params)).status).toBe(403)
  })
})
