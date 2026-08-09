import { describe, expect, it } from 'vitest'

import { assertRuntimeRoleContract, buildRuntimePrivilegeProbes, type RuntimeRoleSnapshot } from './harness'

const validRoles: RuntimeRoleSnapshot[] = [
  {
    name: 'product_suite_platform_runtime',
    canLogin: false,
    isSuperuser: false,
    canCreateRole: false,
    canCreateDb: false,
    memberships: [{ member: 'platform_runtime_login', adminOption: false }],
  },
  {
    name: 'product_suite_meeting_runtime',
    canLogin: false,
    isSuperuser: false,
    canCreateRole: false,
    canCreateDb: false,
    memberships: [{ member: 'meeting_runtime_login', adminOption: false }],
  },
]

describe('Neon least-privilege runtime role contract', () => {
  it('accepts separate NOLOGIN grant roles with non-admin login memberships', () => {
    expect(
      assertRuntimeRoleContract(validRoles, {
        allowedLogins: ['platform_runtime_login', 'meeting_runtime_login'],
      }),
    ).toMatchObject({ status: 'READY', roleCount: 2, membershipCount: 2 })
  })

  it.each([
    ['LOGIN grant role', { ...validRoles[0]!, canLogin: true }, 'RUNTIME_ROLE_MUST_BE_NOLOGIN'],
    ['role escalation', { ...validRoles[0]!, canCreateRole: true }, 'RUNTIME_ROLE_ESCALATION'],
    [
      'admin option membership',
      { ...validRoles[0]!, memberships: [{ member: 'platform_runtime_login', adminOption: true }] },
      'RUNTIME_ROLE_ADMIN_OPTION_FORBIDDEN',
    ],
    [
      'cross-service membership',
      { ...validRoles[0]!, memberships: [{ member: 'meeting_runtime_login', adminOption: false }] },
      'RUNTIME_ROLE_CROSS_SERVICE_MEMBERSHIP',
    ],
  ])('rejects %s', (_label, role, code) => {
    expect(() => assertRuntimeRoleContract([role, validRoles[1]!], { allowedLogins: [
      'platform_runtime_login',
      'meeting_runtime_login',
    ] })).toThrow(code)
  })

  it('rejects missing and unauthorized login memberships', () => {
    expect(() => assertRuntimeRoleContract([validRoles[0]!], { allowedLogins: ['platform_runtime_login'] })).toThrow(
      'RUNTIME_ROLE_MISSING',
    )
    expect(() => assertRuntimeRoleContract([
      { ...validRoles[0]!, memberships: [{ member: 'unknown_login', adminOption: false }] },
      validRoles[1]!,
    ], { allowedLogins: ['platform_runtime_login', 'meeting_runtime_login'] })).toThrow(
      'RUNTIME_LOGIN_UNAUTHORIZED',
    )
  })

  it('describes allowed and denied probes without embedding credentials or SQL payloads', () => {
    const probes = buildRuntimePrivilegeProbes()
    expect(probes.allowed).toEqual(expect.arrayContaining(['select_public', 'write_owned_rows']))
    expect(probes.denied).toEqual(expect.arrayContaining(['ddl', 'role_escalation', 'cross_service_schema']))
    expect(JSON.stringify(probes)).not.toMatch(/postgres|password|select .*from/i)
  })
})
