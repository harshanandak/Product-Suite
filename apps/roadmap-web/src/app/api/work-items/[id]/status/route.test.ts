import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { GET } from './route'

function queryResult(result: unknown) {
  const p = Promise.resolve(result)
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    single: () => Promise.resolve(result),
    then: (onF: unknown, onR: unknown) =>
      p.then(onF as never, onR as never),
  }
  return chain
}

function makeClient(results: unknown[]) {
  let i = 0
  return {
    from: vi.fn(() => queryResult(results[i++] ?? { data: null })),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
  }
}

const claims = { subject: 'user-1', email: 'u@e.com', provider: 'neon' }
const ctx = { params: Promise.resolve({ id: 'wi-1' }) }
const req = () => new NextRequest('http://localhost/api/work-items/wi-1/status')

describe('GET /api/work-items/[id]/status auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient([]))
    getAuthClaims.mockResolvedValue(null)
    const res = await GET(req(), ctx)
    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 404 when the claims subject has no team', async () => {
    getAuthClaims.mockResolvedValue(claims)
    createClient.mockResolvedValue(makeClient([{ data: null }]))
    const res = await GET(req(), ctx)
    expect(res.status).toBe(404)
  })

  it('returns 404 when the work item is not found', async () => {
    getAuthClaims.mockResolvedValue(claims)
    createClient.mockResolvedValue(
      makeClient([{ data: { team_id: 'team-1' } }, { data: null }])
    )
    const res = await GET(req(), ctx)
    expect(res.status).toBe(404)
  })
})
