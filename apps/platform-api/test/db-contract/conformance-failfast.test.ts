import { describe, expect, it } from 'vitest'

import {
  assertExactConformancePass,
  NeonConformanceError,
  loadCanonicalFilesForVariant,
  runRequiredNeonConformance,
  withCanonicalDatabaseSession,
  type SessionPoolFactory,
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
      phase: 'disposable-create',
    })

    const codedPlane: NeonControlPlane = {
      ...plane,
      async createDisposableProject() { throw new NeonConformanceError('TEST_PROJECT_NOT_EMPTY') },
    }
    await expect(runRequiredNeonConformance({ NEON_API_KEY: 'test-key', NEON_PROJECT_ID: 'production-project' }, codedPlane)).resolves.toEqual({
      status: 'INCOMPLETE',
      code: 'TEST_PROJECT_NOT_EMPTY',
      phase: 'disposable-create',
    })

    const bootstrapFailurePlane: NeonControlPlane = {
      ...plane,
      async createDisposableProject() {
        return {
          projectId: 'disposable-project',
          branchId: 'disposable-branch',
          database: 'neondb',
          branchIsRoot: true,
          branchIsDefault: true,
          authority: 'test-only',
          historyVariant: 'repaired-bootstrap',
          catalogCount: 0,
          connectionUri: 'opaque-connection',
          runtimeConnectionUri: 'opaque-runtime-connection',
        }
      },
      async proveVariant() { throw new Error('secret response body https://neon.example/projects/prod token=opaque') },
    }
    await expect(runRequiredNeonConformance({ NEON_API_KEY: 'test-key', NEON_PROJECT_ID: 'production-project' }, bootstrapFailurePlane)).resolves.toEqual({
      status: 'INCOMPLETE',
      code: 'DISPOSABLE_BOOTSTRAP_UNPROVEN',
      phase: 'disposable-bootstrap',
    })

    const cleanupFailingPlane: NeonControlPlane = {
      ...plane,
      async cleanupRetainedResources() { throw new Error('cleanup detail must not replace primary') },
    }
    await expect(runRequiredNeonConformance({ NEON_API_KEY: 'test-key', NEON_PROJECT_ID: 'production-project' }, cleanupFailingPlane)).resolves.toEqual({
      status: 'INCOMPLETE',
      code: 'REAL_NEON_CONFORMANCE_FAILED',
      phase: 'disposable-create',
    })
    expect(() => assertExactConformancePass({ status: 'INCOMPLETE', code: 'TEST_PROJECT_NOT_EMPTY' })).toThrow(
      'TEST_PROJECT_NOT_EMPTY',
    )
  })

  it('preserves a canonical primary when session cleanup also fails', async () => {
    const primary = new NeonConformanceError('REPAIRED_BOOTSTRAP_UNPROVEN')
    const poolFactory: SessionPoolFactory = () => ({
      async connect() {
        return {
          async query() { return { rows: [] } },
          release() { throw new Error('cleanup token must not replace primary') },
        }
      },
      async end() { throw new Error('pool cleanup body must not escape') },
    })

    await expect(withCanonicalDatabaseSession('opaque-connection', async () => { throw primary }, poolFactory)).rejects.toBe(primary)
    await expect(withCanonicalDatabaseSession('opaque-connection', async () => 'ok', poolFactory)).rejects.toMatchObject({
      name: 'NeonConformanceError',
      code: 'DB_SESSION_UNPROVEN',
    })
  })

  it('maps canonical migration file loading failures to an allowlisted code', async () => {
    await expect(loadCanonicalFilesForVariant('repaired-bootstrap', () => {
      throw new Error('manifest URL https://neon.example/projects/prod token=opaque')
    })).rejects.toMatchObject({
      name: 'NeonConformanceError',
      code: 'CANONICAL_FILE_LOAD_UNPROVEN',
    })
  })
})
