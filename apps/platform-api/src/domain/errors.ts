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
  | 'not_found'

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
export function domainErrorStatus(code: DomainErrorCode): 400 | 404 {
  return code === 'not_found' ? 404 : 400
}
