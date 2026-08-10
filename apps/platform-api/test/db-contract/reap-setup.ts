/** Required DB Contract global setup and exact current-run cleanup proof. */

import { randomBytes } from 'node:crypto'
import type { TestProject } from 'vitest/node'

import {
  RUN_TOKEN_ENV,
  assertCurrentRunBranchesAbsent,
  preflightBranchCapacity,
  reapStaleBranches,
  type ReapResult,
} from './neon-branch'
import {
  initializeTelemetry,
  measurePhase,
  recordBranchCapacity,
  recordCleanupComplete,
  recordPhaseDuration,
} from './telemetry'
import {
  DB_CONTRACT_RUNTIME_KEY,
  DB_CONTRACT_SUITE_CONCURRENCY,
  runtimeConfigFromEnv,
  type DbContractRuntimeConfig,
} from './runtime-config'

export interface RequiredSetupDependencies {
  env: NodeJS.ProcessEnv
  reap(): Promise<ReapResult>
  preflight(runtime: DbContractRuntimeConfig): Promise<void>
  assertCurrentRunAbsent(runToken: string): Promise<void>
  makeRunToken(): string
  provide?(key: typeof DB_CONTRACT_RUNTIME_KEY, value: DbContractRuntimeConfig): void
  recordTelemetry?: boolean
  telemetry?: {
    path: string
    exactHead: string
    concurrency: number
  }
}

function defaultDependencies(): RequiredSetupDependencies {
  return {
    env: process.env,
    reap: reapStaleBranches,
    preflight: (runtime) => preflightBranchCapacity(DB_CONTRACT_SUITE_CONCURRENCY, runtime),
    assertCurrentRunAbsent: assertCurrentRunBranchesAbsent,
    makeRunToken: () => randomBytes(6).toString('hex'),
    recordTelemetry: true,
  }
}

export async function runRequiredSetup(
  dependencies: RequiredSetupDependencies = defaultDependencies(),
): Promise<() => Promise<void>> {
  const runToken = dependencies.env[RUN_TOKEN_ENV] ?? dependencies.makeRunToken()
  dependencies.env[RUN_TOKEN_ENV] = runToken
  const runtime = runtimeConfigFromEnv(dependencies.env, runToken)
  dependencies.provide?.(DB_CONTRACT_RUNTIME_KEY, runtime)
  const telemetry = dependencies.telemetry ?? (dependencies.recordTelemetry ? {
    path: runtime.telemetryPath,
    exactHead: runtime.exactHead,
    concurrency: DB_CONTRACT_SUITE_CONCURRENCY,
  } : undefined)
  if (telemetry) initializeTelemetry(telemetry.path, telemetry)
  const credentialStartedAt = performance.now()
  if (!dependencies.env.NEON_API_KEY || !dependencies.env.NEON_PROJECT_ID) {
    throw new Error('DB_CONTRACT_CREDENTIALS_UNAVAILABLE')
  }
  if (telemetry) recordPhaseDuration(telemetry.path, 'credential', performance.now() - credentialStartedAt)

  const reap = telemetry
    ? await measurePhase(telemetry.path, 'reap', dependencies.reap)
    : await dependencies.reap()
  if (!reap.complete || reap.failed.length > 0) throw new Error('DB_CONTRACT_STALE_REAP_INCOMPLETE')
  await dependencies.preflight(runtime)
  if (telemetry) {
    const configured = runtime.branchCap
    const remaining = reap.scanned - reap.deleted.length
    recordBranchCapacity(telemetry.path, { configured, available: configured - remaining })
  }

  return async () => {
    if (!telemetry) {
      await dependencies.assertCurrentRunAbsent(runToken)
      return
    }
    await measurePhase(telemetry.path, 'finalCleanup', () => dependencies.assertCurrentRunAbsent(runToken))
    recordCleanupComplete(telemetry.path)
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  return runRequiredSetup({
    ...defaultDependencies(),
    provide: (key, value) => project.provide(key, value),
  })
}
