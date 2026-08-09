import { describe, expect, it } from 'vitest'

import {
  assertCleanupEvidence,
  assertDisposableTestProject,
  assertProductionDerivedBranch,
  conformanceCredentialStatus,
  hasNeonCreds,
  requiredConformanceStatus,
  type CleanupEvidence,
  type DisposableTestProject,
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
})
