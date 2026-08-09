import { describe, expect, it } from 'vitest'

import {
  DB_CONTRACT_INCOMPLETE_CLEANUP,
  DB_CONTRACT_METADATA,
  DB_CONTRACT_SKIPPED,
  DB_CONTRACT_TOPOLOGY_MISMATCH,
  DB_CONTRACT_UNCLASSIFIED,
  DB_CONTRACT_ZERO_TESTS,
  assertDbContractEvidence,
  ZeroSkipReporter,
  type DbContractEvidence,
} from './zero-skip-reporter'

const complete = (overrides: Partial<DbContractEvidence> = {}): DbContractEvidence => ({
  collected: 57,
  passed: 57,
  skipped: 0,
  todo: 0,
  pending: 0,
  filtered: 0,
  unclassified: [],
  exactHead: 'abc123',
  cleanupComplete: true,
  ...overrides,
})

describe('db-contract zero-skip reporter', () => {
  it('reads Vitest 4 state from the one-argument testCase.result() API', () => {
    const reporter = new ZeroSkipReporter()
    let resultReads = 0
    const testCase = {
      name: 'test',
      module: { moduleId: 'apps/platform-api/test/db-contract/reap.test.ts' },
      result: () => {
        resultReads += 1
        return { state: 'skipped' }
      },
    }

    const onTestCaseResult = reporter.onTestCaseResult.bind(reporter) as unknown as (testCase: unknown) => void
    expect(() => onTestCaseResult(testCase)).not.toThrow()
    expect(resultReads).toBe(1)
    expect(reporter.getEvidenceSnapshot().skipped).toBe(1)
  })

  it('accepts a complete exact-head run', () => {
    expect(() => assertDbContractEvidence(complete())).not.toThrow()
  })

  it('fails closed with stable zero-test, skip, and unclassified codes', () => {
    expect(() => assertDbContractEvidence(complete({ collected: 0, passed: 0 }))).toThrowError(
      new RegExp(DB_CONTRACT_ZERO_TESTS),
    )
    expect(() => assertDbContractEvidence(complete({ skipped: 1 }))).toThrowError(new RegExp(DB_CONTRACT_SKIPPED))
    expect(() => assertDbContractEvidence(complete({ unclassified: ['unknown:test'] }))).toThrowError(
      new RegExp(DB_CONTRACT_UNCLASSIFIED),
    )
  })

  it('fails closed for count, exact-head, and cleanup evidence without secrets', () => {
    expect(() => assertDbContractEvidence(complete({ collected: 56 }))).toThrowError(
      new RegExp(DB_CONTRACT_TOPOLOGY_MISMATCH),
    )
    expect(() => assertDbContractEvidence(complete({ exactHead: '' }))).toThrowError(new RegExp(DB_CONTRACT_METADATA))
    expect(() => assertDbContractEvidence(complete({ cleanupComplete: false }))).toThrowError(
      new RegExp(DB_CONTRACT_INCOMPLETE_CLEANUP),
    )
    const secret = 'https://secret.example/connection?api_key=x'
    expect(() => assertDbContractEvidence(complete({ exactHead: secret, expectedExactHead: 'safe-sha' }))).toThrowError(
      new RegExp(DB_CONTRACT_METADATA),
    )
    try {
      assertDbContractEvidence(complete({ exactHead: secret, expectedExactHead: 'safe-sha' }))
    } catch (error) {
      expect(String(error)).not.toContain(secret)
    }
  })
})
