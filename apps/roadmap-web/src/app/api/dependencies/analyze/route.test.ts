import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { POST } from './route'

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

const URL = 'http://localhost/api/dependencies/analyze'
function req(body: unknown) {
  return new NextRequest(URL, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/dependencies/analyze', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 400 when workspace_id is missing', async () => {
    const res = await POST(req({}))
    expect(res.status).toBe(400)
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient({}))
    getAuthClaims.mockResolvedValue(null)
    const res = await POST(req({ workspace_id: 'ws-1' }))
    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 404 when workspace not found', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(makeClient({ workspaces: { data: null } }))
    const res = await POST(req({ workspace_id: 'ws-1' }))
    expect(res.status).toBe(404)
  })

  it('returns 403 when claims subject is not a team member', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(
      makeClient({ workspaces: { data: { team_id: 't1' } }, team_members: { data: null } })
    )
    const res = await POST(req({ workspace_id: 'ws-1' }))
    expect(res.status).toBe(403)
  })
})
