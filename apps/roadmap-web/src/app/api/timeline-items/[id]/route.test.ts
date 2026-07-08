import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { GET, PATCH, DELETE } from './route'

const CLAIMS = { subject: 'user-1', email: 'u@e.com', provider: 'neon' }
const params = { params: Promise.resolve({ id: 'ti-1' }) }

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
  return new NextRequest('http://localhost/api/timeline-items/ti-1')
}
function patchReq(body: unknown) {
  return new NextRequest('http://localhost/api/timeline-items/ti-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('GET /api/timeline-items/[id]', () => {
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

  it('returns 404 and scopes by claims subject when the user has no team', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, single, eq } = makeClient()
    single.mockResolvedValueOnce({ data: null })
    createClient.mockResolvedValue(client)
    const res = await GET(getReq(), params)
    expect(res.status).toBe(404)
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1')
  })
})

describe('PATCH /api/timeline-items/[id]', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient().client)
    getAuthClaims.mockResolvedValue(null)
    const res = await PATCH(patchReq({ status: 'completed' }), params)
    expect(res.status).toBe(401)
  })

  it('returns 404 when the user has no team', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, single } = makeClient()
    single.mockResolvedValueOnce({ data: null })
    createClient.mockResolvedValue(client)
    const res = await PATCH(patchReq({ status: 'completed' }), params)
    expect(res.status).toBe(404)
  })

  it('returns 404 when the timeline item is not found', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, single } = makeClient()
    single
      .mockResolvedValueOnce({ data: { team_id: 'team-1' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'missing' } })
    createClient.mockResolvedValue(client)
    const res = await PATCH(patchReq({ status: 'completed' }), params)
    expect(res.status).toBe(404)
  })

  it('returns 400 for an invalid timeline value', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, single } = makeClient()
    single
      .mockResolvedValueOnce({ data: { team_id: 'team-1' } })
      .mockResolvedValueOnce({ data: { id: 'ti-1', team_id: 'team-1' } })
    createClient.mockResolvedValue(client)
    const res = await PATCH(patchReq({ timeline: 'BOGUS' }), params)
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/timeline-items/[id]', () => {
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

  it('returns 404 and scopes by claims subject when the user has no team', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, single, eq } = makeClient()
    single.mockResolvedValueOnce({ data: null })
    createClient.mockResolvedValue(client)
    const res = await DELETE(getReq(), params)
    expect(res.status).toBe(404)
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1')
  })
})
