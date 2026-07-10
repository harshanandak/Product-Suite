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

const validCtx = { params: Promise.resolve({ id: 'doc-1' }) }
const invalidCtx = { params: Promise.resolve({ id: 'bad/id' }) }
const URL = 'http://localhost/api/blocksuite/documents/doc-1'

describe('GET /api/blocksuite/documents/[id]', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 400 for an invalid document id', async () => {
    const res = await GET(new NextRequest(URL), invalidCtx)
    expect(res.status).toBe(400)
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient({}))
    getAuthClaims.mockResolvedValue(null)
    const res = await GET(new NextRequest(URL), validCtx)
    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 403 when the claims subject has no team memberships', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(makeClient({ team_members: { data: [] } }))
    const res = await GET(new NextRequest(URL), validCtx)
    expect(res.status).toBe(403)
  })

  it('returns 404 when the document is not found within the team', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(
      makeClient({
        team_members: { data: [{ team_id: 't1' }] },
        blocksuite_documents: { data: null, error: { message: 'x' } },
      })
    )
    const res = await GET(new NextRequest(URL), validCtx)
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/blocksuite/documents/[id]', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 400 for an invalid document id', async () => {
    const req = new NextRequest(URL, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'x' }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await PATCH(req, invalidCtx)
    expect(res.status).toBe(400)
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient({}))
    getAuthClaims.mockResolvedValue(null)
    const req = new NextRequest(URL, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'New Title' }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await PATCH(req, validCtx)
    expect(res.status).toBe(401)
  })
})

describe('DELETE /api/blocksuite/documents/[id]', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient({}))
    getAuthClaims.mockResolvedValue(null)
    const res = await DELETE(new NextRequest(URL, { method: 'DELETE' }), validCtx)
    expect(res.status).toBe(401)
  })
})
