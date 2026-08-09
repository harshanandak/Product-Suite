/** Required DB Contract global setup and exact current-run cleanup proof. */

import { randomBytes } from 'node:crypto'

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
  telemetryPathFromEnv,
} from './telemetry'

export interface RequiredSetupDependencies {
  env: NodeJS.ProcessEnv
  reap(): Promise<ReapResult>
  preflight(): Promise<void>
  assertCurrentRunAbsent(runToken: string): Promise<void>
  makeRunToken(): string
  telemetry?: {
    path: string
    exactHead: string
    concurrency: number
  }
}

const defaultDependencies: RequiredSetupDependencies = {
  env: process.env,
  reap: reapStaleBranches,
  preflight: () => preflightBranchCapacity(1),
  assertCurrentRunAbsent: assertCurrentRunBranchesAbsent,
  makeRunToken: () => randomBytes(6).toString('hex'),
  telemetry: {
    path: telemetryPathFromEnv(),
    exactHead: process.env.DB_CONTRACT_EXACT_HEAD ?? '',
    concurrency: 1,
  },
}

export async function runRequiredSetup(
  dependencies: RequiredSetupDependencies = defaultDependencies,
): Promise<() => Promise<void>> {
  const telemetry = dependencies.telemetry
  if (telemetry) initializeTelemetry(telemetry.path, telemetry)
  const credentialStartedAt = performance.now()
  if (!dependencies.env.NEON_API_KEY || !dependencies.env.NEON_PROJECT_ID) {
    throw new Error('DB_CONTRACT_CREDENTIALS_UNAVAILABLE')
  }
  if (telemetry) recordPhaseDuration(telemetry.path, 'credential', performance.now() - credentialStartedAt)
  const runToken = dependencies.env[RUN_TOKEN_ENV] ?? dependencies.makeRunToken()
  dependencies.env[RUN_TOKEN_ENV] = runToken

  const reap = telemetry
    ? await measurePhase(telemetry.path, 'reap', dependencies.reap)
    : await dependencies.reap()
  if (!reap.complete || reap.failed.length > 0) throw new Error('DB_CONTRACT_STALE_REAP_INCOMPLETE')
  await dependencies.preflight()
  if (telemetry) {
    const configured = Number(dependencies.env.DB_CONTRACT_BRANCH_CAP)
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

export default async function setup(): Promise<() => Promise<void>> {
  return runRequiredSetup()
}
