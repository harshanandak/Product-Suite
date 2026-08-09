import { defineConfig } from 'vitest/config'

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
 *  2. Bound concurrency so at most ONE ephemeral Neon branch exists at a time
 *     (comfortably under the plan's branch cap). Each test already provisions +
 *     tears down its own branch serially within a file; the settings below stop
 *     the two test files from running in parallel workers (which would otherwise
 *     hold two branches at once). These are the Vitest 4 top-level options that
 *     replaced the removed `poolOptions`:
 *       - `fileParallelism: false` — run test files one at a time.
 *       - `maxWorkers: 1` — never spawn more than one worker.
 *       - `maxConcurrency: 1` — no `.concurrent` test ever overlaps another.
 *
 *  3. `zero-skip-reporter.ts` is a fail-closed evidence gate. It rejects an empty
 *     or count-mismatched collection, skips/todos/pending/filtered tests,
 *     unclassified assertions, absent exact-head metadata, and incomplete cleanup.
 *
 * The per-suite 180s `describe` timeouts live in the test files and are left
 * untouched — this config sets no test timeout.
 */
export default defineConfig({
  test: {
    // Keep the evidence lane explicit: A1's topology/reporter unit tests are
    // local checks and must not inflate the locked 57-test real inventory.
    include: [
      'test/db-contract/accept-path.test.ts',
      'test/db-contract/baseline.test.ts',
      'test/db-contract/collaboration.test.ts',
      'test/db-contract/meeting-ingest.test.ts',
      'test/db-contract/memory-curator.test.ts',
      'test/db-contract/memory-tier.test.ts',
      'test/db-contract/neon-authority.test.ts',
      'test/db-contract/reap.test.ts',
      'test/db-contract/role-privileges.test.ts',
    ],
    globalSetup: ['./test/db-contract/reap-setup.ts'],
    reporters: ['default', './test/db-contract/zero-skip-reporter.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    maxConcurrency: 1,
  },
})
