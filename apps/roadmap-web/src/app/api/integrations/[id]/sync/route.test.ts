import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))
vi.mock('@/lib/ai/mcp', () => ({ mcpGateway: { isAvailable: vi.fn(), callTool: vi.fn() } }))

import { POST } from './route'

const CLAIMS = { subject: 'user-1', email: 'u@e.com', provider: 'neon' }
const ctx = { params: Promise.resolve({ id: 'int-1' }) }

// Dispatches by table:
//   team_members -> select -> eq -> single (one eq)
//   organization_integrations -> select -> eq -> eq -> single (two eq)
function client(opts: {
  membership?: { team_id: string } | null
  integration?: { id: string; provider: string; status: string } | null
}) {
  const { membership = null, integration = null } = opts
  const from = vi.fn((table: string) => {
    if (table === 'team_members') {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: membership,
              error: membership ? null : { message: 'no team' },
            }),
          }),
        }),
      }
    }
    if (table === 'organization_integrations') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: async () => ({
                data: integration,
                error: integration ? null : { message: 'no integration' },
              }),
            }),
          }),
        }),
      }
    }
    return {}
  })
  return { from }
}

function syncRequest(body: unknown) {
  return new NextRequest('http://localhost/api/integrations/int-1/sync', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('/api/integrations/[id]/sync auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue({ from: vi.fn() })
    getAuthClaims.mockResolvedValue(null)

    const res = await POST(syncRequest({ syncType: 'import' }), ctx)

    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 404 when the claims subject has no team', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(client({ membership: null }))

    const res = await POST(syncRequest({ syncType: 'import' }), ctx)

    expect(res.status).toBe(404)
  })

  it('returns 404 when the integration is not found', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(client({ membership: { team_id: 'team-1' }, integration: null }))

    const res = await POST(syncRequest({ syncType: 'import' }), ctx)

    expect(res.status).toBe(404)
  })

  it('returns 400 when the integration is not connected', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(
      client({
        membership: { team_id: 'team-1' },
        integration: { id: 'int-1', provider: 'github', status: 'pending' },
      })
    )

    const res = await POST(syncRequest({ syncType: 'import' }), ctx)

    expect(res.status).toBe(400)
  })
})
