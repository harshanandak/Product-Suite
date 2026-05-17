import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

import { GET, POST } from './route'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}))

const originalClaimsCookieName = process.env.ROADMAP_CANONICAL_AUTH_CLAIMS_COOKIE
const originalSignatureCookieName = process.env.ROADMAP_CANONICAL_AUTH_SIGNATURE_COOKIE

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}))

function createRequest() {
  return new NextRequest('https://roadmap.example.com/api/auth/signout', {
    headers: {
      cookie: [
        'sb-project-auth-token=supabase-session',
        'ps_auth_claims=canonical-claims',
        'ps_auth_sig=canonical-signature',
      ].join('; '),
    },
  })
}

describe('roadmap auth signout route', () => {
  afterEach(() => {
    if (originalClaimsCookieName === undefined) {
      delete process.env.ROADMAP_CANONICAL_AUTH_CLAIMS_COOKIE
    } else {
      process.env.ROADMAP_CANONICAL_AUTH_CLAIMS_COOKIE = originalClaimsCookieName
    }

    if (originalSignatureCookieName === undefined) {
      delete process.env.ROADMAP_CANONICAL_AUTH_SIGNATURE_COOKIE
    } else {
      process.env.ROADMAP_CANONICAL_AUTH_SIGNATURE_COOKIE = originalSignatureCookieName
    }
  })

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.ROADMAP_CANONICAL_AUTH_CLAIMS_COOKIE
    delete process.env.ROADMAP_CANONICAL_AUTH_SIGNATURE_COOKIE
    mocks.createClient.mockResolvedValue({
      auth: {
        signOut: vi.fn().mockResolvedValue({
          error: null,
        }),
      },
    })
  })

  it('clears Supabase and canonical auth cookies on signout', async () => {
    const response = await GET(createRequest())
    const setCookie = response.headers.get('set-cookie')

    expect(response.headers.get('location')).toBe('https://roadmap.example.com/login')
    expect(setCookie).toContain('sb-project-auth-token=')
    expect(setCookie).toContain('ps_auth_claims=')
    expect(setCookie).toContain('ps_auth_sig=')
    expect(setCookie).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT')
  })

  it('clears configured canonical auth cookie names', async () => {
    process.env.ROADMAP_CANONICAL_AUTH_CLAIMS_COOKIE = 'roadmap_claims'
    process.env.ROADMAP_CANONICAL_AUTH_SIGNATURE_COOKIE = 'roadmap_sig'
    const request = new NextRequest('https://roadmap.example.com/api/auth/signout', {
      headers: {
        cookie: [
          'roadmap_claims=claims',
          'roadmap_sig=signature',
        ].join('; '),
      },
    })

    const response = await POST(request)
    const setCookie = response.headers.get('set-cookie')

    expect(setCookie).toContain('roadmap_claims=')
    expect(setCookie).toContain('roadmap_sig=')
    expect(setCookie).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT')
  })
})
