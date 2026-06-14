import { NextRequest, NextResponse } from 'next/server'
import { describe, expect, it } from 'vitest'

import { buildCanonicalAuthCookieHeader, sealCanonicalAuthClaims } from '../canonical-auth'
import { updateCanonicalAuthSession } from '../canonical-auth-middleware'

describe('roadmap canonical auth middleware', () => {
  it('redirects protected routes without a canonical session to login', async () => {
    const response = await updateCanonicalAuthSession(
      new NextRequest('https://roadmap.example.com/dashboard'),
      { secret: 'session-secret' },
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://roadmap.example.com/login')
  })

  it('redirects auth pages with a canonical session to dashboard', async () => {
    const sealed = await sealCanonicalAuthClaims(
      {
        provider: 'neon',
        subject: 'user_123',
        email: 'user@example.com',
      },
      { secret: 'session-secret' },
    )
    const response = await updateCanonicalAuthSession(
      new NextRequest('https://roadmap.example.com/login', {
        headers: {
          cookie: buildCanonicalAuthCookieHeader(sealed),
        },
      }),
      { secret: 'session-secret' },
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://roadmap.example.com/dashboard')
  })

  it('lets authenticated auth callbacks with provider codes reach the callback handler', async () => {
    const sealed = await sealCanonicalAuthClaims(
      {
        provider: 'neon',
        subject: 'user_123',
        email: 'user@example.com',
      },
      { secret: 'session-secret' },
    )
    const response = await updateCanonicalAuthSession(
      new NextRequest('https://roadmap.example.com/auth/callback?code=fresh-code', {
        headers: {
          cookie: buildCanonicalAuthCookieHeader(sealed),
        },
      }),
      { secret: 'session-secret' },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })

  it('keeps the legacy mind maps redirect independent from auth', async () => {
    const response = await updateCanonicalAuthSession(
      new NextRequest('https://roadmap.example.com/mind-maps/abc'),
      { secret: 'session-secret' },
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://roadmap.example.com/canvas/abc')
  })

  it('preserves refreshed Supabase cookies on canonical auth responses', async () => {
    const request = new NextRequest('https://roadmap.example.com/dashboard')
    const refreshedSessionResponse = NextResponse.next({
      request,
    })
    refreshedSessionResponse.cookies.set('sb-project-auth-token', 'refreshed', {
      path: '/',
    })

    const response = await updateCanonicalAuthSession(request, {
      response: refreshedSessionResponse,
      secret: 'session-secret',
    })

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://roadmap.example.com/login')
    expect(response.headers.get('set-cookie')).toContain('sb-project-auth-token=refreshed')
  })
})
