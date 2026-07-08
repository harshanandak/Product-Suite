import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { GET, PUT } from './route'

const CLAIMS = { subject: 'user-1', email: 'u@e.com', provider: 'neon' }

// Chainable Supabase query stub: any builder method returns the proxy,
// `.single()` / awaiting it resolves to the configured table result.
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

function ctx(id = 'ws-1') {
  return { params: Promise.resolve({ id }) }
}

function putReq(body: unknown) {
  return new NextRequest('http://localhost/api/workspaces/ws-1/mode', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

function getReq() {
  return new NextRequest('http://localhost/api/workspaces/ws-1/mode')
}

describe('workspaces/[id]/mode route auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('PUT returns 400 when mode is missing', async () => {
    createClient.mockResolvedValue(client({}))
    const res = await PUT(putReq({}), ctx())
    expect(res.status).toBe(400)
  })

  it('PUT returns 400 when mode is invalid', async () => {
    createClient.mockResolvedValue(client({}))
    const res = await PUT(putReq({ mode: 'nope' }), ctx())
    expect(res.status).toBe(400)
  })

  it('PUT returns 401 when there are no claims', async () => {
    createClient.mockResolvedValue(client({}))
    getAuthClaims.mockResolvedValue(null)
    const res = await PUT(putReq({ mode: 'launch' }), ctx())
    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('PUT returns 404 when workspace not found', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(client({ workspaces: { data: null } }))
    const res = await PUT(putReq({ mode: 'launch' }), ctx())
    expect(res.status).toBe(404)
  })

  it('PUT returns 403 when the claims subject is not a team member', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(
      client({
        workspaces: { data: { id: 'ws-1', team_id: 't1', mode: 'development' } },
        team_members: { data: null },
      })
    )
    const res = await PUT(putReq({ mode: 'launch' }), ctx())
    expect(res.status).toBe(403)
  })

  it('PUT returns 403 when the member lacks an admin role', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(
      client({
        workspaces: { data: { id: 'ws-1', team_id: 't1', mode: 'development' } },
        team_members: { data: { role: 'member' } },
      })
    )
    const res = await PUT(putReq({ mode: 'launch' }), ctx())
    expect(res.status).toBe(403)
  })

  it('GET returns 401 when there are no claims', async () => {
    createClient.mockResolvedValue(client({}))
    getAuthClaims.mockResolvedValue(null)
    const res = await GET(getReq(), ctx())
    expect(res.status).toBe(401)
  })

  it('GET returns 404 when workspace not found', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(client({ workspaces: { data: null } }))
    const res = await GET(getReq(), ctx())
    expect(res.status).toBe(404)
  })

  it('GET returns 403 when the claims subject is not a team member', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(
      client({
        workspaces: { data: { id: 'ws-1', name: 'W', mode: 'development', team_id: 't1' } },
        team_members: { data: null },
      })
    )
    const res = await GET(getReq(), ctx())
    expect(res.status).toBe(403)
  })
})
