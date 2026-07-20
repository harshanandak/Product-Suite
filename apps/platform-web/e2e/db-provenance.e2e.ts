// Reach the Neon (serverless HTTP) client through the workspace db package, which
// already declares `@neondatabase/serverless` as a dependency. platform-web itself
// does NOT depend on the driver, so we import the package's `createSql` helper by
// relative path rather than adding a new dependency just for this one e2e probe.
import { createSql } from "../../../packages/db/src/index";

/**
 * Persisted-provenance probe for the moat-loop spec.
 *
 * The moat's real claim is durable, not cosmetic: accepting a proposal must leave
 * a permanent `work_items.applied_from_proposal_id` pointer back to the proposal it
 * was applied from — the same linkage the API's idempotent re-drive relies on. The
 * UI banner alone can't prove that, so this reads it straight from Neon.
 *
 * Returns:
 *  - `undefined` when `DATABASE_URL` is unset — the caller SOFT-SKIPS the check so
 *    the spec still runs UI-only (e.g. deployed mode without DB access).
 *  - the created work item's `{ id, title }` when a row is linked to `proposalId`.
 *  - `null` when no work item is linked to `proposalId` (a real provenance failure).
 */
export async function readWorkItemAppliedFrom(
  proposalId: string,
): Promise<{ id: string; title: string } | null | undefined> {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;

  const sql = createSql(url);
  const rows = (await sql`
    select id, title
    from work_items
    where applied_from_proposal_id = ${proposalId}
    limit 1
  `) as { id: string; title: string }[];

  return rows[0] ?? null;
}
