import { describe, expect, it } from 'vitest'

import { resolveHomeRedirectPath } from '@/lib/roadmap-auth-routing'

describe('home canonical auth routing', () => {
  it('redirects canonical sessions to dashboard and leaves anonymous traffic public', () => {
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
})
