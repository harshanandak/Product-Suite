import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { GET, POST } from './route'

// Chainable Supabase mock. `tableData[table]` is the `{ data, error }` result
// resolved by both `.single()` and awaiting a terminal query.
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
  return { from, rpc: vi.fn(async () => ({ error: null })) }
}

const VALID_CLAIMS = { subject: 'user-1', email: 'u@e.com', provider: 'neon' }

function postReq(body: unknown) {
  return new NextRequest('http://localhost/api/strategies', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('GET /api/strategies auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 400 when team_id is missing', async () => {
    createClient.mockResolvedValue(makeClient({}))
    const res = await GET(new NextRequest('http://localhost/api/strategies'))
    expect(res.status).toBe(400)
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient({}))
    getAuthClaims.mockResolvedValue(null)
    const res = await GET(new NextRequest('http://localhost/api/strategies?team_id=team-1'))
    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 403 for non-members', async () => {
    getAuthClaims.mockResolvedValue(VALID_CLAIMS)
    createClient.mockResolvedValue(makeClient({ team_members: { data: null } }))
    const res = await GET(new NextRequest('http://localhost/api/strategies?team_id=team-1'))
    expect(res.status).toBe(403)
  })
})

describe('POST /api/strategies auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 400 when required fields are missing', async () => {
    createClient.mockResolvedValue(makeClient({}))
    const res = await POST(postReq({ team_id: 'team-1' }))
    expect(res.status).toBe(400)
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(makeClient({}))
    getAuthClaims.mockResolvedValue(null)
    const res = await POST(postReq({ team_id: 'team-1', type: 'pillar', title: 'T' }))
    expect(res.status).toBe(401)
  })

  it('returns 403 for non-members', async () => {
    getAuthClaims.mockResolvedValue(VALID_CLAIMS)
    createClient.mockResolvedValue(makeClient({ team_members: { data: null } }))
    const res = await POST(postReq({ team_id: 'team-1', type: 'pillar', title: 'T' }))
    expect(res.status).toBe(403)
  })
})
