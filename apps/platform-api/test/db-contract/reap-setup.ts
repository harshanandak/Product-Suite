/**
 * Vitest `globalSetup` for the `db-contract` tier: reap-before-run self-heal.
 *
 * Runs ONCE in the vitest main process before any test file, with the same
 * `NEON_API_KEY` / `NEON_PROJECT_ID` the CI job scopes to the run step. It deletes
 * ephemeral test branches leaked by prior/crashed runs (see `reapStaleBranches`),
 * clearing the backlog that causes `422 BRANCHES_LIMIT_EXCEEDED` at branch
 * creation. This is what lets THIS run's own branch-creates succeed — the reap
 * happens before the first test asks Neon for a branch.
 *
 * Without creds it no-ops (the suite self-skips via `describe.skipIf`), so a fork
 * PR that can't read secrets still runs this setup harmlessly.
 */

import { reapStaleBranches } from './neon-branch'

export default async function setup(): Promise<void> {
  if (!process.env.NEON_API_KEY || !process.env.NEON_PROJECT_ID) {
    // No creds → the suite self-skips; nothing to reap.
    return
  }

  try {
    const { scanned, deleted, failed } = await reapStaleBranches()
    // eslint-disable-next-line no-console
    console.log(
      `db-contract reap-before-run: scanned ${scanned} branch(es), ` +
        `deleted ${deleted.length} stale, ${failed.length} delete(s) failed.`,
    )
  } catch (cause) {
    // Belt-and-suspenders: reapStaleBranches is already best-effort, but never let a
    // reap problem block the run — the per-test create still surfaces a real limit
    // error if the backlog genuinely can't be cleared.
    // eslint-disable-next-line no-console
    console.warn('db-contract reap-before-run: reap failed (continuing):', cause)
  }
}
