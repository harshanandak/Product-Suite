import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifyToken } = vi.hoisted(() => ({ verifyToken: vi.fn() }))
const { createSql } = vi.hoisted(() => ({ createSql: vi.fn() }))

vi.mock('@clerk/backend', () => ({ verifyToken }))
vi.mock('@product-suite/db', () => ({ createSql }))

import app from '../app'

describe('GET /api/owners', () => {
  beforeEach(() => {
    verifyToken.mockReset()
    createSql.mockReset()
    process.env.CLERK_SECRET_KEY = 'sk_test'
    process.env.DATABASE_URL = 'postgresql://user:pass@host/db'
    verifyToken.mockResolvedValue({ sub: 'user_clerk_1', exp: 9999999999 })
  })

  it('maps tenant members to owners, deriving initials and email fallback', async () => {
    const sql = vi.fn(async () => [
      { id: 'u_1', name: 'Ada Lovelace', email: 'ada@example.com' },
      { id: 'u_2', name: null, email: 'grace@example.com' }, // null name -> email fallback
    ])
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/owners', { headers: { Authorization: 'Bearer token' } })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; name: string; initials: string }[]
    expect(body[0]).toEqual({ id: 'u_1', name: 'Ada Lovelace', initials: 'AL' })
    expect(body[1]).toEqual({ id: 'u_2', name: 'grace@example.com', initials: 'GR' })
    const params = sql.mock.calls[0]?.slice(1) ?? []
    expect(params).toContain('user_clerk_1')
  })

  it('returns a structured 500 when the DB query fails', async () => {
    createSql.mockReturnValue(
      vi.fn(async () => {
        throw new Error('connection reset')
      }),
    )
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await app.request('/api/owners', { headers: { Authorization: 'Bearer token' } })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to load owners' })
    errorSpy.mockRestore()
  })

  it('returns 401 without a bearer token (no DB access)', async () => {
    const sql = vi.fn(async () => [])
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/owners')
    expect(res.status).toBe(401)
    expect(sql).not.toHaveBeenCalled()
  })
})
