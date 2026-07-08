import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { DELETE, GET, PATCH } from './route'

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

function ctx(id = 'dep-1') {
  return { params: Promise.resolve({ id }) }
}

function getReq() {
  return new NextRequest('http://localhost/api/departments/dep-1')
}

function bodyReq(method: string, body: unknown) {
  return new NextRequest('http://localhost/api/departments/dep-1', {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('departments/[id] route auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('GET returns 401 when there are no claims', async () => {
    createClient.mockResolvedValue(client({}))
    getAuthClaims.mockResolvedValue(null)
    const res = await GET(getReq(), ctx())
    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('GET returns 404 when department not found', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(client({ departments: { data: null, error: null } }))
    const res = await GET(getReq(), ctx())
    expect(res.status).toBe(404)
  })

  it('GET returns 403 when the claims subject is not a team member', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(
      client({
        departments: { data: { id: 'dep-1', team_id: 't1' }, error: null },
        team_members: { data: null },
      })
    )
    const res = await GET(getReq(), ctx())
    expect(res.status).toBe(403)
  })

  it('PATCH returns 401 when there are no claims', async () => {
    createClient.mockResolvedValue(client({}))
    getAuthClaims.mockResolvedValue(null)
    const res = await PATCH(bodyReq('PATCH', { name: 'x' }), ctx())
    expect(res.status).toBe(401)
  })

  it('PATCH returns 404 when department not found', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(client({ departments: { data: null, error: null } }))
    const res = await PATCH(bodyReq('PATCH', { name: 'x' }), ctx())
    expect(res.status).toBe(404)
  })

  it('PATCH returns 403 when the member lacks an admin role', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(
      client({
        departments: { data: { id: 'dep-1', team_id: 't1' }, error: null },
        team_members: { data: { role: 'member' } },
      })
    )
    const res = await PATCH(bodyReq('PATCH', { name: 'x' }), ctx())
    expect(res.status).toBe(403)
  })

  it('DELETE returns 401 when there are no claims', async () => {
    createClient.mockResolvedValue(client({}))
    getAuthClaims.mockResolvedValue(null)
    const res = await DELETE(getReq(), ctx())
    expect(res.status).toBe(401)
  })

  it('DELETE returns 403 when the claims subject is not a team member', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(
      client({
        departments: { data: { id: 'dep-1', team_id: 't1' }, error: null },
        team_members: { data: null },
      })
    )
    const res = await DELETE(getReq(), ctx())
    expect(res.status).toBe(403)
  })

  it('DELETE returns 400 when the department still has work items', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(
      client({
        departments: { data: { id: 'dep-1', team_id: 't1' }, error: null },
        team_members: { data: { role: 'admin' } },
        work_items: { count: 3 },
      })
    )
    const res = await DELETE(getReq(), ctx())
    expect(res.status).toBe(400)
  })
})
