import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifyToken } = vi.hoisted(() => ({ verifyToken: vi.fn() }))
const { createSql } = vi.hoisted(() => ({ createSql: vi.fn() }))

vi.mock('@clerk/backend', () => ({ verifyToken }))
vi.mock('@product-suite/db', () => ({ createSql }))

import app from '../app'

const CHECK_ROW = {
  id: 'check_1',
  work_item_id: 'wi_1',
  title: 'T',
  status: 'todo',
  due_date: null,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-02T00:00:00.000Z',
}

const auth = {
  headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
}

describe('check writes', () => {
  beforeEach(() => {
    verifyToken.mockReset()
    createSql.mockReset()
    process.env.CLERK_SECRET_KEY = 'sk_test'
    process.env.DATABASE_URL = 'postgresql://user:pass@host/db'
    verifyToken.mockResolvedValue({ sub: 'user_clerk_1', exp: 9999999999 })
  })

  it('POST creates a check under an owned work item (201)', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([{ n: 1 }]) // parent ownership check
      .mockResolvedValueOnce([CHECK_ROW]) // insert returning
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/checks', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ work_item_id: 'wi_1', title: 'T' }),
    })
    expect(res.status).toBe(201)
    expect(((await res.json()) as { work_item_id: string }).work_item_id).toBe('wi_1')
  })

  it('POST returns 404 when the parent work item is not the caller’s', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([]) // parent ownership check -> none
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/checks', {
      method: 'POST',
      ...auth,
      body: JSON.stringify({ work_item_id: 'wi_other' }),
    })
    expect(res.status).toBe(404)
  })

  it('POST returns 400 without a work_item_id', async () => {
    const sql = vi.fn().mockResolvedValueOnce([{ tenant_id: 't_1' }])
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/checks', { method: 'POST', ...auth, body: '{}' })
    expect(res.status).toBe(400)
  })

  it('POST /:id/toggle advances the status triad (todo -> in_progress)', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([CHECK_ROW]) // ownedCheck (status todo)
      .mockResolvedValueOnce([{ ...CHECK_ROW, status: 'in_progress' }]) // update returning
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/checks/check_1/toggle', { method: 'POST', headers: auth.headers })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { status: string }).status).toBe('in_progress')
  })

  it('PATCH returns 404 for a check outside the caller’s org', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([]) // ownedCheck -> none
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/checks/check_x', {
      method: 'PATCH',
      ...auth,
      body: JSON.stringify({ title: 'x' }),
    })
    expect(res.status).toBe(404)
  })
})
