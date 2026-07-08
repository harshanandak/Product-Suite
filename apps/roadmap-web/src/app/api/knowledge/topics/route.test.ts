import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))
const { getTopics, getTopicDocuments } = vi.hoisted(() => ({
  getTopics: vi.fn(),
  getTopicDocuments: vi.fn(),
}))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))
vi.mock('@/lib/ai/compression', () => ({ getTopics, getTopicDocuments }))

import { GET } from './route'

const URL = 'http://localhost/api/knowledge/topics'

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

describe('GET /api/knowledge/topics auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
    getTopics.mockReset()
    getTopicDocuments.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue({ from: vi.fn() })
    getAuthClaims.mockResolvedValue(null)

    const res = await GET(new NextRequest(URL))

    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 404 when the claims subject has no team membership', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    const { client, eq } = teamClient(null)
    createClient.mockResolvedValue(client)

    const res = await GET(new NextRequest(URL))

    expect(res.status).toBe(404)
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1')
  })
})
