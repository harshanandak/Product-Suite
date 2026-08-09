import { defineConfig, type ViteUserConfig } from 'vitest/config'

import { DB_CONTRACT_SUITE_CONCURRENCY } from './test/db-contract/runtime-config'

const DB_CONTRACT_INCLUDE = [
  'test/db-contract/{accept-path,baseline,collaboration,meeting-ingest,memory-curator,memory-tier,neon-authority,reap,role-privileges}.test.ts',
] as const

export function createDbContractVitestConfig(): ViteUserConfig {
  const listMode = process.env.DB_CONTRACT_LIST_ONLY === '1'

  return {
    test: {
      // Keep the evidence lane explicit: A1's topology/reporter unit tests are
      // local checks and must not inflate the locked 57-test real inventory.
      include: [...DB_CONTRACT_INCLUDE],
      ...(listMode
        ? { reporters: ['default'] }
        : {
            globalSetup: ['./test/db-contract/reap-setup.ts'],
            reporters: ['default', './test/db-contract/zero-skip-reporter.ts'],
          }),
      fileParallelism: true,
      maxWorkers: DB_CONTRACT_SUITE_CONCURRENCY,
      maxConcurrency: 1,
      // DB provisioning and migration hooks are network-bound; ordinary test
      // timeouts remain owned by the suites themselves.
      hookTimeout: 180_000,
    },
  }
}

/**
 * Dedicated vitest config for the real-DB `db-contract` tier. Used ONLY by the
 * `db-contract` CI job (`vitest run --config vitest.db-contract.config.ts`); the
 * default `vitest run` (mock unit suites) never picks it up — vitest only
 * auto-loads `vitest.config.*` / `vite.config.*`, not an explicitly-named config —
 * so the mock suites keep their normal file-level parallelism.
 *
 * Two jobs:
 *
 *  1. `globalSetup` runs the reap-before-run self-heal (`reap-setup.ts`) once,
 *     before any branch is created, to clear leaked branches from crashed prior
 *     runs — the fix for `422 BRANCHES_LIMIT_EXCEEDED`.
 *
 *  2. Run at most two isolated suite files at a time. The suite-resource limiter
 *     and worker cap share the same fixed ceiling; tests inside a file remain
 *     sequential. These are Vitest 4 top-level options:
 *       - `fileParallelism: true` — allow independent files to overlap.
 *       - `maxWorkers: 2` — never spawn more than two workers.
 *       - `maxConcurrency: 1` — no `.concurrent` test ever overlaps another.
 *
 *  3. `zero-skip-reporter.ts` is a fail-closed evidence gate. It rejects an empty
 *     or count-mismatched collection, skips/todos/pending/filtered tests,
 *     unclassified assertions, absent exact-head metadata, and incomplete cleanup.
 *
 * The per-suite 180s `describe` timeouts live in the test files and are left
 * untouched — this config sets no test timeout.
 */
export default defineConfig(createDbContractVitestConfig())
