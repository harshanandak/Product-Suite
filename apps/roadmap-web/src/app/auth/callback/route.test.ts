import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveCallbackRedirectPath } from '@/lib/roadmap-auth-routing'
import { GET } from './route'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  readCanonicalAuthClaimsFromRequest: vi.fn(),
  sealCanonicalAuthClaims: vi.fn(),
}))

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
}: {
  userProfile?: unknown
  userProfileError?: unknown
  teamMember?: unknown
  teamMemberError?: unknown
  exchangedUser?: unknown
  exchangeError?: unknown
} = {}) {
  const exchangeCodeForSession = vi.fn().mockResolvedValue({
    data: {
      user: exchangedUser,
      session: {
        user: exchangedUser,
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
    expect(response.headers.get('location')).toBe('https://roadmap.example.com/dashboard')
    expect(response.headers.get('set-cookie')).toContain('ps_auth_claims=claims')
    expect(response.headers.get('set-cookie')).toContain('ps_auth_sig=sig')
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
