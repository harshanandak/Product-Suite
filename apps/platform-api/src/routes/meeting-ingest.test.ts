import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { verifyToken } = vi.hoisted(() => ({ verifyToken: vi.fn() }))
const { createSql } = vi.hoisted(() => ({ createSql: vi.fn() }))
const { runMeetingIngest } = vi.hoisted(() => ({ runMeetingIngest: vi.fn() }))

vi.mock('@clerk/backend', () => ({ verifyToken }))
vi.mock('@product-suite/db', () => ({ createSql }))
vi.mock('../meeting/ingest', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../meeting/ingest')>()),
  runMeetingIngest,
}))

import app from '../app'

const PLATFORM_TENANT = '11111111-1111-4111-8111-111111111111'
const FOREIGN_TENANT = '22222222-2222-4222-8222-222222222222'
const MEETING_TENANT_MAP = JSON.stringify({ tenant_meeting_pilot: PLATFORM_TENANT })

const auth = { headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' } }

/** Mock Sql: the tagged-template call resolves `callerTenantIds`. */
function mockSql(tenants: { tenant_id: string }[]) {
  const sql = vi.fn().mockResolvedValueOnce(tenants) as unknown as {
    (...a: unknown[]): unknown
    query: ReturnType<typeof vi.fn>
  }
  sql.query = vi.fn(async () => [])
  createSql.mockReturnValue(sql)
  return sql
}

function post(body: unknown) {
  return app.request('/api/agent/meeting-ingest', {
    method: 'POST',
    ...auth,
    body: JSON.stringify(body),
  })
}

const HERE = dirname(fileURLToPath(import.meta.url))

/** Drop line and block comments so a source assertion reads CODE, not prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('POST /api/agent/meeting-ingest', () => {
  beforeEach(() => {
    verifyToken.mockReset()
    createSql.mockReset()
    runMeetingIngest.mockReset().mockResolvedValue({
      proposalsCreated: 2,
      skippedDuplicate: 1,
      skippedUnmappedTenant: 3,
      proposalIds: ['p_a', 'p_b'],
      runId: 'run_1',
    })
    process.env.CLERK_SECRET_KEY = 'sk_test'
    process.env.DATABASE_URL = 'postgresql://user:pass@host/db'
    process.env.MEETING_TENANT_MAP = MEETING_TENANT_MAP
    verifyToken.mockResolvedValue({ sub: 'user_clerk_1', exp: 9999999999 })
  })

  // 1
  it('401s an unauthenticated request without touching the database', async () => {
    const sql = vi.fn()
    createSql.mockReturnValue(sql)
    const res = await app.request('/api/agent/meeting-ingest', { method: 'POST' })
    expect(res.status).toBe(401)
    expect(sql).not.toHaveBeenCalled()
    expect(runMeetingIngest).not.toHaveBeenCalled()
  })

  // 2
  it('resolves the caller tenants through callerTenantIds and anchors the ingest to one', async () => {
    const sql = mockSql([{ tenant_id: PLATFORM_TENANT }])
    const res = await post({})

    expect(res.status).toBe(200)
    // callerTenantIds is the tagged-template membership query — the single tenancy anchor.
    const [strings] = (sql as unknown as { mock: { calls: [TemplateStringsArray][] } }).mock.calls[0]!
    expect(strings.join(' ')).toMatch(/organization_memberships/)
    expect(runMeetingIngest).toHaveBeenCalledTimes(1)
    expect(runMeetingIngest.mock.calls[0]![1]).toMatchObject({ tenantId: PLATFORM_TENANT })
  })

  // 3
  it('refuses to ingest a tenant the caller does not belong to', async () => {
    mockSql([{ tenant_id: PLATFORM_TENANT }])
    const res = await post({ org_id: FOREIGN_TENANT })

    expect(res.status).toBe(403)
    expect(runMeetingIngest).not.toHaveBeenCalled()
  })

  it('403s a caller who belongs to no organization', async () => {
    mockSql([])
    const res = await post({})
    expect(res.status).toBe(403)
    expect(runMeetingIngest).not.toHaveBeenCalled()
  })

  it('400s a multi-org caller who does not say which org to ingest', async () => {
    mockSql([{ tenant_id: PLATFORM_TENANT }, { tenant_id: FOREIGN_TENANT }])
    const res = await post({})
    expect(res.status).toBe(400)
    expect(runMeetingIngest).not.toHaveBeenCalled()
  })

  // 4
  it('returns the summary — created, skipped-duplicate, and skipped-unmapped-tenant', async () => {
    mockSql([{ tenant_id: PLATFORM_TENANT }])
    const res = await post({})

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      proposalsCreated: 2,
      skippedDuplicate: 1,
      // Visible, never silently zero: this number is how an operator tells "no work"
      // apart from "the tenant map is missing an entry".
      skippedUnmappedTenant: 3,
    })
  })

  it('passes the configured tenant map through, and stays fail-closed when it is absent', async () => {
    mockSql([{ tenant_id: PLATFORM_TENANT }])
    await post({})
    const passedMap = runMeetingIngest.mock.calls[0]![1].tenantMap as ReadonlyMap<string, string>
    expect(passedMap.get('tenant_meeting_pilot')).toBe(PLATFORM_TENANT)

    runMeetingIngest.mockClear()
    delete process.env.MEETING_TENANT_MAP
    mockSql([{ tenant_id: PLATFORM_TENANT }])
    await post({})
    const emptyMap = runMeetingIngest.mock.calls[0]![1].tenantMap as ReadonlyMap<string, string>
    expect(emptyMap.size).toBe(0)
  })

  // 5
  it('is mounted at /api/agent/meeting-ingest beside the other agent routes', () => {
    const appSource = readFileSync(resolve(HERE, '../app.ts'), 'utf8')
    expect(appSource).toContain("app.route('/api/agent/meeting-ingest', meetingIngestRoutes)")
  })

  // 6
  it('registers NO cron or scheduled trigger in this slice — the ingest is human-triggered', () => {
    const wrangler = readFileSync(resolve(HERE, '../../wrangler.jsonc'), 'utf8')
    expect(wrangler).not.toMatch(/"triggers"/)
    expect(wrangler).not.toMatch(/"crons"/)

    const appSource = readFileSync(resolve(HERE, '../app.ts'), 'utf8')
    expect(appSource).not.toMatch(/\bscheduled\b/)

    // Comments stripped first: the route DOCUMENTS why it has no schedule, and
    // saying so must not read as having one.
    const routeSource = stripComments(readFileSync(resolve(HERE, './meeting-ingest.ts'), 'utf8'))
    expect(routeSource).not.toMatch(/\bcron\b/i)
    expect(routeSource).not.toMatch(/setInterval|scheduled\s*\(/)
  })

  it('surfaces an ingest failure as a 500 rather than a partial success', async () => {
    mockSql([{ tenant_id: PLATFORM_TENANT }])
    runMeetingIngest.mockRejectedValue(new Error('meeting schema unreachable'))
    const res = await post({})
    expect(res.status).toBe(500)
  })
})
