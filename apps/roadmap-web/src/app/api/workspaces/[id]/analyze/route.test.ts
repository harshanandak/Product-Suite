import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))
const { analyzeWorkspace } = vi.hoisted(() => ({ analyzeWorkspace: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))
vi.mock('@/lib/workspace/analyzer-service', () => ({ analyzeWorkspace }))

import { GET } from './route'

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

function ctx(id = 'ws-1') {
  return { params: Promise.resolve({ id }) }
}

function req() {
  return new NextRequest('http://localhost/api/workspaces/ws-1/analyze')
}

describe('workspaces/[id]/analyze route auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
    analyzeWorkspace.mockReset()
  })

  it('returns 401 when there are no claims', async () => {
    createClient.mockResolvedValue(client({}))
    getAuthClaims.mockResolvedValue(null)
    const res = await GET(req(), ctx())
    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 404 when workspace not found', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(client({ workspaces: { data: null } }))
    const res = await GET(req(), ctx())
    expect(res.status).toBe(404)
  })

  it('returns 403 when the claims subject is not a team member', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(
      client({
        workspaces: { data: { id: 'ws-1', team_id: 't1', name: 'W' } },
        team_members: { data: null },
      })
    )
    const res = await GET(req(), ctx())
    expect(res.status).toBe(403)
    expect(analyzeWorkspace).not.toHaveBeenCalled()
  })
})
