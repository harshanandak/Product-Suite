import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { middleware } from './middleware'

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: mocks.createServerClient,
}))

describe('middleware canonical auth wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.com'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
    mocks.createServerClient.mockImplementation((_url, _anonKey, options) => ({
      auth: {
        getUser: vi.fn().mockImplementation(async () => {
          options.cookies.setAll([
            {
              name: 'sb-project-auth-token',
              value: 'refreshed',
              options: {
                path: '/',
              },
            },
          ])

          return {
            data: {
              user: null,
            },
          }
        }),
      },
    }))
  })

  it('uses canonical auth middleware for protected routes and legacy mind-map redirects', async () => {
    const protectedResponse = await middleware(
      new NextRequest('https://roadmap.example.com/dashboard'),
    )
    expect(protectedResponse.status).toBe(307)
    expect(protectedResponse.headers.get('location')).toBe('https://roadmap.example.com/login')
    expect(protectedResponse.headers.get('set-cookie')).toContain(
      'sb-project-auth-token=refreshed',
    )

    const legacyResponse = await middleware(
      new NextRequest('https://roadmap.example.com/mind-maps/abc'),
    )
    expect(legacyResponse.status).toBe(307)
    expect(legacyResponse.headers.get('location')).toBe('https://roadmap.example.com/canvas/abc')
  })
})
