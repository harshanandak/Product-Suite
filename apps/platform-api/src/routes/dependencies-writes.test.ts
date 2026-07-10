import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifyToken } = vi.hoisted(() => ({ verifyToken: vi.fn() }))
const { createSql } = vi.hoisted(() => ({ createSql: vi.fn() }))

vi.mock('@clerk/backend', () => ({ verifyToken }))
vi.mock('@product-suite/db', () => ({ createSql }))

import app from '../app'

const DEP_ROW = {
  id: 'dep_1',
  source_item_id: 'wi_1',
  target_item_id: 'wi_2',
  relationship_type: 'depends_on',
  created_at: '2026-07-01T00:00:00.000Z',
}

const OWNED_ITEMS = [
  { id: 'wi_1', tenant_id: 't_1' },
  { id: 'wi_2', tenant_id: 't_1' },
]

const auth = {
  headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
}

function addBody(source = 'wi_1', target = 'wi_2') {
  return JSON.stringify({ source_item_id: source, target_item_id: target })
}

describe('dependency writes', () => {
  beforeEach(() => {
    verifyToken.mockReset()
    createSql.mockReset()
    process.env.CLERK_SECRET_KEY = 'sk_test'
    process.env.DATABASE_URL = 'postgresql://user:pass@host/db'
    verifyToken.mockResolvedValue({ sub: 'user_clerk_1', exp: 9999999999 })
  })

  it('POST creates a valid edge (201)', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce(OWNED_ITEMS) // both items owned, same org
      .mockResolvedValueOnce([]) // cycle check -> none
      .mockResolvedValueOnce([DEP_ROW]) // insert returning
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/dependencies', { method: 'POST', ...auth, body: addBody() })
    expect(res.status).toBe(201)
    expect(((await res.json()) as { id: string }).id).toBe('dep_1')
  })

  it('POST rejects a self-loop (400)', async () => {
    const sql = vi.fn().mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds only
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/dependencies', {
      method: 'POST',
      ...auth,
      body: addBody('wi_1', 'wi_1'),
    })
    expect(res.status).toBe(400)
  })

  it('POST returns 404 when an endpoint is not the caller’s', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([OWNED_ITEMS[0]]) // only one item resolved
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/dependencies', { method: 'POST', ...auth, body: addBody() })
    expect(res.status).toBe(404)
  })

  it('POST rejects an edge that would create a cycle (409)', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce(OWNED_ITEMS) // both owned
      .mockResolvedValueOnce([{ id: 'wi_1' }]) // cycle check -> reachable
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/dependencies', { method: 'POST', ...auth, body: addBody() })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toMatch(/cycle/i)
  })

  it('POST maps a unique-violation to 409 (duplicate edge)', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce(OWNED_ITEMS) // both owned
      .mockResolvedValueOnce([]) // cycle check -> none
      .mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' })) // insert
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/dependencies', { method: 'POST', ...auth, body: addBody() })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toMatch(/already exists/i)
  })

  it('DELETE removes an owned edge (204)', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([{ id: 'dep_1' }]) // delete returning
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/dependencies/dep_1', { method: 'DELETE', headers: auth.headers })
    expect(res.status).toBe(204)
  })

  it('DELETE returns 404 for an edge outside the caller’s org', async () => {
    const sql = vi.fn()
    sql
      .mockResolvedValueOnce([{ tenant_id: 't_1' }]) // callerTenantIds
      .mockResolvedValueOnce([]) // delete returning -> none
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/dependencies/dep_x', { method: 'DELETE', headers: auth.headers })
    expect(res.status).toBe(404)
  })
})
