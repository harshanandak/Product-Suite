import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifyToken } = vi.hoisted(() => ({ verifyToken: vi.fn() }))
const { createSql } = vi.hoisted(() => ({ createSql: vi.fn() }))

vi.mock('@clerk/backend', () => ({ verifyToken }))
vi.mock('@product-suite/db', () => ({ createSql }))

import app from '../app'

const ROW = {
  id: 'dep_1',
  source_item_id: 'wi_1',
  target_item_id: 'wi_2',
  relationship_type: 'depends_on',
  created_at: '2026-07-01T00:00:00.000Z',
}

describe('GET /api/dependencies', () => {
  beforeEach(() => {
    verifyToken.mockReset()
    createSql.mockReset()
    process.env.CLERK_SECRET_KEY = 'sk_test'
    process.env.DATABASE_URL = 'postgresql://user:pass@host/db'
    verifyToken.mockResolvedValue({ sub: 'user_clerk_1', exp: 9999999999 })
  })

  it('returns tenant-scoped dependency edges mapped to the contracts shape', async () => {
    const sql = vi.fn(async () => [ROW])
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/dependencies', {
      headers: { Authorization: 'Bearer token' },
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>[]
    expect(body[0]).toMatchObject({
      id: 'dep_1',
      source_item_id: 'wi_1',
      target_item_id: 'wi_2',
      relationship_type: 'depends_on',
    })
    // tenant_id is the scope anchor — never leaked to the client.
    expect(body[0]).not.toHaveProperty('tenant_id')
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
    const res = await app.request('/api/dependencies', {
      headers: { Authorization: 'Bearer token' },
    })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to load dependencies' })
    errorSpy.mockRestore()
  })

  it('returns 401 without a bearer token (no DB access)', async () => {
    const sql = vi.fn(async () => [ROW])
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/dependencies')
    expect(res.status).toBe(401)
    expect(sql).not.toHaveBeenCalled()
  })
})
