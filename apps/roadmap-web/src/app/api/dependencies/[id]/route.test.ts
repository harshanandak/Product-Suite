import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { GET, PATCH, DELETE } from './route'

const CLAIMS = { subject: 'user-1', email: 'u@e.com', provider: 'neon' }

function makeClient(tableResults: Record<string, { data: unknown; error?: unknown }>) {
  const make = (result: { data: unknown; error?: unknown }) => {
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'order', 'insert', 'update', 'delete']) {
      q[m] = () => q
    }
    q.single = () => Promise.resolve(result)
    q.then = (resolve: (v: unknown) => unknown) => resolve(result)
    return q
  }
  return {
    from: (table: string) => make(tableResults[table] ?? { data: null, error: null }),
  }
}

const ctx = { params: Promise.resolve({ id: 'conn-1' }) }
const URL = 'http://localhost/api/dependencies/conn-1'

describe('GET /api/dependencies/[id]', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient({}))
    getAuthClaims.mockResolvedValue(null)
    const res = await GET(new NextRequest(URL), ctx)
    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 404 when connection not found', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(
      makeClient({ work_item_connections: { data: null, error: { message: 'x' } } })
    )
    const res = await GET(new NextRequest(URL), ctx)
    expect(res.status).toBe(404)
  })

  it('returns 403 when claims subject is not a team member', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(
      makeClient({
        work_item_connections: { data: { id: 'conn-1', workspace_id: 'ws-1' } },
        workspaces: { data: { team_id: 't1' } },
        team_members: { data: null },
      })
    )
    const res = await GET(new NextRequest(URL), ctx)
    expect(res.status).toBe(403)
  })
})

describe('PATCH /api/dependencies/[id]', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient({}))
    getAuthClaims.mockResolvedValue(null)
    const req = new NextRequest(URL, {
      method: 'PATCH',
      body: JSON.stringify({ reason: 'x' }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await PATCH(req, ctx)
    expect(res.status).toBe(401)
  })
})

describe('DELETE /api/dependencies/[id]', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient({}))
    getAuthClaims.mockResolvedValue(null)
    const res = await DELETE(new NextRequest(URL, { method: 'DELETE' }), ctx)
    expect(res.status).toBe(401)
  })
})
