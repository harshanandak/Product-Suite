import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MembershipRole } from '@product-suite/contracts'

const { verifyToken } = vi.hoisted(() => ({ verifyToken: vi.fn() }))
const { createSql } = vi.hoisted(() => ({ createSql: vi.fn() }))

vi.mock('@clerk/backend', () => ({ verifyToken }))
vi.mock('@product-suite/db', () => ({ createSql }))

import app from '../app'

const auth = {
  headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
}

const team = {
  id: 'team_1', tenant_id: 'tenant_1', name: 'Platform',
  created_at: '2026-08-12T00:00:00.000Z', updated_at: '2026-08-12T00:00:00.000Z',
}
const status = {
  id: 'status_1', team_id: 'team_1', name: 'In progress', category: 'started', position: 1,
  created_at: '2026-08-12T00:00:00.000Z', updated_at: '2026-08-12T00:00:00.000Z',
}
const project = {
  id: 'project_1', tenant_id: 'tenant_1', name: 'Control plane', kind: 'general', status: 'backlog',
  lead_id: null, target_date: null,
  created_at: '2026-08-12T00:00:00.000Z', updated_at: '2026-08-12T00:00:00.000Z',
}

function installSql(options: {
  role: MembershipRole | string
  membershipStatus?: string
  ambiguous?: boolean
  resourceVisible?: boolean
}) {
  const sql = vi.fn(async (strings: TemplateStringsArray) => {
    const text = strings.join(' ')
    if (/select distinct om\.tenant_id/i.test(text)) return [{ tenant_id: 'tenant_1' }]
    if (/select uai\.user_id, om\.tenant_id, om\.role, om\.status/i.test(text)) {
      const membership = {
        user_id: 'user_1', tenant_id: 'tenant_1', role: options.role,
        status: options.membershipStatus ?? 'active',
      }
      return options.ambiguous ? [membership, { ...membership, user_id: 'user_2' }] : [membership]
    }
    if (/select t\.tenant_id[\s\S]*from teams t/i.test(text)) {
      return options.resourceVisible === false ? [] : [{ tenant_id: 'tenant_1' }]
    }
    if (/from projects[\s\S]*tenant_id = any/i.test(text)) {
      return options.resourceVisible === false ? [] : [project]
    }
    if (/update projects/i.test(text)) return [project]
    return []
  })
  const query = vi.fn(async (text: string) => {
    if (text.includes('insert into "teams"')) return [team]
    if (text.includes('insert into "statuses"')) return [status]
    if (text.includes('insert into "projects"')) return [project]
    return []
  })
  ;(sql as unknown as { query: typeof query }).query = query
  createSql.mockReturnValue(sql)
  return { sql, query }
}

describe('configuration mutation capabilities', () => {
  beforeEach(() => {
    verifyToken.mockReset()
    createSql.mockReset()
    process.env.CLERK_SECRET_KEY = 'sk_test'
    process.env.DATABASE_URL = 'postgresql://user:pass@host/db'
    verifyToken.mockResolvedValue({ sub: 'clerk_user_1', org_id: 'tenant_1', exp: 9999999999 })
  })

  it.each([
    ['viewer', 403],
    ['member', 403],
    ['admin', 201],
    ['owner', 201],
  ] satisfies [MembershipRole, number][])('team create applies configure to %s', async (role, expected) => {
    const { query } = installSql({ role })
    const response = await app.request('/api/teams', {
      method: 'POST', ...auth,
      body: JSON.stringify({ name: 'Platform', tenant_id: 'evil', role: 'owner' }),
    })

    expect(response.status).toBe(expected)
    expect(query).toHaveBeenCalledTimes(expected === 201 ? 1 : 0)
    if (expected === 201) {
      const parameters = (query.mock.calls[0] as unknown as [string, unknown[]] | undefined)?.[1] ?? []
      expect(parameters).toContain('tenant_1')
      expect(parameters).not.toContain('evil')
      expect(parameters).not.toContain('owner')
    }
  })

  it.each([
    ['viewer', 403],
    ['member', 403],
    ['admin', 201],
    ['owner', 201],
  ] satisfies [MembershipRole, number][])('status create applies configure to %s', async (role, expected) => {
    const { query } = installSql({ role })
    const response = await app.request('/api/statuses', {
      method: 'POST', ...auth,
      body: JSON.stringify({ team_id: 'team_1', name: 'In progress', category: 'started' }),
    })

    expect(response.status).toBe(expected)
    expect(query).toHaveBeenCalledTimes(expected === 201 ? 1 : 0)
  })

  it.each([
    ['viewer', 403],
    ['member', 201],
    ['admin', 201],
    ['owner', 201],
  ] satisfies [MembershipRole, number][])('project create applies edit to %s', async (role, expected) => {
    const { query } = installSql({ role })
    const response = await app.request('/api/projects', {
      method: 'POST', ...auth,
      body: JSON.stringify({ name: 'Control plane', tenant_id: 'evil', role: 'owner' }),
    })

    expect(response.status).toBe(expected)
    expect(query).toHaveBeenCalledTimes(expected === 201 ? 1 : 0)
  })

  it.each([
    ['viewer', 403],
    ['member', 200],
    ['admin', 200],
    ['owner', 200],
  ] satisfies [MembershipRole, number][])('project update applies edit to %s', async (role, expected) => {
    const { sql } = installSql({ role })
    const response = await app.request('/api/projects/project_1', {
      method: 'PATCH', ...auth, body: JSON.stringify({ name: 'Updated' }),
    })

    expect(response.status).toBe(expected)
    const update = sql.mock.calls.find(([strings]) => /update projects/i.test(strings.join(' ')))
    expect(Boolean(update)).toBe(expected === 200)
  })

  it.each([
    ['inactive membership', { role: 'admin', membershipStatus: 'inactive' }, '/api/teams', { name: 'Platform' }],
    ['ambiguous membership', { role: 'admin', ambiguous: true }, '/api/teams', { name: 'Platform' }],
    ['unknown role', { role: 'org_admin' }, '/api/teams', { name: 'Platform' }],
    ['cross-tenant team id', { role: 'admin', resourceVisible: false }, '/api/statuses', { team_id: 'foreign', name: 'X', category: 'started' }],
    ['cross-tenant project id', { role: 'admin', resourceVisible: false }, '/api/projects/foreign', { name: 'X' }],
  ])('fails closed with 404 for %s', async (_name, options, path, body) => {
    const { query } = installSql(options)
    const response = await app.request(path, {
      method: path.includes('/foreign') ? 'PATCH' : 'POST', ...auth, body: JSON.stringify(body),
    })

    expect(response.status).toBe(404)
    expect(query).not.toHaveBeenCalled()
  })
})
