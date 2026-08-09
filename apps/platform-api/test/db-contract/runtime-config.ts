import { resolve } from 'node:path'

import { inject } from 'vitest'

export const DB_CONTRACT_RUNTIME_KEY = 'dbContractRuntime' as const
export const DB_CONTRACT_SUITE_CONCURRENCY = 2 as const

export interface DbContractRuntimeConfig {
  runToken: string
  branchCap: number
  exactHead: string
  telemetryPath: string
}

declare module 'vitest' {
  export interface ProvidedContext {
    dbContractRuntime: DbContractRuntimeConfig
  }
}

export function runtimeConfigFromEnv(
  env: NodeJS.ProcessEnv,
  runToken = env.DB_CONTRACT_RUN_TOKEN ?? '',
): DbContractRuntimeConfig {
  return {
    runToken,
    branchCap: Number(env.DB_CONTRACT_BRANCH_CAP),
    exactHead: env.DB_CONTRACT_EXACT_HEAD ?? '',
    telemetryPath: resolve(env.DB_CONTRACT_TELEMETRY_PATH ?? 'db-contract-telemetry.json'),
  }
}

export function injectedRuntimeConfig(): DbContractRuntimeConfig | undefined {
  try {
    return inject(DB_CONTRACT_RUNTIME_KEY)
  } catch {
    return undefined
  }
}

export function workerRuntimeConfig(env: NodeJS.ProcessEnv = process.env): DbContractRuntimeConfig {
  return injectedRuntimeConfig() ?? runtimeConfigFromEnv(env)
}
