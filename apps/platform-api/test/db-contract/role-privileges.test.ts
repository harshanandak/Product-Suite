import { describe, expect, it } from 'vitest'
import type { Sql } from '@product-suite/db'

import {
  assertRuntimeRoleContract,
  buildRuntimePrivilegeProbes,
  proveRuntimeLoginPrivileges,
  runtimeRoleSnapshotsFromCatalogRows,
  type RuntimeRoleSnapshot,
} from './harness'

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

    const catalogRoles = runtimeRoleSnapshotsFromCatalogRows([
      {
        name: 'product_suite_platform_runtime',
        canLogin: false,
        isSuperuser: false,
        canCreateRole: false,
        canCreateDb: false,
        member: 'platform_runtime_rotated',
        memberCanLogin: true,
        adminOption: false,
      },
      {
        name: 'product_suite_meeting_runtime',
        canLogin: false,
        isSuperuser: false,
        canCreateRole: false,
        canCreateDb: false,
        member: 'meeting_runtime_rotated',
        memberCanLogin: true,
        adminOption: false,
      },
    ])
    expect(catalogRoles).toEqual([
      { ...validRoles[0], memberships: [{ member: 'platform_runtime_rotated', adminOption: false }] },
      { ...validRoles[1], memberships: [{ member: 'meeting_runtime_rotated', adminOption: false }] },
    ])
    expect(assertRuntimeRoleContract(catalogRoles, {
      allowedLogins: ['platform_runtime_rotated', 'meeting_runtime_rotated'],
    })).toMatchObject({ status: 'READY', membershipCount: 2 })
    expect(() => runtimeRoleSnapshotsFromCatalogRows([{
      name: 'product_suite_platform_runtime',
      canLogin: false,
      isSuperuser: false,
      canCreateRole: false,
      canCreateDb: false,
      member: 'not-a-login',
      memberCanLogin: false,
      adminOption: false,
    }])).toThrow('RUNTIME_MEMBER_MUST_BE_LOGIN')
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

  it('describes allowed and denied probes without embedding credentials or SQL payloads', async () => {
    const probes = buildRuntimePrivilegeProbes()
    expect(probes.allowed).toEqual(expect.arrayContaining([
      'service_login_membership',
      'owned_table_crud',
    ]))
    expect(probes.denied).toEqual(expect.arrayContaining([
      'unlisted_table',
      'unlisted_sequence',
      'ddl',
      'role_escalation',
      'set_role',
      'cross_service_table',
    ]))
    expect(JSON.stringify(probes)).not.toMatch(/postgres|password|select .*from/i)

    const createRuntimeSql = (allowDeniedTable: boolean) => {
      let runtimeIndex = 0
      let tenantRead = 0
      let projectRead = 0
      return (_connectionUri: string): Sql => {
        const kind = runtimeIndex++ === 0 ? 'platform' : 'meeting'
        return {
          query: async (text: string) => {
            const normalized = text.trim().toLowerCase()
            if (normalized.startsWith('select name from public.tenants')) {
              tenantRead += 1
              return [{ name: tenantRead === 1 ? 'runtime-probe' : 'runtime-probe-updated' }]
            }
            if (normalized.startsWith('select name from public.projects')) {
              projectRead += 1
              return [{ name: projectRead === 1 ? 'runtime-probe' : 'runtime-probe-updated' }]
            }
            if (normalized.startsWith('select count(*)::text as count')) return [{ count: '0' }]
            const ownedWrite = kind === 'platform'
              ? /^(insert into|update|delete from) public\.projects/.test(normalized)
              : /^(insert into|update|delete from) public\.tenants/.test(normalized)
            if (ownedWrite) return []
            if (allowDeniedTable && normalized.startsWith('create table public."runtime_privilege_probe_fixed_denied"')) return []
            throw Object.assign(new Error('opaque denied'), { code: '42501' })
          },
        } as unknown as Sql
      }
    }

    const ownerEvents: string[] = []
    const ownerSql = {
      query: async (text: string) => {
        ownerEvents.push(text)
        if (text.includes('pg_catalog.pg_auth_members')) {
          return [
            {
              name: 'product_suite_platform_runtime', canLogin: false, isSuperuser: false,
              canCreateRole: false, canCreateDb: false, member: 'platform_runtime_fixed',
              memberCanLogin: true, adminOption: false,
            },
            {
              name: 'product_suite_meeting_runtime', canLogin: false, isSuperuser: false,
              canCreateRole: false, canCreateDb: false, member: 'meeting_runtime_fixed',
              memberCanLogin: true, adminOption: false,
            },
          ]
        }
        return []
      },
    } as unknown as Sql

    await expect(proveRuntimeLoginPrivileges(ownerSql, 'postgresql://opaque:opaque@ep.neon.tech/neondb?sslmode=require', {
      suffix: 'fixed',
      platformPassword: 'opaque-platform',
      meetingPassword: 'opaque-meeting',
      createRuntimeSql: createRuntimeSql(true),
    })).rejects.toThrow('RUNTIME_DENIAL_UNPROVEN')
    for (const cleanupProof of [
      'delete from public.projects',
      'delete from public.tenants',
      'revoke "product_suite_platform_runtime" from "platform_runtime_fixed"',
      'revoke "product_suite_meeting_runtime" from "meeting_runtime_fixed"',
      'drop role if exists "platform_runtime_fixed"',
      'drop role if exists "meeting_runtime_fixed"',
      'drop role if exists "platform_runtime_fixed_denied"',
      'drop sequence if exists public."runtime_privilege_probe_fixed_sequence"',
      'drop table if exists public."runtime_privilege_probe_fixed"',
      'drop table if exists public."runtime_privilege_probe_fixed_denied"',
    ]) {
      expect(ownerEvents.some((text) => text.includes(cleanupProof))).toBe(true)
    }

    const cleanupOwnerSql = {
      query: async (text: string) => {
        if (text.includes('pg_catalog.pg_auth_members')) return ownerSql.query(text, [])
        if (text.includes('drop role if exists "platform_runtime_fixed"')) throw new Error('raw cleanup detail')
        return []
      },
    } as unknown as Sql
    const cleanupFailure = await proveRuntimeLoginPrivileges(
      cleanupOwnerSql,
      'postgresql://opaque:opaque@ep.neon.tech/neondb?sslmode=require',
      {
        suffix: 'fixed',
        platformPassword: 'opaque-platform',
        meetingPassword: 'opaque-meeting',
        createRuntimeSql: createRuntimeSql(false),
      },
    ).catch((error: unknown) => error)
    expect(cleanupFailure).toMatchObject({ code: 'RUNTIME_PROBE_CLEANUP_UNPROVEN' })
    expect(String(cleanupFailure)).not.toContain('raw cleanup detail')

    const primaryAndCleanupFailure = await proveRuntimeLoginPrivileges(
      cleanupOwnerSql,
      'postgresql://opaque:opaque@ep.neon.tech/neondb?sslmode=require',
      {
        suffix: 'fixed',
        platformPassword: 'opaque-platform',
        meetingPassword: 'opaque-meeting',
        createRuntimeSql: createRuntimeSql(true),
      },
    ).catch((error: unknown) => error)
    expect(primaryAndCleanupFailure).toMatchObject({ code: 'RUNTIME_DENIAL_UNPROVEN' })
  })

})
