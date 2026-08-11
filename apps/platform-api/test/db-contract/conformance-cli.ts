import { assertExactConformancePass, NeonConformanceError, runRequiredNeonConformance } from './harness'
import { writeConformanceMarker } from './conformance-marker'

const SHA_PATTERN = /^[0-9a-f]{40}$/i

function exactHeadFromEnv(env: NodeJS.ProcessEnv): string {
  const value = env.DB_CONTRACT_EXACT_HEAD ?? env.GITHUB_SHA ?? ''
  if (!SHA_PATTERN.test(value)) throw new NeonConformanceError('REAL_NEON_CONFORMANCE_HEAD_INVALID')
  return value
}

export async function runConformanceCli(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const markerPath = env.DB_CONTRACT_CONFORMANCE_MARKER_PATH ?? ''
  if (!markerPath) throw new NeonConformanceError('REAL_NEON_CONFORMANCE_MARKER_PATH_REQUIRED')
  const exactHead = exactHeadFromEnv(env)
  const evidence = await runRequiredNeonConformance(env)
  assertExactConformancePass(evidence)
  writeConformanceMarker(markerPath, exactHead)
}

/** Format only stable codes and redacted control-plane categories for CI logs. */
export function formatConformanceFailure(error: unknown): string {
  const code = error instanceof NeonConformanceError && /^[A-Z0-9_]+$/.test(error.code)
    ? error.code
    : 'REAL_NEON_CONFORMANCE_FAILED'
  const diagnostic = error instanceof NeonConformanceError ? error.diagnostic : undefined
  const phase = error instanceof NeonConformanceError && error.phase !== undefined
    ? /^(?:disposable-create|disposable-bootstrap|derived-create|derived-bootstrap|runtime-probe-disposable|runtime-probe-derived|cleanup|unknown)$/.test(error.phase)
      ? error.phase
      : 'unknown'
    : undefined
  const fields = [code]
  if (diagnostic) {
    const endpoint = /^(?:projects|project|project-branches|project-operations|control-plane)$/.test(diagnostic.endpointCategory)
      ? diagnostic.endpointCategory
      : 'control-plane'
    const status = /^(?:[1-5]xx|network|unknown)$/.test(diagnostic.statusClass)
      ? diagnostic.statusClass
      : 'unknown'
    fields.push(`endpoint=${endpoint}`, `status=${status}`)
  }
  if (phase) fields.push(`phase=${phase}`)
  return fields.join(' ')
}

if (import.meta.main) {
  try {
    await runConformanceCli()
  } catch (error) {
    console.error(formatConformanceFailure(error))
    process.exitCode = 1
  }
}
