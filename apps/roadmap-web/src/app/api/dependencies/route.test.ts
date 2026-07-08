import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { GET, POST } from './route'

const CLAIMS = { subject: 'user-1', email: 'u@e.com', provider: 'neon' }

// Chainable Supabase mock: every builder method returns the same chain, which
// is both awaitable (thenable) and exposes .single(), resolving to per-table
// results keyed by table name.
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

function jsonReq(url: string, method: string, body: unknown) {
  return new NextRequest(url, {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

const URL_BASE = 'http://localhost/api/dependencies'
const validPost = {
  workspace_id: 'ws-1',
  source_work_item_id: 's1',
  target_work_item_id: 't1',
  connection_type: 'dependency',
}

describe('GET /api/dependencies', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 400 when workspace_id is missing', async () => {
    const res = await GET(new NextRequest(URL_BASE))
    expect(res.status).toBe(400)
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient({}))
    getAuthClaims.mockResolvedValue(null)
    const res = await GET(new NextRequest(`${URL_BASE}?workspace_id=ws-1`))
    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 404 when workspace not found', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(makeClient({ workspaces: { data: null } }))
    const res = await GET(new NextRequest(`${URL_BASE}?workspace_id=ws-1`))
    expect(res.status).toBe(404)
  })

  it('returns 403 when claims subject is not a team member', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(
      makeClient({ workspaces: { data: { team_id: 't1' } }, team_members: { data: null } })
    )
    const res = await GET(new NextRequest(`${URL_BASE}?workspace_id=ws-1`))
    expect(res.status).toBe(403)
  })
})

describe('POST /api/dependencies', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 400 when required fields are missing', async () => {
    const res = await POST(jsonReq(URL_BASE, 'POST', { workspace_id: 'ws-1' }))
    expect(res.status).toBe(400)
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient({}))
    getAuthClaims.mockResolvedValue(null)
    const res = await POST(jsonReq(URL_BASE, 'POST', validPost))
    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 403 when claims subject is not a team member', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(
      makeClient({ workspaces: { data: { team_id: 't1' } }, team_members: { data: null } })
    )
    const res = await POST(jsonReq(URL_BASE, 'POST', validPost))
    expect(res.status).toBe(403)
  })
})
