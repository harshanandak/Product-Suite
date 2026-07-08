import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { GET, POST } from './route'

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

function getReq() {
  return new NextRequest('http://localhost/api/timeline-items')
}
function postReq(body: unknown) {
  return new NextRequest('http://localhost/api/timeline-items', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('GET /api/timeline-items', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient().client)
    getAuthClaims.mockResolvedValue(null)
    const res = await GET(getReq())
    expect(res.status).toBe(401)
  })

  it('returns 404 and scopes by claims subject when the user has no team', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, single, eq } = makeClient()
    single.mockResolvedValueOnce({ data: null })
    createClient.mockResolvedValue(client)
    const res = await GET(getReq())
    expect(res.status).toBe(404)
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1')
  })
})

describe('POST /api/timeline-items', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient().client)
    getAuthClaims.mockResolvedValue(null)
    const res = await POST(postReq({ work_item_id: 'wi-1', timeline: 'MVP', difficulty: 'easy' }))
    expect(res.status).toBe(401)
  })

  it('returns 404 when the user has no team', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, single } = makeClient()
    single.mockResolvedValueOnce({ data: null })
    createClient.mockResolvedValue(client)
    const res = await POST(postReq({ work_item_id: 'wi-1', timeline: 'MVP', difficulty: 'easy' }))
    expect(res.status).toBe(404)
  })

  it('returns 400 when required fields are missing', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, single } = makeClient()
    single.mockResolvedValueOnce({ data: { team_id: 'team-1' } })
    createClient.mockResolvedValue(client)
    const res = await POST(postReq({}))
    expect(res.status).toBe(400)
  })

  it('returns 404 when the work item is not found', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const { client, single } = makeClient()
    single
      .mockResolvedValueOnce({ data: { team_id: 'team-1' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'missing' } })
    createClient.mockResolvedValue(client)
    const res = await POST(postReq({ work_item_id: 'wi-1', timeline: 'MVP', difficulty: 'easy' }))
    expect(res.status).toBe(404)
  })
})
