import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))
const { embedQuery, formatEmbeddingForPgvector } = vi.hoisted(() => ({
  embedQuery: vi.fn(),
  formatEmbeddingForPgvector: vi.fn(),
}))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))
vi.mock('@/lib/ai/embeddings/embedding-service', () => ({ embedQuery, formatEmbeddingForPgvector }))

import { POST } from './route'

const URL = 'http://localhost/api/documents/search'

function postReq(body: unknown) {
  return new NextRequest(URL, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

function teamClient(membership: { team_id: string } | null) {
  const single = vi.fn(async () => ({
    data: membership,
    error: membership ? null : { message: 'not found' },
  }))
  const eq = vi.fn(() => ({ single }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  return { client: { from }, eq }
}

const claims = { subject: 'user-1', email: 'u@e.com', provider: 'neon' }

describe('POST /api/documents/search auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
    embedQuery.mockReset()
    formatEmbeddingForPgvector.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue({ from: vi.fn() })
    getAuthClaims.mockResolvedValue(null)

    const res = await POST(postReq({ query: 'hi' }))

    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 404 when the claims subject has no team membership', async () => {
    getAuthClaims.mockResolvedValue(claims)
    const { client, eq } = teamClient(null)
    createClient.mockResolvedValue(client)

    const res = await POST(postReq({ query: 'hi' }))

    expect(res.status).toBe(404)
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('returns 400 when the query is empty', async () => {
    getAuthClaims.mockResolvedValue(claims)
    createClient.mockResolvedValue(teamClient({ team_id: 'team-1' }).client)

    const res = await POST(postReq({ query: '' }))

    expect(res.status).toBe(400)
  })

  it('returns 400 when the query is too long', async () => {
    getAuthClaims.mockResolvedValue(claims)
    createClient.mockResolvedValue(teamClient({ team_id: 'team-1' }).client)

    const res = await POST(postReq({ query: 'a'.repeat(1001) }))

    expect(res.status).toBe(400)
  })
})
