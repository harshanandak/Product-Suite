import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAuthClaims } = vi.hoisted(() => ({ getAuthClaims: vi.fn() }))
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/get-auth-claims', () => ({ getAuthClaims }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))

import { GET } from './route'

const URL_WITH_EMAIL = 'http://localhost/api/debug/member-status?email=x@y.com'

describe('GET /api/debug/member-status auth', () => {
  beforeEach(() => {
    getAuthClaims.mockReset()
    createClient.mockReset()
  })

  it('returns 401 when there are no canonical auth claims', async () => {
    createClient.mockResolvedValue({ from: vi.fn() })
    getAuthClaims.mockResolvedValue(null)

    const res = await GET(new NextRequest(URL_WITH_EMAIL))

    expect(res.status).toBe(401)
    expect(getAuthClaims).toHaveBeenCalled()
  })

  it('returns 400 when the email param is missing', async () => {
    createClient.mockResolvedValue({ from: vi.fn() })
    getAuthClaims.mockResolvedValue({ subject: 'user-1' })

    const res = await GET(new NextRequest('http://localhost/api/debug/member-status'))

    expect(res.status).toBe(400)
  })

  it('scopes the team lookup by claims.subject and returns 403 for non-members', async () => {
    const single = vi.fn(async () => ({ data: null }))
    const eqUser = vi.fn(() => ({ single }))
    const select = vi.fn(() => ({ eq: eqUser }))
    const from = vi.fn(() => ({ select }))
    createClient.mockResolvedValue({ from })
    getAuthClaims.mockResolvedValue({ subject: 'user-1' })

    const res = await GET(new NextRequest(URL_WITH_EMAIL))

    expect(res.status).toBe(403)
    expect(eqUser).toHaveBeenCalledWith('user_id', 'user-1')
  })
})
