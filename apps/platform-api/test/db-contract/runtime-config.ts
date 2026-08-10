import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { inject } from 'vitest'

export const DB_CONTRACT_RUNTIME_KEY = 'dbContractRuntime' as const
export const DB_CONTRACT_SUITE_CONCURRENCY = 2 as const
export const DB_CONTRACT_DATABASE_NAME = 'neondb' as const
export const DB_CONTRACT_ROLE_NAME = 'neondb_owner' as const

export interface DbContractRuntimeConfig {
  runToken: string
  branchCap: number
  exactHead: string
  telemetryPath: string
  leaseRoot: string
  databaseName: typeof DB_CONTRACT_DATABASE_NAME
  roleName: typeof DB_CONTRACT_ROLE_NAME
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
    leaseRoot: resolve(env.DB_CONTRACT_LEASE_ROOT ?? resolve(tmpdir(), 'product-suite-db-contract-leases')),
    databaseName: DB_CONTRACT_DATABASE_NAME,
    roleName: DB_CONTRACT_ROLE_NAME,
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
