import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { PATCH, POST } from './route'

function queryResult(result: unknown) {
  const p = Promise.resolve(result)
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    update: () => chain,
    single: () => Promise.resolve(result),
    then: (onF: unknown, onR: unknown) =>
      p.then(onF as never, onR as never),
  }
  return chain
}

function makeClient(results: unknown[]) {
  let i = 0
  return { from: vi.fn(() => queryResult(results[i++] ?? { data: null })) }
}

const claims = { subject: 'user-1', email: 'u@e.com', provider: 'neon' }
const ctx = { params: Promise.resolve({ id: 'wi-1' }) }
const workItem = {
  data: {
    id: 'wi-1',
    type: 'feature',
    phase: 'design',
    review_enabled: true,
    review_status: null,
    workspace: { team_id: 'team-1' },
  },
}
function postReq(body: unknown) {
  return new NextRequest('http://localhost/api/work-items/wi-1/review', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
function patchReq(body: unknown) {
  return new NextRequest('http://localhost/api/work-items/wi-1/review', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

describe('POST /api/work-items/[id]/review auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 400 for an invalid action', async () => {
    createClient.mockResolvedValue(makeClient([]))
    getAuthClaims.mockResolvedValue(claims)
    const res = await POST(postReq({ action: 'nope' }), ctx)
    expect(res.status).toBe(400)
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient([]))
    getAuthClaims.mockResolvedValue(null)
    const res = await POST(postReq({ action: 'request' }), ctx)
    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 403 when the claims subject is not a team member', async () => {
    getAuthClaims.mockResolvedValue(claims)
    createClient.mockResolvedValue(makeClient([workItem, { data: null }]))
    const res = await POST(postReq({ action: 'request' }), ctx)
    expect(res.status).toBe(403)
  })
})

describe('PATCH /api/work-items/[id]/review auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 400 when review_enabled is not a boolean', async () => {
    createClient.mockResolvedValue(makeClient([]))
    getAuthClaims.mockResolvedValue(claims)
    const res = await PATCH(patchReq({ review_enabled: 'yes' }), ctx)
    expect(res.status).toBe(400)
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient([]))
    getAuthClaims.mockResolvedValue(null)
    const res = await PATCH(patchReq({ review_enabled: true }), ctx)
    expect(res.status).toBe(401)
  })

  it('returns 403 when the claims subject is not a team member', async () => {
    getAuthClaims.mockResolvedValue(claims)
    createClient.mockResolvedValue(makeClient([workItem, { data: null }]))
    const res = await PATCH(patchReq({ review_enabled: true }), ctx)
    expect(res.status).toBe(403)
  })

  it('returns 403 when a member lacks permission to toggle review', async () => {
    getAuthClaims.mockResolvedValue(claims)
    createClient.mockResolvedValue(
      makeClient([workItem, { data: { role: 'member' } }])
    )
    const res = await PATCH(patchReq({ review_enabled: true }), ctx)
    expect(res.status).toBe(403)
  })
})
