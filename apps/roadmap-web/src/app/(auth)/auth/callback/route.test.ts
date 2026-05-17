import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveCallbackRedirectPath } from '@/lib/roadmap-auth-routing'
import { GET } from './route'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  readCanonicalAuthClaimsFromRequest: vi.fn(),
  sealCanonicalAuthClaims: vi.fn(),
}))

const originalCanonicalAuthSecret = process.env.ROADMAP_CANONICAL_AUTH_SECRET

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}))

vi.mock('@/lib/canonical-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/canonical-auth')>()
  return {
    ...actual,
    readCanonicalAuthClaimsFromRequest: mocks.readCanonicalAuthClaimsFromRequest,
    sealCanonicalAuthClaims: mocks.sealCanonicalAuthClaims,
  }
})

function createSupabaseMock({
  userProfile = { id: 'user_123' },
  userProfileError = null,
  teamMember = { team_id: 'team_123' },
  teamMemberError = null,
  exchangedUser = {
    id: 'user_123',
    email: 'user@example.com',
  },
  exchangeError = null,
  expiresAt = 1_770_000_000,
}: {
  userProfile?: unknown
  userProfileError?: unknown
  teamMember?: unknown
  teamMemberError?: unknown
  exchangedUser?: unknown
  exchangeError?: unknown
  expiresAt?: unknown
} = {}) {
  const exchangeCodeForSession = vi.fn().mockResolvedValue({
    data: {
      user: exchangedUser,
      session: {
        user: exchangedUser,
        expires_at: expiresAt,
      },
    },
    error: exchangeError,
  })

  const createQuery = (result: unknown) => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      limit: vi.fn(() => query),
      maybeSingle: vi.fn().mockResolvedValue(result),
    }
    return query
  }

  const usersQuery = createQuery({
    data: userProfile,
    error: userProfileError,
  })
  const teamMembersQuery = createQuery({
    data: teamMember,
    error: teamMemberError,
  })

  return {
    auth: {
      exchangeCodeForSession,
    },
    from: vi.fn((table: string) => {
      if (table === 'users') {
        return usersQuery
      }
      if (table === 'team_members') {
        return teamMembersQuery
      }
      throw new Error(`Unexpected table ${table}`)
    }),
    usersQuery,
    teamMembersQuery,
  }
}

describe('auth callback canonical routing', () => {
  afterEach(() => {
    if (originalCanonicalAuthSecret === undefined) {
      delete process.env.ROADMAP_CANONICAL_AUTH_SECRET
    } else {
      process.env.ROADMAP_CANONICAL_AUTH_SECRET = originalCanonicalAuthSecret
    }
  })

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ROADMAP_CANONICAL_AUTH_SECRET = 'session-secret'
    mocks.readCanonicalAuthClaimsFromRequest.mockResolvedValue({
      ok: true,
      claims: {
        provider: 'neon',
        subject: 'user_123',
        email: 'user@example.com',
      },
    })
    mocks.sealCanonicalAuthClaims.mockResolvedValue({
      claimsCookieName: 'ps_auth_claims',
      claimsValue: 'claims',
      signatureCookieName: 'ps_auth_sig',
      signatureValue: 'sig',
    })
  })

  it('fails closed without canonical claims and keeps onboarding checks after auth', () => {
    expect(
      resolveCallbackRedirectPath({
        claimsResult: {
          ok: false,
          error: {
            code: 'CANONICAL_AUTH_SESSION_MISSING',
            missing: ['session'],
          },
        },
      }),
    ).toBe('/login')

    expect(
      resolveCallbackRedirectPath({
        claimsResult: {
          ok: true,
          claims: {
            provider: 'neon',
            subject: 'user_123',
            email: 'user@example.com',
          },
        },
        hasUserProfile: true,
        hasTeamMembership: false,
      }),
    ).toBe('/onboarding')
  })

  it('exchanges legacy Supabase callback codes before requiring canonical cookies', async () => {
    mocks.readCanonicalAuthClaimsFromRequest.mockResolvedValue({
      ok: false,
      error: {
        code: 'CANONICAL_AUTH_SESSION_MISSING',
        missing: ['session'],
      },
    })
    const supabase = createSupabaseMock()
    mocks.createClient.mockResolvedValue(supabase)

    const response = await GET(
      new Request('https://roadmap.example.com/auth/callback?code=legacy-code') as never,
    )

    expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith('legacy-code')
    expect(mocks.sealCanonicalAuthClaims).toHaveBeenCalled()
    expect(mocks.sealCanonicalAuthClaims).toHaveBeenCalledWith(
      expect.objectContaining({
        expires_at: 1_770_000_000,
      }),
      {
        secret: 'session-secret',
      },
    )
    expect(response.headers.get('location')).toBe('https://roadmap.example.com/dashboard')
    expect(response.headers.get('set-cookie')).toContain('ps_auth_claims=claims')
    expect(response.headers.get('set-cookie')).toContain('ps_auth_sig=sig')
    expect(response.headers.get('set-cookie')).toContain(
      'Expires=Mon, 02 Feb 2026 02:40:00 GMT',
    )
  })

  it('uses incoming callback code instead of stale canonical cookies', async () => {
    mocks.readCanonicalAuthClaimsFromRequest.mockResolvedValue({
      ok: true,
      claims: {
        provider: 'neon',
        subject: 'stale_user',
        email: 'stale@example.com',
      },
    })
    const supabase = createSupabaseMock({
      exchangedUser: {
        id: 'fresh_user',
        email: 'fresh@example.com',
      },
      userProfile: {
        id: 'fresh_user',
      },
    })
    mocks.createClient.mockResolvedValue(supabase)

    const response = await GET(
      new Request('https://roadmap.example.com/auth/callback?code=fresh-code') as never,
    )

    expect(mocks.readCanonicalAuthClaimsFromRequest).not.toHaveBeenCalled()
    expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith('fresh-code')
    expect(supabase.usersQuery.eq).toHaveBeenCalledWith('id', 'fresh_user')
    expect(mocks.sealCanonicalAuthClaims).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'fresh_user',
        email: 'fresh@example.com',
        expires_at: 1_770_000_000,
      }),
      {
        secret: 'session-secret',
      },
    )
    expect(response.headers.get('location')).toBe('https://roadmap.example.com/dashboard')
  })

  it('fails closed when callback exchange does not provide an expiry', async () => {
    const supabase = createSupabaseMock({
      expiresAt: null,
    })
    mocks.createClient.mockResolvedValue(supabase)

    const response = await GET(
      new Request('https://roadmap.example.com/auth/callback?code=no-expiry') as never,
    )

    expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith('no-expiry')
    expect(mocks.sealCanonicalAuthClaims).not.toHaveBeenCalled()
    expect(response.headers.get('location')).toBe('https://roadmap.example.com/login')
  })

  it('normalizes invalid exchanged users into canonical auth failures', async () => {
    const supabase = createSupabaseMock({
      exchangedUser: {
        email: 'missing-subject@example.com',
      },
    })
    mocks.createClient.mockResolvedValue(supabase)

    const response = await GET(
      new Request('https://roadmap.example.com/auth/callback?code=invalid-user') as never,
    )

    expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith('invalid-user')
    expect(mocks.sealCanonicalAuthClaims).not.toHaveBeenCalled()
    expect(response.headers.get('location')).toBe('https://roadmap.example.com/login')
  })

  it('uses maybeSingle for onboarding checks and fails closed on query errors', async () => {
    const supabase = createSupabaseMock({
      userProfile: null,
      userProfileError: {
        message: 'RLS denied',
      },
    })
    mocks.createClient.mockResolvedValue(supabase)

    const response = await GET(
      new Request('https://roadmap.example.com/auth/callback') as never,
    )

    expect(supabase.usersQuery.maybeSingle).toHaveBeenCalled()
    expect(supabase.teamMembersQuery.maybeSingle).toHaveBeenCalled()
    expect(response.headers.get('location')).toBe('https://roadmap.example.com/login')
  })
})
