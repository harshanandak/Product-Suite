import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifyToken } = vi.hoisted(() => ({ verifyToken: vi.fn() }))
const { createSql } = vi.hoisted(() => ({ createSql: vi.fn() }))
const { createWorkItem, updateWorkItem } = vi.hoisted(() => ({
  createWorkItem: vi.fn(),
  updateWorkItem: vi.fn(),
}))

vi.mock('@clerk/backend', () => ({ verifyToken }))
vi.mock('@product-suite/db', () => ({ createSql }))
vi.mock('../domain/work-items', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../domain/work-items')>()),
  createWorkItem,
  updateWorkItem,
}))

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
  version: 7,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-02T00:00:00.000Z',
}

const COMPLETE_PROVENANCE_ROW = {
  ...ROW,
  source: 'agent',
  applied_from_proposal_id: 'proposal_1',
  proposal_available: true,
  actor_type: 'agent',
  actor_id: 'run_1',
  on_behalf_of: 'user_approver',
  run_id: 'run_1',
  run_summary: 'Prepared the launch work',
  approver_id: 'user_approver',
  approver_name: 'Ada Lovelace',
  approved_at: '2026-07-02T09:30:00.000Z',
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
      version: 7,
    })

    // The query is scoped by the caller's Clerk subject — proves no cross-tenant leak.
    const params = sql.mock.calls[0]?.slice(1) ?? []
    expect(params).toContain('user_clerk_1')
  })

  it('projects complete agent, proposal, run, and approver provenance', async () => {
    const sql = vi.fn(async () => [COMPLETE_PROVENANCE_ROW])
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/work-items', {
      headers: { Authorization: 'Bearer token' },
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<Record<string, unknown>>
    expect(body[0]?.provenance).toEqual({
      applied_from_proposal_id: 'proposal_1',
      proposal_available: true,
      actor_type: 'agent',
      actor_id: 'run_1',
      on_behalf_of: 'user_approver',
      run_id: 'run_1',
      run_summary: 'Prepared the launch work',
      approver_id: 'user_approver',
      approver_name: 'Ada Lovelace',
      approved_at: '2026-07-02T09:30:00.000Z',
    })
  })

  it('fails closed when proposal, run, or approver relationships cross tenants', async () => {
    const sql = vi.fn(async () => [
      {
        ...COMPLETE_PROVENANCE_ROW,
        id: 'wi_cross_proposal',
        applied_from_proposal_id: 'proposal_foreign_reference',
        proposal_available: false,
        approver_id: null,
        approver_name: null,
        approved_at: null,
      },
      {
        ...COMPLETE_PROVENANCE_ROW,
        id: 'wi_cross_run',
        actor_id: 'run_foreign_reference',
        run_id: 'run_foreign_reference',
        run_summary: null,
      },
      {
        ...COMPLETE_PROVENANCE_ROW,
        id: 'wi_cross_approver',
        approver_id: 'user_foreign_reference',
        approver_name: null,
      },
    ])
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/work-items', {
      headers: { Authorization: 'Bearer token' },
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<{ provenance?: Record<string, unknown> }>
    expect(body[0]?.provenance).toMatchObject({
      applied_from_proposal_id: 'proposal_foreign_reference',
      proposal_available: false,
      approver_id: null,
      approver_name: null,
      approved_at: null,
    })
    expect(body[1]?.provenance).toMatchObject({
      actor_id: 'run_foreign_reference',
      run_id: 'run_foreign_reference',
      run_summary: null,
    })
    expect(body[2]?.provenance).toMatchObject({
      approver_id: 'user_foreign_reference',
      approver_name: null,
    })

    const queryParts = (sql.mock.calls as unknown as Array<[TemplateStringsArray]>)[0]?.[0]
    expect(queryParts).toBeDefined()
    const query = queryParts!
      .join('?')
      .replace(/\s+/g, ' ')
      .toLowerCase()
    expect(query).toMatch(
      /left join proposals p on p\.id = wi\.applied_from_proposal_id and p\.tenant_id = wi\.tenant_id/,
    )
    expect(query).toMatch(
      /left join agent_runs ar on ar\.id = wi\.run_id and ar\.tenant_id = wi\.tenant_id/,
    )
    expect(query).toMatch(
      /left join organization_memberships approver_membership on approver_membership\.user_id = p\.decided_by and approver_membership\.tenant_id = wi\.tenant_id/,
    )
    expect(query).toMatch(
      /left join users approver on approver\.id = approver_membership\.user_id/,
    )
    expect(query).toMatch(
      /wi\.applied_from_proposal_id, p\.id is not null as proposal_available, wi\.actor_type/,
    )
    expect(query).toMatch(/wi\.run_id, ar\.summary as run_summary/)
    expect(query).toMatch(/p\.decided_by as approver_id/)
    expect(query).not.toMatch(/approver_membership\.status = 'active'/)
  })

  it('keeps partial legacy facts and omits provenance for a manual item without any', async () => {
    const sql = vi.fn(async () => [
      {
        ...COMPLETE_PROVENANCE_ROW,
        id: 'wi_missing_proposal',
        applied_from_proposal_id: null,
        approver_id: null,
        approver_name: null,
        approved_at: null,
      },
      {
        ...COMPLETE_PROVENANCE_ROW,
        id: 'wi_deleted_run',
        actor_id: 'run_deleted',
        run_id: null,
        run_summary: null,
      },
      {
        ...COMPLETE_PROVENANCE_ROW,
        id: 'wi_deleted_approver',
        approver_id: 'user_deleted',
        approver_name: null,
      },
      {
        ...ROW,
        id: 'wi_manual',
        source: 'manual',
        applied_from_proposal_id: null,
        actor_type: 'system',
        actor_id: null,
        on_behalf_of: null,
        run_id: null,
        run_summary: null,
        approver_id: null,
        approver_name: null,
        approved_at: null,
      },
    ])
    createSql.mockReturnValue(sql)

    const res = await app.request('/api/work-items', {
      headers: { Authorization: 'Bearer token' },
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<{ provenance?: Record<string, unknown> }>
    expect(body[0]?.provenance).toMatchObject({
      applied_from_proposal_id: null,
      actor_id: 'run_1',
      run_id: 'run_1',
      run_summary: 'Prepared the launch work',
      approver_id: null,
      approver_name: null,
      approved_at: null,
    })
    expect(body[1]?.provenance).toMatchObject({
      applied_from_proposal_id: 'proposal_1',
      actor_id: 'run_deleted',
      run_id: null,
      run_summary: null,
    })
    expect(body[2]?.provenance).toMatchObject({
      approver_id: 'user_deleted',
      approver_name: null,
      approved_at: '2026-07-02T09:30:00.000Z',
    })
    expect(body[3]).not.toHaveProperty('provenance')
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

describe('public work-item mutation responses', () => {
  beforeEach(() => {
    verifyToken.mockReset()
    createSql.mockReset()
    createWorkItem.mockReset()
    updateWorkItem.mockReset()
    process.env.CLERK_SECRET_KEY = 'sk_test'
    process.env.DATABASE_URL = 'postgresql://user:pass@host/db'
    verifyToken.mockResolvedValue({ sub: 'user_clerk_1', email: 'u@example.com', exp: 9999999999 })
  })

  it('returns the current CAS version after create', async () => {
    createSql.mockReturnValue(vi.fn(async () => [{ tenant_id: 'tenant_1' }]))
    createWorkItem.mockResolvedValue({ ...ROW, version: 1 })

    const res = await app.request('/api/work-items', {
      method: 'POST',
      headers: { Authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Created' }),
    })

    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toMatchObject({ id: 'wi_1', version: 1 })
  })

  it('returns the incremented CAS version after update', async () => {
    createSql.mockReturnValue(vi.fn(async () => [{ tenant_id: 'tenant_1' }]))
    updateWorkItem.mockResolvedValue({ ...ROW, title: 'Updated', version: 8 })

    const res = await app.request('/api/work-items/wi_1', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Updated' }),
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ id: 'wi_1', version: 8 })
  })
})
