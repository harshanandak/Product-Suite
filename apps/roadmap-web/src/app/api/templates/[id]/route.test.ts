import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { GET, PUT, DELETE } from './route'

const CLAIMS = { subject: 'user-1', email: 'u@e.com', provider: 'neon' }
const params = { params: Promise.resolve({ id: 'tmpl-1' }) }

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

function getReq() {
  return new NextRequest('http://localhost/api/templates/tmpl-1')
}
function bodyReq(method: string, body: unknown) {
  return new NextRequest('http://localhost/api/templates/tmpl-1', {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('GET /api/templates/[id]', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient().client)
    getAuthClaims.mockResolvedValue(null)
    const res = await GET(getReq(), params)
    expect(res.status).toBe(401)
  })

  it('returns 404 when the template is not found', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, single } = makeClient()
    single.mockResolvedValueOnce({ data: null, error: { message: 'missing' } })
    createClient.mockResolvedValue(client)
    const res = await GET(getReq(), params)
    expect(res.status).toBe(404)
  })

  it('scopes membership by the claims subject and returns 403 for non-members', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, single, eq } = makeClient()
    single
      .mockResolvedValueOnce({ data: { id: 'tmpl-1', is_system: false, team_id: 'team-1' } })
      .mockResolvedValueOnce({ data: null })
    createClient.mockResolvedValue(client)
    const res = await GET(getReq(), params)
    expect(res.status).toBe(403)
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1')
  })
})

describe('PUT /api/templates/[id]', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient().client)
    getAuthClaims.mockResolvedValue(null)
    const res = await PUT(bodyReq('PUT', { name: 'X' }), params)
    expect(res.status).toBe(401)
  })

  it('returns 403 for system templates', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, single } = makeClient()
    single.mockResolvedValueOnce({ data: { id: 'tmpl-1', is_system: true } })
    createClient.mockResolvedValue(client)
    const res = await PUT(bodyReq('PUT', { name: 'X' }), params)
    expect(res.status).toBe(403)
  })

  it('returns 403 when the member is not an admin/owner', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, single, eq } = makeClient()
    single
      .mockResolvedValueOnce({ data: { id: 'tmpl-1', is_system: false, team_id: 'team-1' } })
      .mockResolvedValueOnce({ data: { role: 'member' } })
    createClient.mockResolvedValue(client)
    const res = await PUT(bodyReq('PUT', { name: 'X' }), params)
    expect(res.status).toBe(403)
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1')
  })
})

describe('DELETE /api/templates/[id]', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient().client)
    getAuthClaims.mockResolvedValue(null)
    const res = await DELETE(getReq(), params)
    expect(res.status).toBe(401)
  })

  it('returns 403 for system templates', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, single } = makeClient()
    single.mockResolvedValueOnce({ data: { id: 'tmpl-1', is_system: true } })
    createClient.mockResolvedValue(client)
    const res = await DELETE(getReq(), params)
    expect(res.status).toBe(403)
  })
})
