import { describe, expect, it, vi } from 'vitest'

import type { AuthClaims, MembershipRole } from '@product-suite/contracts'

import {
  authorizeCapability,
  capabilitiesForRole,
  hasCapability,
  resolveCapabilityContext,
} from './capabilities'

const claims = {
  provider: 'clerk',
  subject: 'clerk_user_1',
  tenant_id: 'forged_tenant',
  roles: ['owner'],
} satisfies AuthClaims

const row = (role: unknown, overrides: Record<string, unknown> = {}) => ({
  user_id: 'user_1',
  tenant_id: 'tenant_1',
  role,
  status: 'active',
  ...overrides,
})

describe('canonical capability matrix', () => {
  it.each([
    ['viewer', ['read']],
    ['member', ['read', 'edit']],
    ['admin', ['read', 'edit', 'configure']],
    ['owner', ['read', 'edit', 'configure']],
  ] satisfies [MembershipRole, string[]][])('%s has only its canonical capabilities', (role, expected) => {
    expect(capabilitiesForRole(role)).toEqual(expected)
  })

  it('never infers configure from a lower role', () => {
    expect(hasCapability({ capabilities: ['read'] }, 'edit')).toBe(false)
    expect(hasCapability({ capabilities: ['read', 'edit'] }, 'configure')).toBe(false)
  })
})

describe('resolveCapabilityContext', () => {
  it.each(['viewer', 'member', 'admin', 'owner'] satisfies MembershipRole[])(
    'resolves %s from the server-side identity and active membership row',
    async (role) => {
      const sql = vi.fn(async () => [row(role)])

      const result = await resolveCapabilityContext(sql as never, claims, 'tenant_1')

      expect(result).toMatchObject({
        ok: true,
        context: {
          tenantId: 'tenant_1',
          userId: 'user_1',
          role,
          authoritySource: 'database_membership',
        },
      })
      const parameters = sql.mock.calls[0]?.slice(1) ?? []
      expect(parameters).toEqual(['clerk', 'clerk_user_1', 'tenant_1'])
      expect(parameters).not.toContain('forged_tenant')
      expect(parameters).not.toContain('owner')
    },
  )

  it.each([
    ['missing membership', []],
    ['inactive membership', [row('admin', { status: 'inactive' })]],
    ['unknown role', [row('org_admin')]],
    ['malformed role', [row(' admin ')]],
    ['cross-tenant row', [row('admin', { tenant_id: 'tenant_2' })]],
    ['ambiguous membership', [row('admin'), row('owner', { user_id: 'user_2' })]],
  ])('fails closed for %s', async (_case, rows) => {
    const sql = vi.fn(async () => rows)

    await expect(resolveCapabilityContext(sql as never, claims, 'tenant_1')).resolves.toEqual({
      ok: false,
      reason: 'not_found',
    })
  })

  it('fails closed without a requested tenant before querying', async () => {
    const sql = vi.fn()

    await expect(resolveCapabilityContext(sql as never, claims, '')).resolves.toEqual({
      ok: false,
      reason: 'not_found',
    })
    expect(sql).not.toHaveBeenCalled()
  })

  it('returns 403 only for a known active member lacking the requested capability', async () => {
    const member = vi.fn(async () => [row('member')])
    await expect(authorizeCapability(member as never, claims, 'tenant_1', 'configure')).resolves.toEqual({
      ok: false,
      reason: 'forbidden',
      status: 403,
    })

    const missing = vi.fn(async () => [])
    await expect(authorizeCapability(missing as never, claims, 'tenant_1', 'edit')).resolves.toEqual({
      ok: false,
      reason: 'not_found',
      status: 404,
    })
  })
})
