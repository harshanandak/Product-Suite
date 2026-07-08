import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { GET, POST } from './route'

const CLAIMS = { subject: 'user-1', email: 'u@e.com', provider: 'neon' }

function queryProxy(result: unknown) {
  const proxy: unknown = new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === 'single' || prop === 'maybeSingle') return () => Promise.resolve(result)
      if (prop === 'then') return (resolve: (value: unknown) => void) => resolve(result)
      return () => proxy
    },
  })
  return proxy
}

function client(byTable: Record<string, unknown>) {
  return { from: vi.fn((table: string) => queryProxy(byTable[table] ?? { data: null })) }
}

function getReq(query = '?team_id=t1') {
  return new NextRequest(`http://localhost/api/departments${query}`)
}

function postReq(body: unknown) {
  return new NextRequest('http://localhost/api/departments', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('departments route auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('GET returns 400 when team_id is missing', async () => {
    createClient.mockResolvedValue(client({}))
    const res = await GET(getReq(''))
    expect(res.status).toBe(400)
  })

  it('GET returns 401 when there are no claims', async () => {
    createClient.mockResolvedValue(client({}))
    getAuthClaims.mockResolvedValue(null)
    const res = await GET(getReq())
    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('GET returns 403 when the claims subject is not a team member', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(client({ team_members: { data: null } }))
    const res = await GET(getReq())
    expect(res.status).toBe(403)
  })

  it('POST returns 400 when team_id is missing', async () => {
    createClient.mockResolvedValue(client({}))
    const res = await POST(postReq({ name: 'Eng' }))
    expect(res.status).toBe(400)
  })

  it('POST returns 400 when name is missing', async () => {
    createClient.mockResolvedValue(client({}))
    const res = await POST(postReq({ team_id: 't1' }))
    expect(res.status).toBe(400)
  })

  it('POST returns 401 when there are no claims', async () => {
    createClient.mockResolvedValue(client({}))
    getAuthClaims.mockResolvedValue(null)
    const res = await POST(postReq({ team_id: 't1', name: 'Eng' }))
    expect(res.status).toBe(401)
  })

  it('POST returns 403 when the claims subject is not a team member', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(client({ team_members: { data: null } }))
    const res = await POST(postReq({ team_id: 't1', name: 'Eng' }))
    expect(res.status).toBe(403)
  })

  it('POST returns 403 when the member lacks an admin role', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(client({ team_members: { data: { role: 'member' } } }))
    const res = await POST(postReq({ team_id: 't1', name: 'Eng' }))
    expect(res.status).toBe(403)
  })
})
