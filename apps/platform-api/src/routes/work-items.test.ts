import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifyToken } = vi.hoisted(() => ({ verifyToken: vi.fn() }))
const { createSql } = vi.hoisted(() => ({ createSql: vi.fn() }))

vi.mock('@clerk/backend', () => ({ verifyToken }))
vi.mock('@product-suite/db', () => ({ createSql }))

import app from '../app'

const ROW = {
  id: 'wi_1',
  title: 'Ship the vertical',
  description: null,
  phase: 'plan',
  type: 'feature',
  priority: 'medium',
  tags: ['platform'],
  source: 'manual',
  project_id: null,
  team_id: 'team_1',
  status_id: 'status_1',
  department: 'Engineering',
  assignee_id: null,
  due_date: null,
  archived: false,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-02T00:00:00.000Z',
}

describe('GET /api/work-items', () => {
  beforeEach(() => {
    verifyToken.mockReset()
    createSql.mockReset()
    process.env.CLERK_SECRET_KEY = 'sk_test'
    process.env.DATABASE_URL = 'postgresql://user:pass@host/db'
    verifyToken.mockResolvedValue({ sub: 'user_clerk_1', email: 'u@example.com', exp: 9999999999 })
  })

  it('returns tenant-scoped work items mapped to the contracts shape', async () => {
    const sql = vi.fn(async () => [ROW])
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/work-items', {
      headers: { Authorization: 'Bearer token' },
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as unknown[]
    expect(body).toHaveLength(1)
    expect(body[0]).toMatchObject({
      id: 'wi_1',
      description: '', // null -> '' at the contract edge
      tags: ['platform'],
      phase: 'plan',
      status_id: 'status_1',
      archived: false,
      due_date: null,
    })

    // The query is scoped by the caller's Clerk subject — proves no cross-tenant leak.
    const params = sql.mock.calls[0]?.slice(1) ?? []
    expect(params).toContain('user_clerk_1')
  })

  it('returns a structured 500 when the DB query fails (not an opaque crash)', async () => {
    const sql = vi.fn(async () => {
      throw new Error('connection reset')
    })
    createSql.mockReturnValue(sql)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await app.request('/api/work-items', {
      headers: { Authorization: 'Bearer token' },
    })

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to load work items' })
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('returns 401 without a bearer token (auth gate before any DB access)', async () => {
    const sql = vi.fn(async () => [ROW])
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/work-items')

    expect(res.status).toBe(401)
    expect(sql).not.toHaveBeenCalled()
  })
})
