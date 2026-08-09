import { describe, expect, it } from 'vitest'

import {
  assertCleanupEvidence,
  assertDisposableTestProject,
  assertProductionDerivedBranch,
  controlPlaneFetchForTest,
  createNeonControlPlane,
  conformanceCredentialStatus,
  hasNeonCreds,
  requiredConformanceStatus,
  runRequiredNeonConformance,
  type CleanupEvidence,
  type DisposableTestProject,
  type NeonControlPlane,
  type ProductionDerivedBranch,
} from './harness'

const disposable: DisposableTestProject = {
  projectId: 'test-project-123',
  branchId: 'test-root-123',
  database: 'neondb',
  branchIsRoot: true,
  branchIsDefault: true,
  authority: 'test-only',
  historyVariant: 'repaired-bootstrap',
  catalogCount: 0,
}

const derived: ProductionDerivedBranch = {
  projectId: 'production-project',
  branchId: 'test-derived-123',
  parentBranchId: 'production-root',
  productionProjectId: 'production-project',
  branchIsRoot: false,
  branchIsDefault: false,
  authority: 'production-derived',
  historyVariant: 'original-production',
}

describe('Neon authority conformance guards', () => {
  it('accepts only an empty test-only root with the repaired variant', () => {
    expect(assertDisposableTestProject(disposable, 'production-project')).toMatchObject({
      authority: 'test-only',
      historyVariant: 'repaired-bootstrap',
    })
  })

  it.each([
    ['production project id', { ...disposable, projectId: 'production-project' }, 'TEST_PROJECT_PRODUCTION_ID'],
    ['production child claimed empty', { ...disposable, authority: 'production-derived' }, 'TEST_PROJECT_AUTHORITY_INVALID'],
    ['non-root branch', { ...disposable, branchIsRoot: false, branchIsDefault: false }, 'TEST_PROJECT_ROOT_REQUIRED'],
    ['nonempty catalog', { ...disposable, catalogCount: 1 }, 'TEST_PROJECT_NOT_EMPTY'],
    ['wrong history variant', { ...disposable, historyVariant: 'original-production' as const }, 'TEST_PROJECT_VARIANT_INVALID'],
  ])('rejects %s without exposing identifiers', (_label, candidate, code) => {
    expect(() => assertDisposableTestProject(candidate as DisposableTestProject, 'production-project')).toThrow(code)
    try {
      assertDisposableTestProject(candidate as DisposableTestProject, 'production-project')
    } catch (error) {
      expect(String(error)).not.toContain('production-project')
      expect(String(error)).not.toContain('test-project-123')
    }
  })

  it('requires a separate non-root branch derived from production history', () => {
    expect(assertProductionDerivedBranch(derived)).toMatchObject({
      authority: 'production-derived',
      historyVariant: 'original-production',
    })
    expect(() => assertProductionDerivedBranch({ ...derived, branchIsRoot: true })).toThrow('PRODUCTION_DERIVED_ROOT')
    expect(() => assertProductionDerivedBranch({ ...derived, parentBranchId: undefined })).toThrow(
      'PRODUCTION_DERIVED_PARENT_REQUIRED',
    )
  })

  it('requires create, bootstrap, verify, delete, and deletion proof in cleanup evidence', () => {
    const complete: CleanupEvidence = {
      projectCreated: true,
      repairedBootstrapVerified: true,
      productionDerivedBranchVerified: true,
      projectDeleteRequested: true,
      projectDeletionVerified: true,
    }
    expect(assertCleanupEvidence(complete)).toEqual({ status: 'PASS' })
    expect(() => assertCleanupEvidence({ ...complete, projectDeletionVerified: false })).toThrow(
      'PROJECT_DELETION_UNPROVEN',
    )
    expect(() => assertCleanupEvidence({ ...complete, projectDeleteRequested: false })).toThrow(
      'PROJECT_CLEANUP_REQUIRED',
    )
  })

  it('reports the real lane as INCOMPLETE without control-plane credentials', () => {
    expect(hasNeonCreds({})).toBe(false)
    expect(conformanceCredentialStatus({})).toEqual({ status: 'INCOMPLETE', code: 'NEON_CREDENTIALS_UNAVAILABLE' })
  })

  it('fails the required real lane instead of silently skipping when requested', () => {
    if (process.env.DB_CONTRACT_REQUIRED !== '1') return
    expect(requiredConformanceStatus(process.env)).toEqual({ status: 'READY' })
  })

  it('does not claim real conformance without credentials', async () => {
    expect(await runRequiredNeonConformance({})).toEqual({ status: 'INCOMPLETE', code: 'NEON_CREDENTIALS_UNAVAILABLE' })
  })

  it('runs the required sequence through a mocked control plane and cleans up both resources', async () => {
    const events: string[] = []
    let cleanupFails = false
    const plane: NeonControlPlane = {
      async createDisposableProject() {
        events.push('create-project')
        return { ...disposable, connectionUri: 'opaque-test-connection' }
      },
      async createProductionDerivedBranch() {
        events.push('create-branch')
        return { ...derived, connectionUri: 'opaque-production-connection' }
      },
      async proveVariant(_connectionUri, variant) { events.push(`prove-${variant}`) },
      async probeLeastPrivilege() { events.push('probe') },
      async deleteProject() { events.push('delete-project') },
      async verifyProjectDeleted() { events.push('verify-delete') },
      async deleteBranch() { events.push('delete-branch') },
      async verifyBranchDeleted() { events.push('verify-branch-delete') },
      async cleanupRetainedResources() {
        events.push('delete-branch', 'verify-branch-delete', 'delete-project', 'verify-delete')
        if (cleanupFails) throw new Error('opaque cleanup failure')
      },
    }

    expect(await runRequiredNeonConformance({ NEON_API_KEY: 'test-key', NEON_PROJECT_ID: 'production-project' }, plane)).toEqual({
      status: 'PASS',
    })
    expect(events).toEqual([
      'create-project', 'prove-repaired-bootstrap',
      'create-branch', 'prove-original-production',
      'probe', 'probe', 'delete-branch', 'verify-branch-delete', 'delete-project', 'verify-delete',
    ])

    cleanupFails = true
    expect(await runRequiredNeonConformance({ NEON_API_KEY: 'test-key', NEON_PROJECT_ID: 'production-project' }, plane)).toEqual({
      status: 'INCOMPLETE',
      code: 'PROJECT_CLEANUP_UNPROVEN',
    })
  })

  it('cleans the disposable project when derived-branch creation fails', async () => {
    const events: string[] = []
    const plane: NeonControlPlane = {
      async createDisposableProject() {
        events.push('create-project')
        return { ...disposable, connectionUri: 'opaque-test-connection' }
      },
      async createProductionDerivedBranch() {
        events.push('create-branch')
        throw new Error('mocked branch creation failure')
      },
      async proveVariant(_connectionUri, variant) { events.push(`prove-${variant}`) },
      async probeLeastPrivilege() { events.push('probe') },
      async deleteProject() { events.push('delete-project') },
      async verifyProjectDeleted() { events.push('verify-delete') },
      async deleteBranch() { events.push('delete-branch') },
      async verifyBranchDeleted() { events.push('verify-branch-delete') },
      async cleanupRetainedResources() { events.push('delete-project', 'verify-delete') },
    }

    expect(await runRequiredNeonConformance({ NEON_API_KEY: 'test-key', NEON_PROJECT_ID: 'production-project' }, plane)).toEqual({
      status: 'INCOMPLETE',
      code: 'REAL_NEON_CONFORMANCE_FAILED',
    })
    expect(events).toEqual([
      'create-project', 'prove-repaired-bootstrap',
      'create-branch', 'delete-project', 'verify-delete',
    ])
  })

  it('bounds every request and retries only safe GET or DELETE operations', async () => {
    const calls: string[] = []
    const signals: boolean[] = []
    const responses = [
      new Response('', { status: 429 }),
      new Response('{}', { status: 200 }),
    ]
    const fetcher: typeof fetch = async (input, init) => {
      calls.push(`${init?.method ?? 'GET'} ${String(input)}`)
      signals.push(init?.signal instanceof AbortSignal)
      return responses.shift() ?? new Response('{}', { status: 200 })
    }

    await expect(controlPlaneFetchForTest('opaque-key', '/projects/p', { method: 'GET' }, fetcher, [0, 0])).resolves.toMatchObject({ status: 200 })
    expect(calls).toHaveLength(2)
    expect(signals).toEqual([true, true])

    calls.length = 0
    const deleteStatuses = [503, 204]
    await expect(controlPlaneFetchForTest('opaque-key', '/projects/p', { method: 'DELETE' }, async (_input, init) => {
      calls.push(init?.method ?? 'GET')
      const status = deleteStatuses.shift() ?? 204
      return new Response(status === 204 ? null : '', { status })
    }, [0, 0])).resolves.toMatchObject({ status: 204 })
    expect(calls).toEqual(['DELETE', 'DELETE'])

    calls.length = 0
    await expect(controlPlaneFetchForTest('opaque-key', '/projects', { method: 'POST' }, async (_input, init) => {
      calls.push(init?.method ?? 'GET')
      return new Response('', { status: 503 })
    }, [0, 0])).rejects.toThrow('NEON_CONTROL_PLANE_FAILED')
    expect(calls).toEqual(['POST'])
  })

  it('polls project deletion until the control plane proves 404', async () => {
    const statuses = [200, 404]
    const calls: string[] = []
    const plane = createNeonControlPlane(
      { NEON_API_KEY: 'opaque-key', NEON_PROJECT_ID: 'production-project' },
      async (_input, init) => {
        calls.push(init?.method ?? 'GET')
        return new Response('{}', { status: statuses.shift() ?? 404 })
      },
    )
    await expect(plane.verifyProjectDeleted('test-project')).resolves.toBeUndefined()
    expect(calls).toEqual(['GET', 'GET'])
  })
})
