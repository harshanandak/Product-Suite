import { describe, expect, it } from 'vitest'

import { assertRuntimeRoleContract, runtimeRoleSnapshotsFromCatalogRows } from './harness'

describe('Neon least-privilege catalog helpers', () => {
  it('scopes catalog membership evidence to the two temporary probe logins', () => {
    const probeRoles = runtimeRoleSnapshotsFromCatalogRows([
      {
        name: 'product_suite_platform_runtime',
        canLogin: false,
        isSuperuser: false,
        canCreateRole: false,
        canCreateDb: false,
        member: 'platform_runtime_probe',
        memberCanLogin: true,
        adminOption: false,
      },
      {
        name: 'product_suite_platform_runtime',
        canLogin: false,
        isSuperuser: false,
        canCreateRole: false,
        canCreateDb: false,
        member: 'platform_runtime_login',
        memberCanLogin: true,
        adminOption: false,
      },
      {
        name: 'product_suite_meeting_runtime',
        canLogin: false,
        isSuperuser: false,
        canCreateRole: false,
        canCreateDb: false,
        member: 'meeting_runtime_probe',
        memberCanLogin: true,
        adminOption: false,
      },
      {
        name: 'product_suite_meeting_runtime',
        canLogin: false,
        isSuperuser: false,
        canCreateRole: false,
        canCreateDb: false,
        member: 'meeting_runtime_login',
        memberCanLogin: true,
        adminOption: false,
      },
    ], { memberFilter: ['platform_runtime_probe', 'meeting_runtime_probe'] })

    expect(assertRuntimeRoleContract(probeRoles, {
      allowedLogins: ['platform_runtime_probe', 'meeting_runtime_probe'],
    })).toMatchObject({ status: 'READY', membershipCount: 2 })
  })
})
