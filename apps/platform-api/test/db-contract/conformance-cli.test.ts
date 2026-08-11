import { describe, expect, it } from 'vitest'

import { formatConformanceFailure } from './conformance-cli'
import { assertExactConformancePass, NeonConformanceError, runRequiredNeonConformance, type NeonControlPlane } from './harness'

describe('conformance CLI diagnostics', () => {
  it('prints only an endpoint category and HTTP status class for control-plane failures', () => {
    const error = new NeonConformanceError('NEON_CONTROL_PLANE_FAILED', {
      endpointCategory: 'project-branches',
      statusClass: '4xx',
    })

    expect(formatConformanceFailure(error)).toBe(
      'NEON_CONTROL_PLANE_FAILED endpoint=project-branches status=4xx',
    )
    expect(formatConformanceFailure(error)).not.toMatch(
      /https?:|projects\/|branches\/|secret|token|body/i,
    )
  })

  it('preserves redacted control-plane diagnostics through the required-lane envelope', async () => {
    const plane: NeonControlPlane = {
      async createDisposableProject() {
        throw new NeonConformanceError('NEON_CONTROL_PLANE_FAILED', {
          endpointCategory: 'project',
          statusClass: '5xx',
        })
      },
      async createProductionDerivedBranch() { throw new Error('unreachable') },
      async proveVariant() {},
      async probeLeastPrivilege() {},
      async deleteProject() {},
      async verifyProjectDeleted() {},
      async deleteBranch() {},
      async verifyBranchDeleted() {},
      async cleanupRetainedResources() {},
    }

    const evidence = await runRequiredNeonConformance({
      NEON_API_KEY: 'opaque-key',
      NEON_PROJECT_ID: 'production-project',
    }, plane)
    expect(evidence).toMatchObject({
      status: 'INCOMPLETE',
      code: 'NEON_CONTROL_PLANE_FAILED',
      diagnostic: { endpointCategory: 'project', statusClass: '5xx' },
    })

    const failure = await Promise.resolve().then(() => assertExactConformancePass(evidence)).catch((error: unknown) => error)
    expect(formatConformanceFailure(failure)).toBe('NEON_CONTROL_PLANE_FAILED endpoint=project status=5xx phase=disposable-create')
  })

  it('preserves only the allowlisted phase for unknown failures through the required-lane envelope', async () => {
    const plane: NeonControlPlane = {
      async createDisposableProject() {
        throw new Error('secret response body https://neon.example/projects/prod token=opaque')
      },
      async createProductionDerivedBranch() { throw new Error('unreachable') },
      async proveVariant() {},
      async probeLeastPrivilege() {},
      async deleteProject() {},
      async verifyProjectDeleted() {},
      async deleteBranch() {},
      async verifyBranchDeleted() {},
      async cleanupRetainedResources() {},
    }

    const evidence = await runRequiredNeonConformance({
      NEON_API_KEY: 'opaque-key',
      NEON_PROJECT_ID: 'production-project',
    }, plane)
    expect(evidence).toMatchObject({
      status: 'INCOMPLETE',
      code: 'REAL_NEON_CONFORMANCE_FAILED',
      phase: 'disposable-create',
    })

    const failure = await Promise.resolve().then(() => assertExactConformancePass(evidence)).catch((error: unknown) => error)
    const formatted = formatConformanceFailure(failure)
    expect(formatted).toBe('REAL_NEON_CONFORMANCE_FAILED phase=disposable-create')
    expect(formatted).not.toMatch(/https?:|projects\/|secret|token|body|production-project/i)
  })

  it('maps adversarial phase metadata to unknown', () => {
    const error = new NeonConformanceError('REAL_NEON_CONFORMANCE_FAILED', undefined, 'projects/prod')
    expect(formatConformanceFailure(error)).toBe('REAL_NEON_CONFORMANCE_FAILED phase=unknown')
  })
})
