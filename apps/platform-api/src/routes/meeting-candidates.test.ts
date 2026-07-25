import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifyToken } = vi.hoisted(() => ({ verifyToken: vi.fn() }))
const { createSql } = vi.hoisted(() => ({ createSql: vi.fn() }))
const { listMeetingCandidates } = vi.hoisted(() => ({ listMeetingCandidates: vi.fn() }))

vi.mock('@clerk/backend', () => ({ verifyToken }))
vi.mock('@product-suite/db', () => ({ createSql }))
vi.mock('../meeting/candidates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../meeting/candidates')>()),
  listMeetingCandidates,
}))

import app from '../app'

const PLATFORM_TENANT = '11111111-1111-4111-8111-111111111111'
const FOREIGN_TENANT = '22222222-2222-4222-8222-222222222222'

const auth = { headers: { Authorization: 'Bearer token' } }

const CANDIDATE = {
  id: 'ai_1',
  meeting_id: 'mtg_1',
  text: 'Send the revised quote to Acme by Friday',
  confidence: 0.82,
  promotion_reason: 'Explicit commitment',
  created_at: '2026-07-25T00:00:00.000Z',
  promotion_state: 'proposal_pending',
  proposal_id: 'p1',
  work_item_id: null,
}

function mockSql(tenants: { tenant_id: string }[]) {
  const sql = vi.fn().mockResolvedValueOnce(tenants) as unknown as {
    (...a: unknown[]): unknown
    query: ReturnType<typeof vi.fn>
  }
  sql.query = vi.fn(async () => [])
  createSql.mockReturnValue(sql)
  return sql
}

const HERE = dirname(fileURLToPath(import.meta.url))

describe('GET /api/agent/meeting-candidates', () => {
  beforeEach(() => {
    verifyToken.mockReset()
    createSql.mockReset()
    listMeetingCandidates.mockReset().mockResolvedValue([CANDIDATE])
    process.env.CLERK_SECRET_KEY = 'sk_test'
    process.env.DATABASE_URL = 'postgresql://user:pass@host/db'
    process.env.MEETING_TENANT_MAP = JSON.stringify({ tenant_meeting_pilot: PLATFORM_TENANT })
    verifyToken.mockResolvedValue({ sub: 'user_clerk_1', exp: 9999999999 })
  })

  it('401s an unauthenticated request without touching the database', async () => {
    const sql = vi.fn()
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/agent/meeting-candidates')
    expect(res.status).toBe(401)
    expect(sql).not.toHaveBeenCalled()
    expect(listMeetingCandidates).not.toHaveBeenCalled()
  })

  it('resolves the caller tenants through callerTenantIds and anchors to one', async () => {
    const sql = mockSql([{ tenant_id: PLATFORM_TENANT }])

    const res = await app.request('/api/agent/meeting-candidates', auth)

    expect(res.status).toBe(200)
    const [strings] = (sql as unknown as { mock: { calls: [TemplateStringsArray][] } }).mock.calls[0]!
    expect(strings.join(' ')).toMatch(/organization_memberships/)
    expect(listMeetingCandidates.mock.calls[0]![1]).toMatchObject({ tenantId: PLATFORM_TENANT })
  })

  it('returns the candidates envelope', async () => {
    mockSql([{ tenant_id: PLATFORM_TENANT }])
    const res = await app.request('/api/agent/meeting-candidates', auth)
    expect(await res.json()).toEqual({ candidates: [CANDIDATE] })
  })

  it('refuses a tenant the caller does not belong to', async () => {
    mockSql([{ tenant_id: PLATFORM_TENANT }])
    const res = await app.request(
      `/api/agent/meeting-candidates?org_id=${FOREIGN_TENANT}`,
      auth,
    )
    expect(res.status).toBe(403)
    expect(listMeetingCandidates).not.toHaveBeenCalled()
  })

  it('403s a caller who belongs to no organization', async () => {
    mockSql([])
    const res = await app.request('/api/agent/meeting-candidates', auth)
    expect(res.status).toBe(403)
    expect(listMeetingCandidates).not.toHaveBeenCalled()
  })

  it('400s a multi-org caller who does not disambiguate', async () => {
    mockSql([{ tenant_id: PLATFORM_TENANT }, { tenant_id: FOREIGN_TENANT }])
    const res = await app.request('/api/agent/meeting-candidates', auth)
    expect(res.status).toBe(400)
    expect(listMeetingCandidates).not.toHaveBeenCalled()
  })

  it('surfaces a read failure as a 500', async () => {
    mockSql([{ tenant_id: PLATFORM_TENANT }])
    listMeetingCandidates.mockRejectedValue(new Error('action_items unreachable'))
    const res = await app.request('/api/agent/meeting-candidates', auth)
    expect(res.status).toBe(500)
  })

  it('is mounted at /api/agent/meeting-candidates beside the other agent routes', () => {
    const appSource = readFileSync(resolve(HERE, '../app.ts'), 'utf8')
    expect(appSource).toContain(
      "app.route('/api/agent/meeting-candidates', meetingCandidatesRoutes)",
    )
  })
})
