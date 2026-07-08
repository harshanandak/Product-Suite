import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { POST, DELETE } from './route'

function makeClient(tableData: Record<string, { data: unknown; error?: unknown }>) {
  const from = vi.fn((table: string) => {
    const result = tableData[table] ?? { data: null }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {}
    const chain = () => builder
    for (const m of ['select', 'eq', 'in', 'is', 'not', 'order', 'update', 'insert', 'upsert', 'delete']) {
      builder[m] = vi.fn(chain)
    }
    builder.single = vi.fn(async () => result)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    builder.then = (resolve: any) => resolve(result)
    return builder
  })
  return { from }
}

const VALID_CLAIMS = { subject: 'user-1', email: 'u@e.com', provider: 'neon' }
const PARAMS = { params: Promise.resolve({ id: 'strat-1' }) }

function req(body: unknown) {
  return new NextRequest('http://localhost/api/strategies/strat-1/align', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/strategies/[id]/align auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 400 when work_item_id is missing', async () => {
    createClient.mockResolvedValue(makeClient({}))
    const res = await POST(req({}), PARAMS)
    expect(res.status).toBe(400)
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient({}))
    getAuthClaims.mockResolvedValue(null)
    const res = await POST(req({ work_item_id: 'wi-1' }), PARAMS)
    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 404 when the strategy is not found', async () => {
    getAuthClaims.mockResolvedValue(VALID_CLAIMS)
    createClient.mockResolvedValue(makeClient({ product_strategies: { data: null } }))
    const res = await POST(req({ work_item_id: 'wi-1' }), PARAMS)
    expect(res.status).toBe(404)
  })

  it('returns 403 for non-members', async () => {
    getAuthClaims.mockResolvedValue(VALID_CLAIMS)
    createClient.mockResolvedValue(
      makeClient({
        product_strategies: { data: { team_id: 'team-1', workspace_id: 'ws-1' } },
        work_items: { data: { team_id: 'team-1', workspace_id: 'ws-1' } },
        team_members: { data: null },
      })
    )
    const res = await POST(req({ work_item_id: 'wi-1' }), PARAMS)
    expect(res.status).toBe(403)
  })
})

describe('DELETE /api/strategies/[id]/align auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  function delReq(body: unknown) {
    return new NextRequest('http://localhost/api/strategies/strat-1/align', {
      method: 'DELETE',
      body: JSON.stringify(body),
    })
  }

  it('returns 400 when work_item_id is missing', async () => {
    createClient.mockResolvedValue(makeClient({}))
    const res = await DELETE(delReq({}), PARAMS)
    expect(res.status).toBe(400)
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient({}))
    getAuthClaims.mockResolvedValue(null)
    const res = await DELETE(delReq({ work_item_id: 'wi-1' }), PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 404 when the strategy is not found', async () => {
    getAuthClaims.mockResolvedValue(VALID_CLAIMS)
    createClient.mockResolvedValue(makeClient({ product_strategies: { data: null } }))
    const res = await DELETE(delReq({ work_item_id: 'wi-1' }), PARAMS)
    expect(res.status).toBe(404)
  })

  it('returns 403 for non-members', async () => {
    getAuthClaims.mockResolvedValue(VALID_CLAIMS)
    createClient.mockResolvedValue(
      makeClient({
        product_strategies: { data: { team_id: 'team-1' } },
        team_members: { data: null },
      })
    )
    const res = await DELETE(delReq({ work_item_id: 'wi-1' }), PARAMS)
    expect(res.status).toBe(403)
  })
})
