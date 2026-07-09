import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifyToken } = vi.hoisted(() => ({ verifyToken: vi.fn() }))

vi.mock('@clerk/backend', () => ({ verifyToken }))

import app from './app'

const authed = (token = 'good') => ({ headers: { Authorization: `Bearer ${token}` } })

describe('platform-api auth spine', () => {
  beforeEach(() => {
    verifyToken.mockReset()
    process.env.CLERK_SECRET_KEY = 'sk_test'
  })

  it('exposes a public health check', async () => {
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('returns 401 for /api/* without a bearer token', async () => {
    const res = await app.request('/api/me')
    expect(res.status).toBe(401)
    expect(verifyToken).not.toHaveBeenCalled()
  })

  it('returns 401 when the Clerk token fails verification', async () => {
    verifyToken.mockRejectedValue(new Error('invalid token'))
    const res = await app.request('/api/me', authed('bad'))
    expect(res.status).toBe(401)
  })

  it('returns 401 when the verified token has no subject', async () => {
    verifyToken.mockResolvedValue({ email: 'user@example.com', exp: 9999999999 })
    const res = await app.request('/api/me', authed())
    expect(res.status).toBe(401)
  })

  it('returns the caller canonical claims for a valid Clerk token', async () => {
    verifyToken.mockResolvedValue({
      sub: 'user_123',
      email: 'user@example.com',
      org_id: 'org_1',
      exp: 9999999999,
    })

    const res = await app.request('/api/me', authed())

    expect(res.status).toBe(200)
    const body = (await res.json()) as { claims: { subject: string; provider: string; email: string } }
    expect(body.claims.subject).toBe('user_123')
    expect(body.claims.provider).toBe('clerk')
    expect(body.claims.email).toBe('user@example.com')
  })
})
