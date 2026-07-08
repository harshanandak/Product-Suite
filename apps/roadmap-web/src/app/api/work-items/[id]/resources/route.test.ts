import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { DELETE, GET, POST } from './route'

function queryResult(result: unknown) {
  const p = Promise.resolve(result)
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
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
const getReq = () =>
  new NextRequest('http://localhost/api/work-items/wi-1/resources')
function postReq(body: unknown) {
  return new NextRequest('http://localhost/api/work-items/wi-1/resources', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
const delReq = (qs = '') =>
  new NextRequest(`http://localhost/api/work-items/wi-1/resources${qs}`, {
    method: 'DELETE',
  })

describe('GET /api/work-items/[id]/resources auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient([]))
    getAuthClaims.mockResolvedValue(null)
    const res = await GET(getReq(), ctx)
    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 404 when the work item is not found', async () => {
    getAuthClaims.mockResolvedValue(claims)
    createClient.mockResolvedValue(makeClient([{ data: null }]))
    const res = await GET(getReq(), ctx)
    expect(res.status).toBe(404)
  })
})

describe('POST /api/work-items/[id]/resources auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient([]))
    getAuthClaims.mockResolvedValue(null)
    const res = await POST(postReq({ resource_id: 'r-1' }), ctx)
    expect(res.status).toBe(401)
  })

  it('returns 404 when the work item is not found', async () => {
    getAuthClaims.mockResolvedValue(claims)
    createClient.mockResolvedValue(makeClient([{ data: null }]))
    const res = await POST(postReq({ resource_id: 'r-1' }), ctx)
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/work-items/[id]/resources auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 400 when resource_id query param is missing', async () => {
    createClient.mockResolvedValue(makeClient([]))
    getAuthClaims.mockResolvedValue(claims)
    const res = await DELETE(delReq(), ctx)
    expect(res.status).toBe(400)
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient([]))
    getAuthClaims.mockResolvedValue(null)
    const res = await DELETE(delReq('?resource_id=r-1'), ctx)
    expect(res.status).toBe(401)
  })
})
