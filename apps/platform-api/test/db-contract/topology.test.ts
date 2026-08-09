import { describe, expect, it } from 'vitest'

import {
  EXPECTED_CONTROL_PLANE_ASSERTIONS,
  EXPECTED_REAL_ASSERTIONS,
  EXPECTED_TOTAL_ASSERTIONS,
  SUITE_MANIFEST,
  TOPOLOGY_VERSION,
  classifyTestId,
  getTopologySummary,
} from './topology'

describe('db-contract topology lock', () => {
  it('locks the 57-test inventory and its three execution classes', () => {
    const summary = getTopologySummary()

    expect(TOPOLOGY_VERSION).toBe('db-contract-v1')
    expect(summary.totalAssertions).toBe(EXPECTED_TOTAL_ASSERTIONS)
    expect(summary.realAssertions).toBe(EXPECTED_REAL_ASSERTIONS)
    expect(summary.controlPlaneAssertions).toBe(EXPECTED_CONTROL_PLANE_ASSERTIONS)
    expect(summary.transactionalAssertions).toBe(19)
    expect(summary.dedicatedAssertions).toBe(9)
    expect(summary.controlPlaneBySuite).toEqual({
      'neon-authority': 18,
      'role-privileges': 7,
      reap: 4,
    })
    expect(SUITE_MANIFEST.every((entry) => entry.executionClass)).toBe(true)
  })

  it('classifies only explicit manifest ids, never a destructive prefix', () => {
    expect(classifyTestId('accept-path:2')).toMatchObject({ executionClass: 'transactional-suite' })
    expect(classifyTestId('accept-path:8')).toMatchObject({ executionClass: 'dedicated-branch' })
    expect(classifyTestId('accept-path:8-extra')).toBeUndefined()
    expect(classifyTestId('accept-path:999')).toBeUndefined()
  })

  it('keeps control-plane assertions out of branch coverage', () => {
    const role = classifyTestId('role-privileges:1')
    const authority = classifyTestId('neon-authority:1')
    const reap = classifyTestId('reap:1')

    expect(role).toMatchObject({ executionClass: 'control-plane-unit', suiteId: 'role-privileges' })
    expect(authority).toMatchObject({ executionClass: 'control-plane-unit', suiteId: 'neon-authority' })
    expect(reap).toMatchObject({ executionClass: 'control-plane-unit', suiteId: 'reap' })
    expect(role?.branchCoverage).toBe(false)
    expect(authority?.branchCoverage).toBe(false)
    expect(reap?.branchCoverage).toBe(false)
  })

  it('derives control-plane counts from the supplied manifest', () => {
    const withoutOneReapAssertion = SUITE_MANIFEST.filter((entry) => entry.id !== 'reap:4')

    expect(getTopologySummary(withoutOneReapAssertion).controlPlaneBySuite).toEqual({
      'neon-authority': 18,
      'role-privileges': 7,
      reap: 3,
    })
  })
})
