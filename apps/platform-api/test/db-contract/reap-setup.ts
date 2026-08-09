/** Required DB Contract global setup and exact current-run cleanup proof. */

import { randomBytes } from 'node:crypto'

import {
  RUN_TOKEN_ENV,
  assertCurrentRunBranchesAbsent,
  preflightBranchCapacity,
  reapStaleBranches,
  type ReapResult,
} from './neon-branch'

export interface RequiredSetupDependencies {
  env: NodeJS.ProcessEnv
  reap(): Promise<ReapResult>
  preflight(): Promise<void>
  assertCurrentRunAbsent(runToken: string): Promise<void>
  makeRunToken(): string
}

const defaultDependencies: RequiredSetupDependencies = {
  env: process.env,
  reap: reapStaleBranches,
  preflight: () => preflightBranchCapacity(1),
  assertCurrentRunAbsent: assertCurrentRunBranchesAbsent,
  makeRunToken: () => randomBytes(6).toString('hex'),
}

export async function runRequiredSetup(
  dependencies: RequiredSetupDependencies = defaultDependencies,
): Promise<() => Promise<void>> {
  if (!dependencies.env.NEON_API_KEY || !dependencies.env.NEON_PROJECT_ID) {
    throw new Error('DB_CONTRACT_CREDENTIALS_UNAVAILABLE')
  }
  const runToken = dependencies.env[RUN_TOKEN_ENV] ?? dependencies.makeRunToken()
  dependencies.env[RUN_TOKEN_ENV] = runToken

  const reap = await dependencies.reap()
  if (!reap.complete || reap.failed.length > 0) throw new Error('DB_CONTRACT_STALE_REAP_INCOMPLETE')
  await dependencies.preflight()

  return async () => {
    await dependencies.assertCurrentRunAbsent(runToken)
  }
}

export default async function setup(): Promise<() => Promise<void>> {
  return runRequiredSetup()
}
