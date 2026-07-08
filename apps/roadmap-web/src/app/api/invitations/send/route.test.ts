import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: vi.fn() }) },
}))

import { POST } from './route'

const CLAIMS = { subject: 'user-1', email: 'u@e.com', provider: 'neon' }

// Dispatches by table:
//   invitations  -> select -> eq -> single (one eq)
//   team_members -> select -> eq -> eq -> single (two eq)
function client(opts: {
  invitation?: Record<string, unknown> | null
  membership?: { role: string } | null
}) {
  const { invitation = null, membership = null } = opts
  const eqUser = vi.fn(() => ({
    single: async () => ({ data: membership, error: null }),
  }))
  const from = vi.fn((table: string) => {
    if (table === 'invitations') {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: invitation,
              error: invitation ? null : { message: 'not found' },
            }),
          }),
        }),
      }
    }
    if (table === 'team_members') {
      return { select: () => ({ eq: () => ({ eq: eqUser }) }) }
    }
    return {}
  })
  return { from, eqUser }
}

function sendRequest(body: unknown) {
  return new NextRequest('http://localhost/api/invitations/send', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('/api/invitations/send auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 400 when invitationId is missing', async () => {
    const res = await POST(sendRequest({}))
    expect(res.status).toBe(400)
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue({ from: vi.fn() })
    getAuthClaims.mockResolvedValue(null)

    const res = await POST(sendRequest({ invitationId: 'inv-1' }))

    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 404 when the invitation is not found', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    createClient.mockResolvedValue(client({ invitation: null }))

    const res = await POST(sendRequest({ invitationId: 'inv-1' }))

    expect(res.status).toBe(404)
  })

  it('returns 403 and scopes membership by claims subject for non-admins', async () => {
    getAuthClaims.mockResolvedValue(CLAIMS)
    const c = client({ invitation: { team_id: 'team-1' }, membership: null })
    createClient.mockResolvedValue(c)

    const res = await POST(sendRequest({ invitationId: 'inv-1' }))

    expect(res.status).toBe(403)
    expect(c.eqUser).toHaveBeenCalledWith('user_id', 'user-1')
  })
})
