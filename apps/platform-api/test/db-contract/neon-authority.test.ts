import type { Sql } from '@product-suite/db'
import { describe, expect, it, vi } from 'vitest'

import {
  assertCleanupEvidence,
  assertConformanceMarker,
  assertDisposableTestProject,
  assertExactConformancePass,
  assertNeonConnectionBinding,
  assertProductionDerivedBranch,
  controlPlaneFetchForTest,
  createNeonControlPlane,
  conformanceCredentialStatus,
  hasNeonCreds,
  prepareHarnessDatabase,
  runRequiredNeonConformance,
  variantMigrationContract,
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
  it('provisions canonical runtime roles before applying per-test migrations', async () => {
    const events: string[] = []
    const sql = {} as Sql

    await prepareHarnessDatabase('opaque-connection', sql, {
      async provisionRoles(connectionUri) { events.push(`roles:${connectionUri}`) },
      async applyMigrations(receivedSql) {
        expect(receivedSql).toBe(sql)
        events.push('migrations')
      },
    })

    expect(events).toEqual(['roles:opaque-connection', 'migrations'])
  })

  it('fails closed before migrations when runtime role provisioning fails', async () => {
    const applyMigrations = vi.fn()

    await expect(prepareHarnessDatabase('opaque-connection', {} as Sql, {
      async provisionRoles() { throw new Error('ROLE_PROVISIONING_FAILED') },
      applyMigrations,
    })).rejects.toThrow('ROLE_PROVISIONING_FAILED')
    expect(applyMigrations).not.toHaveBeenCalled()
  })

  it('requires both history variants to apply synthetic 0020 and finish at a 0020 NOOP floor', () => {
    expect(variantMigrationContract('repaired-bootstrap')).toEqual({ baselineFloor: '0019', baselineCount: 20, declared: ['0020'], finalFloor: '0020' })
    expect(variantMigrationContract('original-production')).toEqual({ baselineFloor: '0017', baselineCount: 18, declared: ['0018', '0019', '0020'], finalFloor: '0020' })
  })

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

  it('requires a separate non-root branch derived from production history', async () => {
    expect(assertProductionDerivedBranch(derived)).toMatchObject({
      authority: 'production-derived',
      historyVariant: 'original-production',
    })
    expect(() => assertProductionDerivedBranch({ ...derived, branchIsRoot: true })).toThrow('PRODUCTION_DERIVED_ROOT')
    expect(() => assertProductionDerivedBranch({ ...derived, parentBranchId: undefined })).toThrow(
      'PRODUCTION_DERIVED_PARENT_REQUIRED',
    )

    const directUri = 'postgresql://owner:opaque@ep-safe-compute.us-east-2.aws.neon.tech/neondb?sslmode=require'
    const connectionBody = {
      connection_uris: [{
        connection_uri: directUri,
        connection_parameters: {
          database: 'neondb', role: 'owner', password: 'opaque',
          host: 'ep-safe-compute.us-east-2.aws.neon.tech',
          pooler_host: 'ep-safe-compute-pooler.us-east-2.aws.neon.tech',
        },
      }],
      endpoints: [{
        id: 'ep-safe-compute', host: 'ep-safe-compute.us-east-2.aws.neon.tech',
        project_id: 'test-project', branch_id: 'test-root', type: 'read_write',
      }],
    }
    const expectedBinding = { projectId: 'test-project', branchId: 'test-root', purpose: 'migration' as const }
    expect(assertNeonConnectionBinding(connectionBody, expectedBinding)).toEqual({ status: 'READY' })
    const pooledUri = directUri.replace('ep-safe-compute.', 'ep-safe-compute-pooler.')
    const runtimeBinding = { ...expectedBinding, purpose: 'runtime' as const }
    expect(assertNeonConnectionBinding(connectionBody, runtimeBinding, pooledUri)).toEqual({ status: 'READY' })
    expect(() => assertNeonConnectionBinding(connectionBody, runtimeBinding, directUri)).toThrow(
      'NEON_CONNECTION_PURPOSE_INVALID',
    )
    for (const malformed of [
      { ...connectionBody, connection_uris: [{ ...connectionBody.connection_uris[0], connection_uri: directUri.replace('postgresql:', 'https:') }] },
      { ...connectionBody, connection_uris: [{ ...connectionBody.connection_uris[0], connection_uri: directUri.replace('.neon.tech', '.neon.tech.evil.example') }] },
      { ...connectionBody, connection_uris: [{ ...connectionBody.connection_uris[0], connection_uri: directUri.replace('sslmode=require', 'sslmode=disable') }] },
      { ...connectionBody, connection_uris: [{ ...connectionBody.connection_uris[0], connection_uri: directUri.replace('ep-safe-compute.', 'ep-safe-compute-pooler.') }] },
      { ...connectionBody, endpoints: [{ ...connectionBody.endpoints[0], project_id: 'wrong-project' }] },
      { ...connectionBody, endpoints: [{ ...connectionBody.endpoints[0], branch_id: 'wrong-branch' }] },
    ]) {
      expect(() => assertNeonConnectionBinding(malformed, expectedBinding)).toThrow()
    }

    for (const explicitParent of [undefined, 'unlisted-parent']) {
      const calls: string[] = []
      const plane = createNeonControlPlane(
        {
          NEON_API_KEY: 'opaque-key',
          NEON_PROJECT_ID: 'production-project',
          ...(explicitParent ? { NEON_PARENT_BRANCH_ID: explicitParent } : {}),
        },
        async (input, init) => {
          const path = String(input)
          calls.push(`${init?.method ?? 'GET'} ${path}`)
          if (path.endsWith('/projects/production-project')) {
            return new Response(JSON.stringify({ project: { id: 'production-project' } }))
          }
          if (path.includes('/branches?')) {
            return new Response(JSON.stringify({ branches: [{ id: 'not-default', default: false, parent_id: 'production-root' }] }))
          }
          return new Response(JSON.stringify({
            branch: { id: 'unsafe-derived', parent_id: 'not-default', default: false },
            connection_uris: [{ connection_uri: 'postgresql://opaque:opaque@ep.neon.tech/neondb?sslmode=require' }],
          }))
        },
      )
      await expect(plane.createProductionDerivedBranch()).rejects.toThrow('PRODUCTION_DERIVED_PARENT_UNAVAILABLE')
      expect(calls.some((call) => call.startsWith('POST '))).toBe(false)
    }

    for (const malformedBranch of [
      { parent_id: 'not-production-root', default: false },
      { parent_id: 'production-root', default: true },
      { parent_id: 'production-root', default: false, name: 'wrong-generated-name' },
    ]) {
      const calls: string[] = []
      const plane = createNeonControlPlane(
        { NEON_API_KEY: 'opaque-key', NEON_PROJECT_ID: 'production-project' },
        async (input, init) => {
          const path = String(input)
          calls.push(`${init?.method ?? 'GET'} ${path}`)
          if (path.endsWith('/projects/production-project')) {
            return new Response(JSON.stringify({ project: { id: 'production-project' } }))
          }
          if (path.includes('/branches?')) {
            return new Response(JSON.stringify({ branches: [{ id: 'production-root', default: true, parent_id: null }] }))
          }
          if (init?.method === 'POST') {
            const request = JSON.parse(String(init.body)) as { branch: { name: string } }
            return new Response(JSON.stringify({
              branch: { id: 'safe-derived', name: request.branch.name, ...malformedBranch },
              connection_uris: [{ connection_uri: 'postgresql://opaque:opaque@ep.neon.tech/neondb?sslmode=require' }],
            }))
          }
          if (init?.method === 'DELETE') return new Response(null, { status: 204 })
          return new Response('{}', { status: 404 })
        },
      )
      await expect(plane.createProductionDerivedBranch()).rejects.toBeInstanceOf(Error)
      await plane.cleanupRetainedResources()
      expect(calls.filter((call) => call.startsWith('DELETE '))).toHaveLength(1)
      expect(calls.at(-1)).toMatch(/^GET .*\/branches\/safe-derived$/)
    }

    const protectedCalls: string[] = []
    const protectedPlane = createNeonControlPlane(
      { NEON_API_KEY: 'opaque-key', NEON_PROJECT_ID: 'production-project' },
      async (input, init) => {
        const path = String(input)
        protectedCalls.push(`${init?.method ?? 'GET'} ${path}`)
        if (path.endsWith('/projects/production-project')) {
          return new Response(JSON.stringify({ project: { id: 'production-project' } }))
        }
        if (path.includes('/branches?')) {
          return new Response(JSON.stringify({ branches: [{ id: 'production-root', default: true, parent_id: null }] }))
        }
        if (init?.method === 'POST') {
          const request = JSON.parse(String(init.body)) as { branch: { name: string } }
          return new Response(JSON.stringify({
            branch: { id: 'production-root', name: request.branch.name, parent_id: 'production-root', default: false },
            connection_uris: [{ connection_uri: directUri }],
          }))
        }
        return new Response('{}', { status: 404 })
      },
    )
    await expect(protectedPlane.createProductionDerivedBranch()).rejects.toBeInstanceOf(Error)
    await protectedPlane.cleanupRetainedResources()
    expect(protectedCalls.some((call) => call.startsWith('DELETE '))).toBe(false)

    const guardedCalls: string[] = []
    const guardedPlane = createNeonControlPlane(
      { NEON_API_KEY: 'opaque-key', NEON_PROJECT_ID: 'production-project' },
      async (input, init) => {
        guardedCalls.push(`${init?.method ?? 'GET'} ${String(input)}`)
        return new Response('{}')
      },
    )
    await expect(guardedPlane.deleteProject('production-project')).rejects.toThrow('UNSAFE_PROJECT_DELETE_TARGET')
    await expect(guardedPlane.deleteBranch('production-project', 'production-root')).rejects.toThrow('UNSAFE_BRANCH_DELETE_TARGET')
    expect(guardedCalls).toEqual([])
  })

  it('requires create, bootstrap, verify, delete, and deletion proof in cleanup evidence', () => {
    const complete: CleanupEvidence = {
      projectCreated: true,
      repairedBootstrapVerified: true,
      productionDerivedBranchVerified: true,
      branchDeleteRequested: true,
      branchDeletionVerified: true,
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
    expect(() => assertCleanupEvidence({ ...complete, branchDeleteRequested: false })).toThrow(
      'BRANCH_CLEANUP_REQUIRED',
    )
    expect(() => assertCleanupEvidence({ ...complete, branchDeletionVerified: false })).toThrow(
      'BRANCH_DELETION_UNPROVEN',
    )
  })

  it('reports the real lane as INCOMPLETE without control-plane credentials', () => {
    expect(hasNeonCreds({})).toBe(false)
    expect(conformanceCredentialStatus({})).toEqual({ status: 'INCOMPLETE', code: 'NEON_CREDENTIALS_UNAVAILABLE' })
  })

  it('fails the required real lane instead of silently skipping when requested', async ({ skip }) => {
    if (process.env.DB_CONTRACT_REQUIRED !== '1') skip()
    if (process.env.DB_CONTRACT_CONFORMANCE_MARKER_PATH) {
      expect(assertConformanceMarker(process.env.DB_CONTRACT_CONFORMANCE_MARKER_PATH, process.env.DB_CONTRACT_EXACT_HEAD ?? process.env.GITHUB_SHA ?? '')).toEqual({ status: 'PASS' })
      return
    }
    if (process.env.CI === 'true') {
      assertConformanceMarker('', process.env.DB_CONTRACT_EXACT_HEAD ?? process.env.GITHUB_SHA ?? '')
      return
    }
    const evidence = await runRequiredNeonConformance(process.env)
    expect(assertExactConformancePass(evidence)).toEqual({ status: 'PASS' })
  })

  it('does not claim real conformance without credentials', async () => {
    expect(await runRequiredNeonConformance({})).toEqual({ status: 'INCOMPLETE', code: 'NEON_CREDENTIALS_UNAVAILABLE' })
    expect(assertExactConformancePass({ status: 'PASS' })).toEqual({ status: 'PASS' })
    expect(() => assertExactConformancePass({ status: 'INCOMPLETE', code: 'REAL_NEON_CONFORMANCE_FAILED' })).toThrow(
      'REAL_NEON_CONFORMANCE_FAILED',
    )
    expect(() => assertExactConformancePass({ status: 'PASS', code: 'FABRICATED_DETAIL' })).toThrow(
      'REAL_NEON_CONFORMANCE_REQUIRED',
    )
  })

  it('runs the required sequence through a mocked control plane and cleans up both resources', async () => {
    const events: string[] = []
    let cleanupFails = false
    const plane: NeonControlPlane = {
      async createDisposableProject() {
        events.push('create-project')
        return {
          ...disposable,
          connectionUri: 'opaque-test-direct-connection',
          runtimeConnectionUri: 'opaque-test-pooled-connection',
        }
      },
      async createProductionDerivedBranch() {
        events.push('create-branch')
        return {
          ...derived,
          connectionUri: 'opaque-production-direct-connection',
          runtimeConnectionUri: 'opaque-production-pooled-connection',
        }
      },
      async proveVariant(connectionUri, variant) { events.push(`prove:${connectionUri}:${variant}`) },
      async probeLeastPrivilege(connectionUri) { events.push(`probe:${connectionUri}`) },
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
      'create-project', 'prove:opaque-test-direct-connection:repaired-bootstrap',
      'create-branch', 'prove:opaque-production-direct-connection:original-production',
      'probe:opaque-test-pooled-connection', 'probe:opaque-production-pooled-connection',
      'delete-branch', 'verify-branch-delete', 'delete-project', 'verify-delete',
    ])

    cleanupFails = true
    expect(await runRequiredNeonConformance({ NEON_API_KEY: 'test-key', NEON_PROJECT_ID: 'production-project' }, plane)).toEqual({
      status: 'INCOMPLETE',
      code: 'PROJECT_CLEANUP_UNPROVEN',
      phase: 'cleanup',
    })
  })

  it('cleans the disposable project when derived-branch creation fails', async () => {
    const events: string[] = []
    const plane: NeonControlPlane = {
      async createDisposableProject() {
        events.push('create-project')
        return {
          ...disposable,
          connectionUri: 'opaque-test-direct-connection',
          runtimeConnectionUri: 'opaque-test-pooled-connection',
        }
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
      phase: 'derived-create',
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
    }, [0, 0])).rejects.toThrow('UNAVAILABLE')
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

    const protectedCreate = (projectName: string) => ({
      project: { id: 'production-project', name: projectName },
      branch: { id: 'production-root', parent_id: null, default: true },
      connection_uris: [{ connection_uri: 'postgresql://opaque:opaque@ep.neon.tech/neondb?sslmode=require' }],
    })
    const malformedCreates = [
      (projectName: string) => ({
        project: { id: 'test-project', name: projectName },
        branch: { id: 'test-root', parent_id: 'unexpected-parent', default: true },
        connection_uris: [{ connection_uri: 'postgresql://opaque:opaque@ep.neon.tech/neondb?sslmode=require' }],
      }),
      (projectName: string) => ({
        project: { id: 'test-project', name: projectName },
        branch: { id: 'test-root', parent_id: null, default: false },
        connection_uris: [{ connection_uri: 'postgresql://opaque:opaque@ep.neon.tech/neondb?sslmode=require' }],
      }),
      (_projectName: string) => ({
        project: { id: 'test-project', name: 'wrong-generated-name' },
        branch: { id: 'test-root', parent_id: null, default: true },
        connection_uris: [{ connection_uri: 'postgresql://opaque:opaque@ep.neon.tech/neondb?sslmode=require' }],
      }),
    ]
    for (const malformedCreate of malformedCreates) {
      const malformedCalls: string[] = []
      const malformedPlane = createNeonControlPlane(
        { NEON_API_KEY: 'opaque-key', NEON_PROJECT_ID: 'production-project' },
        async (input, init) => {
          malformedCalls.push(`${init?.method ?? 'GET'} ${String(input)}`)
          if (init?.method === 'GET' && String(input).endsWith('/projects/production-project')) {
            return new Response(JSON.stringify({ project: { id: 'production-project', org_id: 'org-123' } }))
          }
          if (init?.method === 'POST') {
            const request = JSON.parse(String(init.body)) as { project: { name: string } }
            return new Response(JSON.stringify(malformedCreate(request.project.name)))
          }
          if (init?.method === 'DELETE') return new Response(null, { status: 204 })
          return new Response('{}', { status: 404 })
        },
      )
      await expect(malformedPlane.createDisposableProject()).rejects.toBeInstanceOf(Error)
      await malformedPlane.cleanupRetainedResources()
      expect(malformedCalls.filter((call) => call.startsWith('DELETE '))).toHaveLength(1)
      expect(malformedCalls.at(-1)).toMatch(/^GET .*\/projects\/test-project$/)
    }

    const protectedCalls: string[] = []
    const protectedPlane = createNeonControlPlane(
      { NEON_API_KEY: 'opaque-key', NEON_PROJECT_ID: 'production-project' },
      async (input, init) => {
        protectedCalls.push(`${init?.method ?? 'GET'} ${String(input)}`)
        if (init?.method === 'GET' && String(input).endsWith('/projects/production-project')) {
          return new Response(JSON.stringify({ project: { id: 'production-project', org_id: 'org-123' } }))
        }
        const request = JSON.parse(String(init?.body)) as { project: { name: string } }
        return new Response(JSON.stringify(protectedCreate(request.project.name)))
      },
    )
    await expect(protectedPlane.createDisposableProject()).rejects.toBeInstanceOf(Error)
    await protectedPlane.cleanupRetainedResources()
    expect(protectedCalls.some((call) => call.startsWith('DELETE '))).toBe(false)
  })
})
