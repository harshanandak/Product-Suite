import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifyToken } = vi.hoisted(() => ({ verifyToken: vi.fn() }))

vi.mock('@clerk/backend', () => ({ verifyToken }))

import { clerkAuth, type AuthedEnv } from './clerk-auth'

function testApp() {
  const app = new Hono<AuthedEnv>()
  app.use('*', clerkAuth())
  app.get('/', (c) => c.json({ claims: c.get('claims') }))
  return app
}

describe('clerkAuth middleware', () => {
  beforeEach(() => {
    verifyToken.mockReset()
    process.env.CLERK_SECRET_KEY = 'sk_test'
  })

  it('returns 401 without a bearer token (and never verifies)', async () => {
    const res = await testApp().request('/')
    expect(res.status).toBe(401)
    expect(verifyToken).not.toHaveBeenCalled()
  })

  it('returns 401 when verification throws', async () => {
    verifyToken.mockRejectedValue(new Error('invalid'))
    const res = await testApp().request('/', { headers: { Authorization: 'Bearer bad' } })
    expect(res.status).toBe(401)
  })

  it('returns 401 when the token lacks a subject', async () => {
    verifyToken.mockResolvedValue({ email: 'u@example.com', exp: 9999999999 })
    const res = await testApp().request('/', { headers: { Authorization: 'Bearer x' } })
    expect(res.status).toBe(401)
  })

  it('maps a valid Clerk token to canonical claims on the context', async () => {
    verifyToken.mockResolvedValue({ sub: 'user_1', email: 'u@example.com', org_id: 'org_1', exp: 9999999999 })
    const res = await testApp().request('/', { headers: { Authorization: 'Bearer good' } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { claims: Record<string, unknown> }
    expect(body.claims).toMatchObject({
      subject: 'user_1',
      provider: 'clerk',
      email: 'u@example.com',
      tenant_id: 'org_1',
    })
  })
})
