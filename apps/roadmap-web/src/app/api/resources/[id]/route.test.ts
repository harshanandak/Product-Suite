import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { GET, PATCH, DELETE } from './route'

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
const params = { params: Promise.resolve({ id: 'r1' }) }

function req(url = 'http://localhost/api/resources/r1') {
  return new NextRequest(url)
}

beforeEach(() => {
  getAuthClaims.mockReset()
  createClient.mockReset()
})

describe('GET /api/resources/[id]', () => {
  it('returns 401 without claims', async () => {
    createClient.mockResolvedValue(makeClient())
    getAuthClaims.mockResolvedValue(null)
    const res = await GET(req(), params)
    expect(res.status).toBe(401)
  })

  it('returns 404 when the resource is missing', async () => {
    createClient.mockResolvedValue(makeClient({ resources: { data: null, error: {} } }))
    getAuthClaims.mockResolvedValue(claims)
    const res = await GET(req(), params)
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/resources/[id]', () => {
  it('returns 401 without claims', async () => {
    createClient.mockResolvedValue(makeClient())
    getAuthClaims.mockResolvedValue(null)
    const res = await PATCH(req(), params)
    expect(res.status).toBe(401)
  })

  it('returns 404 when the resource is missing', async () => {
    createClient.mockResolvedValue(makeClient({ resources: { data: null, error: {} } }))
    getAuthClaims.mockResolvedValue(claims)
    const res = await PATCH(req(), params)
    expect(res.status).toBe(404)
  })

  it('returns 400 when restoring a resource that is not deleted', async () => {
    createClient.mockResolvedValue(
      makeClient({ resources: { data: { id: 'r1', is_deleted: false } } })
    )
    getAuthClaims.mockResolvedValue(claims)
    const res = await PATCH(
      req('http://localhost/api/resources/r1?action=restore'),
      params
    )
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/resources/[id]', () => {
  it('returns 401 without claims', async () => {
    createClient.mockResolvedValue(makeClient())
    getAuthClaims.mockResolvedValue(null)
    const res = await DELETE(req(), params)
    expect(res.status).toBe(401)
  })

  it('returns 404 when the resource is missing', async () => {
    createClient.mockResolvedValue(makeClient({ resources: { data: null, error: {} } }))
    getAuthClaims.mockResolvedValue(claims)
    const res = await DELETE(req(), params)
    expect(res.status).toBe(404)
  })

  it('returns 403 on permanent delete when caller is neither creator nor admin', async () => {
    createClient.mockResolvedValue(
      makeClient({
        resources: { data: { id: 'r1', team_id: 't1', created_by: 'someone-else' } },
        team_members: { data: { role: 'member' } },
      })
    )
    getAuthClaims.mockResolvedValue(claims)
    const res = await DELETE(
      req('http://localhost/api/resources/r1?permanent=true'),
      params
    )
    expect(res.status).toBe(403)
  })
})
