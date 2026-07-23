/**
 * Domain-layer errors for the single validated write path. A `DomainError`
 * carries a machine `code` (an invariant the command enforces); the HTTP edge
 * (routes) maps the code to a status via `domainErrorStatus`, and the
 * exactly-once apply path (proposals) maps it to a `stale`/`invalid` reason.
 *
 * The message is human-facing (surfaced verbatim as `{ error: message }`), so it
 * MUST stay identical to what the routes returned before extraction — the
 * behavior is only relocated, not changed.
 */
export type DomainErrorCode =
  | 'unknown_team'
  // A create OMITTED `team_id` and the caller's tenant has NO team to default
  // into — nothing to create against. A clear 4xx (create a team first), not the
  // generic "team_id is required".
  | 'no_team'
  // A create OMITTED `team_id` but the caller's tenant has MULTIPLE teams, so the
  // target is ambiguous. Refuse with a clear 4xx naming the fix (specify team_id)
  // instead of silently guessing which team the item belongs to.
  | 'team_required_multiple'
  | 'unknown_status'
  // A create omitted `status_id` and its team has NO statuses to derive a default
  // from — the item cannot be placed in a workflow state. A clear 4xx (not the
  // generic "status_id is required") so the caller knows to add a status first.
  | 'no_default_status'
  | 'unknown_project'
  | 'unknown_parent'
  | 'parent_different_team'
  | 'max_depth'
  | 'self_parent'
  | 'parent_has_children'
  | 'cannot_change_team_in_hierarchy'
  | 'cycle'
  | 'stale'
  | 'not_found'
  // Memory Brain P1: superseding requires a change_reason (append-only history);
  // `conflict` = the target was concurrently superseded/retracted (no longer active).
  | 'change_reason_required'
  | 'conflict'
  // A compare-and-set write (`updateWorkItem`'s `expectedValues` fence) matched no
  // row because the row no longer holds the values the caller validated against.
  // NOTHING was written — the caller must re-read and re-decide. Distinct from
  // `not_found` (the row is there) and from `conflict` (a memory lifecycle race).
  | 'guard_failed'
  | 'invalid_input'

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}

/** The HTTP status a route should return for a given domain-invariant violation. */
export function domainErrorStatus(code: DomainErrorCode): 400 | 404 | 409 {
  if (code === 'not_found') return 404
  // A lost supersede/retract race (target no longer active) is a concurrency conflict,
  // as is a lost compare-and-set fence — both mean "someone else moved it", not "you
  // sent a bad request", so neither belongs in the 400 bucket.
  if (code === 'conflict' || code === 'guard_failed') return 409
  return 400
}
