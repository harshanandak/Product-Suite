import { describe, expect, it } from 'vitest'

import {
  buildCanonicalAuthCookieHeader,
  mapCanonicalSessionToAuthClaims,
  readCanonicalAuthClaimsFromRequest,
  sealCanonicalAuthClaims,
} from '../canonical-auth'

describe('roadmap canonical auth facade', () => {
  it('maps a valid hosted session to shared auth claims', () => {
    const result = mapCanonicalSessionToAuthClaims({
      claims: {
        provider: 'neon',
        subject: 'user_123',
        issuer: 'https://project-123.neon.tech',
        audience: 'roadmap-web',
        email: 'user@example.com',
        tenant_id: 'tenant_123',
        workspace_ids: ['workspace_123'],
        roles: ['owner'],
        permissions: ['roadmap:read'],
        provider_claims: {
          organization_id: 'tenant_123',
          access_token: 'provider-token',
        },
      },
    })

    if (!result.ok) {
      throw new Error(`Expected canonical claims, got ${result.error.code}`)
    }

    expect(result.claims).toMatchObject({
      provider: 'neon',
      subject: 'user_123',
      issuer: 'https://project-123.neon.tech',
      audience: ['roadmap-web'],
      email: 'user@example.com',
      tenant_id: 'tenant_123',
      workspace_ids: ['workspace_123'],
      roles: ['owner'],
      permissions: ['roadmap:read'],
      provider_claims: {
        organization_id: 'tenant_123',
      },
    })
    expect(JSON.stringify(result.claims)).not.toContain('provider-token')
  })

  it('fails closed when a hosted session is missing required subject or email', () => {
    const result = mapCanonicalSessionToAuthClaims({
      claims: {
        provider: 'neon',
        email: '',
      },
    })

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'CANONICAL_AUTH_SESSION_INVALID',
        missing: ['subject', 'email'],
      },
    })
  })

  it('fails closed when signed canonical claims are expired', () => {
    const result = mapCanonicalSessionToAuthClaims(
      {
        claims: {
          provider: 'neon',
          subject: 'user_123',
          email: 'user@example.com',
          expires_at: 1_770_000_000,
        },
      },
      { nowSeconds: 1_770_000_001 },
    )

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'CANONICAL_AUTH_SESSION_INVALID',
        missing: ['expires_at'],
      },
    })
  })

  it('fails closed when signed canonical claims have malformed expiry', () => {
    const result = mapCanonicalSessionToAuthClaims({
      claims: {
        provider: 'neon',
        subject: 'user_123',
        email: 'user@example.com',
        expires_at: 'not-a-number',
      },
    })

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'CANONICAL_AUTH_SESSION_INVALID',
        missing: ['expires_at'],
      },
    })
  })

  it('strips mixed-case sensitive provider claim keys', () => {
    const result = mapCanonicalSessionToAuthClaims({
      claims: {
        provider: 'neon',
        subject: 'user_123',
        email: 'user@example.com',
        provider_claims: {
          organization_id: 'tenant_123',
          Access_Token: 'secret-token-value',
          Refresh_Token: 'refresh-secret',
          provider: 'neon',
        },
      },
    })

    if (!result.ok) {
      throw new Error(`Expected canonical claims, got ${result.error.code}`)
    }

    expect(result.claims.provider_claims).toEqual({
      organization_id: 'tenant_123',
      provider: 'neon',
    })
    expect(JSON.stringify(result.claims)).not.toContain('secret-token-value')
    expect(JSON.stringify(result.claims)).not.toContain('refresh-secret')
  })

  it('reads signed canonical claims from request cookies', async () => {
    const sealed = await sealCanonicalAuthClaims(
      {
        provider: 'neon',
        subject: 'user_123',
        email: 'user@example.com',
      },
      { secret: 'session-secret' },
    )
    const request = new Request('https://roadmap.example.com/dashboard', {
      headers: {
        cookie: buildCanonicalAuthCookieHeader(sealed),
      },
    })

    const result = await readCanonicalAuthClaimsFromRequest(request, {
      secret: 'session-secret',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.claims.subject).toBe('user_123')
    }
  })
})
