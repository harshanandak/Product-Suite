import { describe, expect, it } from 'vitest'

import {
  assertExactConformancePass,
  NeonConformanceError,
  runRequiredNeonConformance,
  type NeonControlPlane,
} from './harness'

describe('required Neon conformance fail-fast behavior', () => {
  it('preserves stable harness codes while generic errors stay generic', async () => {
    const plane: NeonControlPlane = {
      async createDisposableProject() { throw new Error('secret body must not escape') },
      async createProductionDerivedBranch() { throw new Error('unreachable') },
      async proveVariant() {},
      async probeLeastPrivilege() {},
      async deleteProject() {},
      async verifyProjectDeleted() {},
      async deleteBranch() {},
      async verifyBranchDeleted() {},
      async cleanupRetainedResources() {},
    }
    await expect(runRequiredNeonConformance({ NEON_API_KEY: 'test-key', NEON_PROJECT_ID: 'production-project' }, plane)).resolves.toEqual({
      status: 'INCOMPLETE',
      code: 'REAL_NEON_CONFORMANCE_FAILED',
    })

    const codedPlane: NeonControlPlane = {
      ...plane,
      async createDisposableProject() { throw new NeonConformanceError('TEST_PROJECT_NOT_EMPTY') },
    }
    await expect(runRequiredNeonConformance({ NEON_API_KEY: 'test-key', NEON_PROJECT_ID: 'production-project' }, codedPlane)).resolves.toEqual({
      status: 'INCOMPLETE',
      code: 'TEST_PROJECT_NOT_EMPTY',
    })
    expect(() => assertExactConformancePass({ status: 'INCOMPLETE', code: 'TEST_PROJECT_NOT_EMPTY' })).toThrow(
      'TEST_PROJECT_NOT_EMPTY',
    )
  })
})
