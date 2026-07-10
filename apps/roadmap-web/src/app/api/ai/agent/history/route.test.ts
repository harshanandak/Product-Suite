import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { GET } from './route'

function req(query = '') {
  return new Request(`http://localhost/api/ai/agent/history${query}`)
}

// Flexible chain resolving single() per table.
function client(tables: Record<string, { data: unknown }>) {
  const from = vi.fn((table: string) => {
    const single = vi.fn(async () => {
      const row = tables[table]?.data ?? null
      return { data: row, error: row ? null : { message: 'not found' } }
    })
    const chain: Record<string, unknown> = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      single,
    }
    return chain
  })
  return { from }
}

describe('GET /api/ai/agent/history auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue({ from: vi.fn() })
    getAuthClaims.mockResolvedValue(null)

    const res = await GET(req('?workspaceId=ws-1'))

    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 400 when workspaceId is missing', async () => {
    createClient.mockResolvedValue({ from: vi.fn() })
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })

    const res = await GET(req())

    expect(res.status).toBe(400)
  })

  it('returns 404 when the workspace does not exist', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(client({ workspaces: { data: null } }))

    const res = await GET(req('?workspaceId=ws-1'))

    expect(res.status).toBe(404)
  })

  it('returns 403 when the claims subject is not a team member', async () => {
    getAuthClaims.mockResolvedValue({ subject: 'user-1', email: 'u@e.com', provider: 'neon' })
    createClient.mockResolvedValue(
      client({ workspaces: { data: { team_id: 'team-1' } }, team_members: { data: null } })
    )

    const res = await GET(req('?workspaceId=ws-1'))

    expect(res.status).toBe(403)
  })
})
