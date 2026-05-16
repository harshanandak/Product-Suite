import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'

import { middleware } from './middleware'

describe('middleware canonical auth wiring', () => {
  it('uses canonical auth middleware for protected routes and legacy mind-map redirects', async () => {
    const protectedResponse = await middleware(
      new NextRequest('https://roadmap.example.com/dashboard'),
    )
    expect(protectedResponse.status).toBe(307)
    expect(protectedResponse.headers.get('location')).toBe('https://roadmap.example.com/login')

    const legacyResponse = await middleware(
      new NextRequest('https://roadmap.example.com/mind-maps/abc'),
    )
    expect(legacyResponse.status).toBe(307)
    expect(legacyResponse.headers.get('location')).toBe('https://roadmap.example.com/canvas/abc')
  })
})
