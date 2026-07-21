/**
 * Minimal Neon control-plane client for the real-DB contract tier: create an
 * ephemeral branch (a copy-on-write clone of the parent) with its own compute,
 * wait for the create operations to finish, and delete it in teardown.
 *
 * Only the three calls the harness needs are implemented — this is not a general
 * Neon SDK. Everything is done over the documented v2 REST API
 * (https://neon.com/docs/manage/branches#branching-with-the-neon-api) with the
 * account-scoped `NEON_API_KEY` (distinct from a branch's `DATABASE_URL`).
 *
 * Why a branch and not a container: the accept path talks to Postgres through the
 * `neon-http` serverless driver (`@neondatabase/serverless`); only a real Neon
 * endpoint speaks that protocol, so a plain `postgres` container cannot exercise
 * the exact driver/UUID-cast behavior the wave is hardening.
 */

import { randomBytes } from 'node:crypto'

const API_BASE = process.env.NEON_API_BASE ?? 'https://console.neon.tech/api/v2'

/**
 * Prefix every ephemeral test branch shares. Encoded once so the create path and
 * the reaper agree on exactly which branches are "ours": `createEphemeralBranch`
 * names branches `${TEST_BRANCH_PREFIX}-<ts>-<hex>`, and `reapStaleBranches` only
 * ever deletes branches whose name starts with `${TEST_BRANCH_PREFIX}-`. Production
 * / parent branches (named `main`, `production`, …) can never match, so the reaper
 * is safe by construction.
 */
export const TEST_BRANCH_PREFIX = 'db-contract'

/** How old a leaked test branch must be before the reaper deletes it (default 30 min). */
export const STALE_BRANCH_MAX_AGE_MS = 30 * 60 * 1000

/**
 * Matches EXACTLY the names `createEphemeralBranch` mints — `${TEST_BRANCH_PREFIX}-
 * <epoch-ms>-<8 hex>` (see the `name` template below). The reaper requires this
 * full shape, NOT merely the prefix, so a durable branch a human happens to name
 * with the same prefix (e.g. `db-contract-base` used as a parent) can never match
 * and can never be deleted.
 */
const EPHEMERAL_BRANCH_NAME_RE = new RegExp(`^${TEST_BRANCH_PREFIX}-\\d+-[0-9a-f]{8}$`)

/** True iff `name` is one this harness's `createEphemeralBranch` could have produced. */
export function isEphemeralTestBranchName(name: string | undefined): boolean {
  return typeof name === 'string' && EPHEMERAL_BRANCH_NAME_RE.test(name)
}

/** One create-branch operation the control plane runs asynchronously. */
interface NeonOperation {
  id: string
  action: string
  status: 'scheduling' | 'running' | 'finished' | 'failed' | 'cancelling' | 'cancelled'
}

/** The subset of the create-branch response body the harness reads. */
interface CreateBranchResponse {
  branch: { id: string }
  connection_uris?: { connection_uri: string }[]
  operations?: NeonOperation[]
}

/** The result of provisioning an ephemeral branch: its id + a ready connection string. */
export interface EphemeralBranch {
  branchId: string
  /** A full `postgres://…` URL for the branch's default role + database. */
  connectionUri: string
}

/** Read the required Neon control-plane config from the environment (throws if absent). */
export function neonConfig(): { apiKey: string; projectId: string; parentBranchId?: string } {
  const apiKey = process.env.NEON_API_KEY
  const projectId = process.env.NEON_PROJECT_ID
  if (!apiKey || !projectId) {
    throw new Error(
      'db-contract harness requires NEON_API_KEY and NEON_PROJECT_ID in the environment ' +
        '(the account API key + the target Neon project). These gate the `db-contract` CI job.',
    )
  }
  return { apiKey, projectId, parentBranchId: process.env.NEON_PARENT_BRANCH_ID }
}

async function neonFetch(
  apiKey: string,
  path: string,
  init: { method: string; body?: unknown },
): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: init.method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Neon API ${init.method} ${path} → ${res.status} ${res.statusText}: ${text}`)
  }
  // A 200/201 always carries JSON for these endpoints; DELETE returns the branch body too.
  return res.json().catch(() => ({}))
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Poll each create operation until it reaches a terminal state. A branch's compute
 * (`start_compute`) is provisioned asynchronously, so connecting before the ops
 * finish can race; waiting here makes spin-up deterministic. Throws on a `failed`
 * operation and on timeout so a broken branch surfaces loudly rather than as a
 * confusing connection error downstream.
 */
async function waitForOperations(
  apiKey: string,
  projectId: string,
  operations: NeonOperation[],
  timeoutMs = 120_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (const op of operations) {
    // Trust the terminal state already reported in the create response.
    let status = op.status
    while (status !== 'finished') {
      if (status === 'failed' || status === 'cancelled') {
        throw new Error(`Neon operation ${op.action} (${op.id}) ended as ${status}`)
      }
      if (Date.now() > deadline) {
        throw new Error(`Neon operation ${op.action} (${op.id}) did not finish within ${timeoutMs}ms`)
      }
      await sleep(1_000)
      const body = (await neonFetch(apiKey, `/projects/${projectId}/operations/${op.id}`, {
        method: 'GET',
      })) as { operation?: NeonOperation }
      status = body.operation?.status ?? status
    }
  }
}

/**
 * Create an ephemeral branch WITH a read-write compute and return a ready
 * connection string. Branching copies the parent's roles + passwords, so the
 * returned `connection_uris` entry authenticates without extra setup. Waits for
 * the create/compute operations before returning.
 */
export async function createEphemeralBranch(namePrefix = TEST_BRANCH_PREFIX): Promise<EphemeralBranch> {
  const { apiKey, projectId, parentBranchId } = neonConfig()
  const name = `${namePrefix}-${Date.now()}-${randomBytes(4).toString('hex')}`
  // Safety net for a leaked branch: the workflow uses cancel-in-progress, so a
  // runner can be killed between this POST and the test's `finally` cleanup.
  // Neon auto-deletes the branch at `expires_at`, so a cancelled/crashed run can
  // never leave a branch (and its storage cost) behind indefinitely.
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  const branchInput = parentBranchId
    ? { name, parent_id: parentBranchId, expires_at: expiresAt }
    : { name, expires_at: expiresAt }
  const body = (await neonFetch(apiKey, `/projects/${projectId}/branches`, {
    method: 'POST',
    body: {
      endpoints: [{ type: 'read_write' }],
      branch: branchInput,
    },
  })) as CreateBranchResponse

  const branchId = body.branch?.id
  if (!branchId) {
    throw new Error('Neon create-branch response missing branch.id — the request created no branch.')
  }
  // The branch exists now, but `withDbBranch` has NOT yet entered its try/finally,
  // so anything that throws below (missing compute URI, a failed create/compute
  // operation) would leak the branch. Delete it on failure before rethrowing.
  try {
    const connectionUri = body.connection_uris?.[0]?.connection_uri
    if (!connectionUri) {
      throw new Error(
        'Neon create-branch response missing connection_uris — ensure the request ' +
          'created an endpoint and the parent branch has a role + database.',
      )
    }
    if (body.operations?.length) {
      await waitForOperations(apiKey, projectId, body.operations)
    }
    return { branchId, connectionUri }
  } catch (cause) {
    await deleteEphemeralBranch(branchId)
    throw cause
  }
}

/**
 * Delete a branch (and its compute, roles, databases). Best-effort: called in the
 * harness `finally`, so it must never mask a test failure. On error it logs and
 * resolves rather than throwing — a leaked branch is a cleanup nuisance, not a
 * reason to lose the real assertion error.
 */
export async function deleteEphemeralBranch(branchId: string): Promise<void> {
  try {
    const { apiKey, projectId } = neonConfig()
    await neonFetch(apiKey, `/projects/${projectId}/branches/${branchId}`, { method: 'DELETE' })
  } catch (cause) {
    // eslint-disable-next-line no-console
    console.warn(`db-contract: failed to delete ephemeral Neon branch ${branchId}:`, cause)
  }
}

/** The subset of a list-branches entry the reaper reads. */
interface BranchSummary {
  id: string
  name: string
  /** ISO-8601 creation timestamp (e.g. `2022-12-08T19:55:43Z`). */
  created_at?: string
  /**
   * Present only on branches created with a TTL. Neon forbids `expires_at` on
   * default, parent, and protected branches, so its presence is a strong marker
   * that a branch is a throwaway (exactly what `createEphemeralBranch` sets).
   */
  expires_at?: string
  /** `true` for the project's default/primary branch — must never be reaped. */
  default?: boolean
  /** `true` for a protected branch — must never be reaped. */
  protected?: boolean
}

/** One page of the cursor-paginated list-branches response. */
interface ListBranchesResponse {
  branches?: BranchSummary[]
  pagination?: { cursor?: string }
}

/** How many branches to request per list page (Neon allows 1–10000). */
const LIST_PAGE_LIMIT = 100

/**
 * List EVERY project branch, following Neon's cursor pagination to the last page.
 * The list endpoint is cursor-paginated (`?limit=&cursor=`), so a single fetch can
 * miss stale branches on later pages — and a missed leaked branch is exactly what
 * keeps the account at its cap. Bounded + repeat-cursor-guarded so a malformed
 * cursor can never spin forever.
 */
async function listAllBranches(apiKey: string, projectId: string): Promise<BranchSummary[]> {
  const all: BranchSummary[] = []
  const seenCursors = new Set<string>()
  let cursor: string | undefined

  for (let page = 0; page < 1000; page++) {
    const params = new URLSearchParams({ limit: String(LIST_PAGE_LIMIT) })
    if (cursor) params.set('cursor', cursor)
    const body = (await neonFetch(apiKey, `/projects/${projectId}/branches?${params.toString()}`, {
      method: 'GET',
    })) as ListBranchesResponse
    const pageBranches = body.branches ?? []
    all.push(...pageBranches)

    const next = body.pagination?.cursor
    // Cursor-driven termination (the documented contract): keep paging while the
    // server hands back a next cursor. Stop when it stops giving one, when a page
    // comes back empty, or when a cursor repeats (defensive against a server that
    // echoes the same cursor forever) so a malformed cursor can never loop.
    if (pageBranches.length === 0 || !next || seenCursors.has(next)) break
    seenCursors.add(next)
    cursor = next
  }

  return all
}

/** The outcome of one reap pass, for logging in the global setup. */
export interface ReapResult {
  /** Total branches returned by the list call. */
  scanned: number
  /** Ids of the stale test branches that were deleted. */
  deleted: string[]
  /** Ids that matched + were stale but whose DELETE failed (mid-operation, etc.). */
  failed: string[]
}

/**
 * Decide whether a listed branch is a genuinely-ephemeral, reapable test branch.
 * The predicate is deliberately CONSERVATIVE — every clause can only ever EXCLUDE a
 * branch from deletion — so a durable branch can never be reaped even if several
 * signals go wrong at once. A branch is reapable ONLY when ALL hold:
 *
 *   1. It is NOT the configured parent branch (`NEON_PARENT_BRANCH_ID`) that every
 *      ephemeral test branch is cloned from — deleting it would break all future
 *      runs. Checked first, and by id, so it holds regardless of the branch's name.
 *   2. It is NOT the project's default/primary branch and NOT protected — Neon
 *      never lets these expire, and we never delete them whatever they are named.
 *   3. Its name matches the EXACT pattern `createEphemeralBranch` mints (prefix +
 *      epoch-ms + 8 hex), not merely the shared prefix — so a human-named
 *      same-prefix branch (e.g. `db-contract-base`) is left intact.
 *   4. It carries an `expires_at` TTL marker — the ownership signal every branch
 *      this harness creates sets, and one Neon forbids on default/parent/protected
 *      branches. A stale same-prefix branch WITHOUT this marker is never deleted.
 *   5. It has a parseable `created_at` older than `cutoff`. An unparseable
 *      timestamp is treated as NOT stale (fail-safe), and a branch a sibling CI job
 *      just created is younger than the cutoff and so is left alone.
 */
function isReapableBranch(
  branch: BranchSummary,
  parentBranchId: string | undefined,
  cutoff: number,
): boolean {
  if (parentBranchId && branch.id === parentBranchId) return false
  if (branch.default === true || branch.protected === true) return false
  if (!isEphemeralTestBranchName(branch.name)) return false
  if (!branch.expires_at) return false
  const createdMs = branch.created_at ? Date.parse(branch.created_at) : NaN
  return Number.isFinite(createdMs) && createdMs <= cutoff
}

/**
 * Reap-before-run self-heal for the `BRANCHES_LIMIT_EXCEEDED` failure mode: a
 * cancelled/crashed CI run (the workflow uses `cancel-in-progress: true`) can be
 * killed between the create POST and the harness `finally`, leaking an ephemeral
 * branch that Neon only auto-deletes at its `expires_at` (up to an hour later).
 * Enough of those accumulate to hit the plan's branch cap, and then EVERY new run
 * fails at branch creation before any test logic runs.
 *
 * Run once at global setup, this pages through ALL project branches and deletes
 * only those `isReapableBranch` accepts — i.e. genuinely-ephemeral, aged-out test
 * branches, NEVER the configured parent branch, the default/primary branch, a
 * protected branch, or any branch lacking the exact ephemeral name + `expires_at`
 * ownership marker. Best-effort throughout: a failed list or a failed individual
 * delete is logged and swallowed, never thrown — the reaper must not turn a
 * cleanup hiccup into a suite failure.
 */
export async function reapStaleBranches(
  maxAgeMs: number = STALE_BRANCH_MAX_AGE_MS,
): Promise<ReapResult> {
  const result: ReapResult = { scanned: 0, deleted: [], failed: [] }
  const { apiKey, projectId, parentBranchId } = neonConfig()

  let branches: BranchSummary[]
  try {
    branches = await listAllBranches(apiKey, projectId)
  } catch (cause) {
    // eslint-disable-next-line no-console
    console.warn('db-contract reap: failed to list branches (skipping reap):', cause)
    return result
  }

  result.scanned = branches.length
  const cutoff = Date.now() - maxAgeMs

  for (const branch of branches) {
    if (!isReapableBranch(branch, parentBranchId, cutoff)) continue

    try {
      await neonFetch(apiKey, `/projects/${projectId}/branches/${branch.id}`, { method: 'DELETE' })
      result.deleted.push(branch.id)
    } catch (cause) {
      result.failed.push(branch.id)
      // eslint-disable-next-line no-console
      console.warn(`db-contract reap: failed to delete stale branch ${branch.id}:`, cause)
    }
  }

  return result
}
