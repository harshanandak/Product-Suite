import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { POST } from './route'

const CLAIMS = { subject: 'user-1', email: 'u@e.com', provider: 'neon' }

function req(body: unknown) {
  return new Request('http://localhost/api/ai/strategies/suggest', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

// Chainable Supabase query stub whose terminal .single() resolves per-table.
function tableClient(byTable: Record<string, { data: unknown }>) {
  const chain = (result: { data: unknown }) => {
    const p: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'is', 'in', 'not', 'limit']) p[m] = () => p
    p.single = () => Promise.resolve(result)
    return p
  }
  return { from: (table: string) => chain(byTable[table] ?? { data: null }) }
}

describe('POST /api/ai/strategies/suggest auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 400 when team_id is missing', async () => {
    const res = await POST(req({}))
    expect(res.status).toBe(400)
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue(tableClient({}))
    getAuthClaims.mockResolvedValue(null)
    const res = await POST(req({ team_id: 'team-1' }))
    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 403 when the claims subject is not a team member', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(tableClient({ team_members: { data: null } }))
    const res = await POST(req({ team_id: 'team-1' }))
    expect(res.status).toBe(403)
  })
})
