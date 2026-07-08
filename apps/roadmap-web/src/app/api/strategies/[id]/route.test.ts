import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { GET, PATCH, DELETE } from './route'

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

function getReq() {
  return new NextRequest('http://localhost/api/strategies/strat-1')
}
function bodyReq(method: string, body: unknown) {
  return new NextRequest('http://localhost/api/strategies/strat-1', {
    method,
    body: JSON.stringify(body),
  })
}

describe('GET /api/strategies/[id] auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient({}))
    getAuthClaims.mockResolvedValue(null)
    const res = await GET(getReq(), PARAMS)
    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 404 when the strategy is not found', async () => {
    getAuthClaims.mockResolvedValue(VALID_CLAIMS)
    createClient.mockResolvedValue(makeClient({ product_strategies: { data: null } }))
    const res = await GET(getReq(), PARAMS)
    expect(res.status).toBe(404)
  })

  it('returns 403 for non-members', async () => {
    getAuthClaims.mockResolvedValue(VALID_CLAIMS)
    createClient.mockResolvedValue(
      makeClient({
        product_strategies: { data: { id: 'strat-1', team_id: 'team-1' } },
        team_members: { data: null },
      })
    )
    const res = await GET(getReq(), PARAMS)
    expect(res.status).toBe(403)
  })
})

describe('PATCH /api/strategies/[id] auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient({}))
    getAuthClaims.mockResolvedValue(null)
    const res = await PATCH(bodyReq('PATCH', { title: 'X' }), PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 404 when the strategy is not found', async () => {
    getAuthClaims.mockResolvedValue(VALID_CLAIMS)
    createClient.mockResolvedValue(makeClient({ product_strategies: { data: null } }))
    const res = await PATCH(bodyReq('PATCH', { title: 'X' }), PARAMS)
    expect(res.status).toBe(404)
  })

  it('returns 403 for non-members', async () => {
    getAuthClaims.mockResolvedValue(VALID_CLAIMS)
    createClient.mockResolvedValue(
      makeClient({
        product_strategies: { data: { team_id: 'team-1', type: 'objective', parent_id: null } },
        team_members: { data: null },
      })
    )
    const res = await PATCH(bodyReq('PATCH', { title: 'X' }), PARAMS)
    expect(res.status).toBe(403)
  })
})

describe('DELETE /api/strategies/[id] auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient({}))
    getAuthClaims.mockResolvedValue(null)
    const res = await DELETE(getReq(), PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 404 when the strategy is not found', async () => {
    getAuthClaims.mockResolvedValue(VALID_CLAIMS)
    createClient.mockResolvedValue(makeClient({ product_strategies: { data: null } }))
    const res = await DELETE(getReq(), PARAMS)
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
    const res = await DELETE(getReq(), PARAMS)
    expect(res.status).toBe(403)
  })

  it('returns 403 when the member lacks admin/owner role', async () => {
    getAuthClaims.mockResolvedValue(VALID_CLAIMS)
    createClient.mockResolvedValue(
      makeClient({
        product_strategies: { data: { team_id: 'team-1' } },
        team_members: { data: { role: 'member' } },
      })
    )
    const res = await DELETE(getReq(), PARAMS)
    expect(res.status).toBe(403)
  })
})
