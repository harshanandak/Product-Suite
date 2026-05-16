import { describe, expect, it } from 'vitest'

import { resolveCallbackRedirectPath } from '@/lib/roadmap-auth-routing'

describe('auth callback canonical routing', () => {
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
})
