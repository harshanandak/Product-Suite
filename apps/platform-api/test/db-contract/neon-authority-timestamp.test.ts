import { describe, expect, it, vi } from 'vitest'

import {
  effectiveTimestampFilesForVariant,
  nextSyntheticMigrationTimestamp,
} from './harness'

describe('Neon authority synthetic migration timestamps', () => {
  it('orders synthetic 0020 after each history variant effective timestamp', () => {
    const repairedCanonical = Array.from({ length: 20 }, (_, timestamp) => ({ timestamp }))
    const productionNormalized = [
      { timestamp: 1_785_081_600_000 },
      { timestamp: 1_786_229_538_854 },
    ]

    expect(nextSyntheticMigrationTimestamp(repairedCanonical)).toBe(20)
    expect(nextSyntheticMigrationTimestamp(productionNormalized)).toBe(1_786_229_538_855)
  })

  it('normalizes timestamps only for the original-production call path', () => {
    const canonical = [{ timestamp: 19 }]
    const productionNormalized = [{ timestamp: 1_786_229_538_854 }]
    const normalizeProduction = vi.fn(() => productionNormalized)

    expect(effectiveTimestampFilesForVariant(
      'original-production',
      canonical,
      normalizeProduction,
    )).toBe(productionNormalized)
    expect(normalizeProduction).toHaveBeenCalledTimes(1)
    expect(normalizeProduction).toHaveBeenCalledWith(canonical)

    normalizeProduction.mockClear()
    expect(effectiveTimestampFilesForVariant(
      'repaired-bootstrap',
      canonical,
      normalizeProduction,
    )).toBe(canonical)
    expect(normalizeProduction).not.toHaveBeenCalled()
  })

  it.each([
    ['empty', []],
    ['NaN', [{ timestamp: Number.NaN }]],
    ['infinite', [{ timestamp: Number.POSITIVE_INFINITY }]],
    ['fractional', [{ timestamp: 19.5 }]],
    ['negative', [{ timestamp: -1 }]],
    ['maximum safe integer', [{ timestamp: Number.MAX_SAFE_INTEGER }]],
  ])('fails closed for %s effective timestamps', (_label, effectiveFiles) => {
    let failure: unknown
    try {
      nextSyntheticMigrationTimestamp(effectiveFiles)
    } catch (error) {
      failure = error
    }
    expect(failure).toMatchObject({
      code: 'CANONICAL_FILE_LOAD_UNPROVEN',
      message: 'CANONICAL_FILE_LOAD_UNPROVEN',
    })
  })
})
