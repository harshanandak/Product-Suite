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
  | 'unknown_status'
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
  // A lost supersede/retract race (target no longer active) is a concurrency conflict.
  if (code === 'conflict') return 409
  return 400
}
