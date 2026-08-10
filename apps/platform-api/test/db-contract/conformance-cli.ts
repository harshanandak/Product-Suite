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

if (import.meta.main) {
  try {
    await runConformanceCli()
  } catch (error) {
    const code = error instanceof NeonConformanceError && /^[A-Z0-9_]+$/.test(error.code)
      ? error.code
      : 'REAL_NEON_CONFORMANCE_FAILED'
    console.error(code)
    process.exitCode = 1
  }
}
