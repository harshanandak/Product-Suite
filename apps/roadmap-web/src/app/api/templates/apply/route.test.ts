import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { POST } from './route'

const CLAIMS = { subject: 'user-1', email: 'u@e.com', provider: 'neon' }

function makeClient() {
  const chain: Record<string, unknown> = {}
  const single = vi.fn()
  const eq = vi.fn(() => chain)
  const pass = vi.fn(() => chain)
  Object.assign(chain, {
    select: pass, order: pass, or: pass, eq, single,
    insert: pass, update: pass, delete: pass, limit: pass, gte: pass, lte: pass,
  })
  const from = vi.fn(() => chain)
  return { client: { from }, single, eq }
}

function postReq(body: unknown) {
  return new NextRequest('http://localhost/api/templates/apply', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/templates/apply', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 400 when templateId is missing', async () => {
    createClient.mockResolvedValue(makeClient().client)
    const res = await POST(postReq({ workspaceId: 'ws-1' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when workspaceId is missing', async () => {
    createClient.mockResolvedValue(makeClient().client)
    const res = await POST(postReq({ templateId: 'tmpl-1' }))
    expect(res.status).toBe(400)
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient().client)
    getAuthClaims.mockResolvedValue(null)
    const res = await POST(postReq({ templateId: 'tmpl-1', workspaceId: 'ws-1' }))
    expect(res.status).toBe(401)
  })

  it('returns 404 when the workspace is not found', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, single } = makeClient()
    single.mockResolvedValueOnce({ data: null, error: { message: 'not found' } })
    createClient.mockResolvedValue(client)

    const res = await POST(postReq({ templateId: 'tmpl-1', workspaceId: 'ws-1' }))
    expect(res.status).toBe(404)
  })

  it('scopes membership by the claims subject and returns 403 for non-members', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, single, eq } = makeClient()
    single
      .mockResolvedValueOnce({ data: { id: 'ws-1', team_id: 'team-1', name: 'W' } })
      .mockResolvedValueOnce({ data: null })
    createClient.mockResolvedValue(client)

    const res = await POST(postReq({ templateId: 'tmpl-1', workspaceId: 'ws-1' }))

    expect(res.status).toBe(403)
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('returns 403 when the member is not an admin/owner', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, single } = makeClient()
    single
      .mockResolvedValueOnce({ data: { id: 'ws-1', team_id: 'team-1', name: 'W' } })
      .mockResolvedValueOnce({ data: { role: 'member' } })
    createClient.mockResolvedValue(client)

    const res = await POST(postReq({ templateId: 'tmpl-1', workspaceId: 'ws-1' }))
    expect(res.status).toBe(403)
  })
})
