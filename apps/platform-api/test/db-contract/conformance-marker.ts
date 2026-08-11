import { chmodSync, readFileSync, writeFileSync } from 'node:fs'

const SHA_PATTERN = /^[0-9a-f]{40}$/i

export const CONFORMANCE_MARKER_MISSING = 'REAL_NEON_CONFORMANCE_MARKER_MISSING' as const
export const CONFORMANCE_MARKER_INVALID = 'REAL_NEON_CONFORMANCE_MARKER_INVALID' as const
export const CONFORMANCE_MARKER_MISMATCH = 'REAL_NEON_CONFORMANCE_MARKER_MISMATCH' as const
export const CONFORMANCE_MARKER_PATH_REQUIRED = 'REAL_NEON_CONFORMANCE_MARKER_PATH_REQUIRED' as const

export type ConformanceMarkerFailureCode =
  | typeof CONFORMANCE_MARKER_MISSING
  | typeof CONFORMANCE_MARKER_INVALID
  | typeof CONFORMANCE_MARKER_MISMATCH
  | typeof CONFORMANCE_MARKER_PATH_REQUIRED

export class ConformanceMarkerError extends Error {
  readonly code: ConformanceMarkerFailureCode

  constructor(code: ConformanceMarkerFailureCode) {
    super(code)
    this.name = 'ConformanceMarkerError'
    this.code = code
  }
}

const fail = (code: ConformanceMarkerFailureCode): never => {
  throw new ConformanceMarkerError(code)
}

function assertHead(value: string): string {
  if (!SHA_PATTERN.test(value)) fail(CONFORMANCE_MARKER_INVALID)
  return value
}

/** Write an owner-readable exact-head marker; no status or diagnostic is persisted. */
export function writeConformanceMarker(path: string, exactHead: string): void {
  if (!path) fail(CONFORMANCE_MARKER_PATH_REQUIRED)
  const head = assertHead(exactHead)
  writeFileSync(path, head, { encoding: 'utf8', mode: 0o600 })
  chmodSync(path, 0o600)
}

/** Accept only a marker containing exactly the expected 40-character commit SHA. */
export function assertConformanceMarker(path: string, expectedHead: string): { status: 'PASS' } {
  if (!path) fail(CONFORMANCE_MARKER_MISSING)
  const expected = assertHead(expectedHead)
  let actual = ''
  try {
    actual = readFileSync(path, 'utf8')
  } catch {
    fail(CONFORMANCE_MARKER_MISSING)
  }
  if (!SHA_PATTERN.test(actual)) fail(CONFORMANCE_MARKER_INVALID)
  if (actual !== expected) fail(CONFORMANCE_MARKER_MISMATCH)
  return { status: 'PASS' }
}
