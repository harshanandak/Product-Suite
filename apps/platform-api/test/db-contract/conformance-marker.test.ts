import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  assertConformanceMarker,
  writeConformanceMarker,
} from './conformance-marker'

const HEAD = '143b29e7add48303708d64288c4dde55a117a95a'

describe('real-Neon conformance marker', () => {
  it('writes only the exact head with owner-only permissions', () => {
    const directory = mkdtempSync(join(tmpdir(), 'db-contract-marker-'))
    const path = join(directory, 'proof.marker')

    writeConformanceMarker(path, HEAD)

    expect(readFileSync(path, 'utf8')).toBe(HEAD)
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(assertConformanceMarker(path, HEAD)).toEqual({ status: 'PASS' })
  })

  it('fails closed for missing, malformed, or wrong-head markers', () => {
    const directory = mkdtempSync(join(tmpdir(), 'db-contract-marker-'))
    const path = join(directory, 'proof.marker')

    expect(() => assertConformanceMarker(path, HEAD)).toThrow('REAL_NEON_CONFORMANCE_MARKER_MISSING')
    writeConformanceMarker(path, 'a'.repeat(40))
    expect(() => assertConformanceMarker(path, HEAD)).toThrow('REAL_NEON_CONFORMANCE_MARKER_MISMATCH')
    chmodSync(path, 0o600)
    writeFileSync(path, `${HEAD}\n`)
    expect(() => assertConformanceMarker(path, HEAD)).toThrow('REAL_NEON_CONFORMANCE_MARKER_INVALID')
  })
})
