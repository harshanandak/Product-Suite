import { createServerClient } from '@supabase/ssr'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { refreshSupabaseAuthSession } from './middleware'

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(),
}))

type SupabaseCookieSetter = {
  cookies: {
    setAll: (cookies: Array<{ name: string; value: string; options: { path: string } }>) => void
  }
}

describe('roadmap Supabase middleware session refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.com'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  })

  it('returns the refreshed Supabase response cookies without applying route redirects', async () => {
    vi.mocked(createServerClient).mockImplementation((_url, _anonKey, options) => ({
      auth: {
        getUser: vi.fn().mockImplementation(async () => {
          const cookieOptions = options as SupabaseCookieSetter
          cookieOptions.cookies.setAll([
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
              user: {
                id: 'user_123',
              },
            },
          }
        }),
      },
    }) as never)

    const result = await refreshSupabaseAuthSession(
      new NextRequest('https://roadmap.example.com/dashboard'),
    )

    expect(result.user).toEqual({
      id: 'user_123',
    })
    expect(result.response.status).toBe(200)
    expect(result.response.headers.get('set-cookie')).toContain(
      'sb-project-auth-token=refreshed',
    )
  })
})
