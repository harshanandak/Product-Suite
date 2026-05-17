import { describe, expect, it } from 'vitest'

import { resolveCallbackRedirectPath, resolveHomeRedirectPath } from '../roadmap-auth-routing'

describe('roadmap canonical auth routing', () => {
  it('sends authenticated home traffic to the dashboard', () => {
    expect(
      resolveHomeRedirectPath({
        ok: true,
        claims: {
          provider: 'neon',
          subject: 'user_123',
          email: 'user@example.com',
        },
      }),
    ).toBe('/dashboard')
  })

  it('keeps unauthenticated home traffic on the landing page', () => {
    expect(
      resolveHomeRedirectPath({
        ok: false,
        error: {
          code: 'CANONICAL_AUTH_SESSION_MISSING',
          missing: ['session'],
        },
      }),
    ).toBeNull()
  })

  it('fails closed to login when callback has no canonical user', () => {
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
  })

  it('uses safe return paths only after canonical auth succeeds', () => {
    const claimsResult = {
      ok: true as const,
      claims: {
        provider: 'neon',
        subject: 'user_123',
        email: 'user@example.com',
      },
    }

    expect(
      resolveCallbackRedirectPath({
        claimsResult,
        returnTo: '/workspaces/one',
        hasUserProfile: true,
        hasTeamMembership: true,
      }),
    ).toBe('/workspaces/one')
    expect(
      resolveCallbackRedirectPath({
        claimsResult,
        returnTo: 'https://evil.example.com',
        hasUserProfile: true,
        hasTeamMembership: true,
      }),
    ).toBe('/dashboard')
  })
})
