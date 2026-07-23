import { describe, expect, it } from 'vitest'

import { DomainError, domainErrorStatus } from './errors'

describe('DomainError', () => {
  it('carries a machine code alongside the human message', () => {
    const err = new DomainError('unknown_team', 'Unknown team')
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe('unknown_team')
    expect(err.message).toBe('Unknown team')
    expect(err.name).toBe('DomainError')
  })
})

describe('domainErrorStatus', () => {
  it('maps not_found to 404 and every other invariant to 400', () => {
    expect(domainErrorStatus('not_found')).toBe(404)
    expect(domainErrorStatus('unknown_team')).toBe(400)
    expect(domainErrorStatus('cycle')).toBe(400)
    expect(domainErrorStatus('self_parent')).toBe(400)
  })

  it('maps the concurrency codes to 409 — a lost fence is a conflict, not a bad request', () => {
    expect(domainErrorStatus('conflict')).toBe(409)
    // `guard_failed`: a compare-and-set update matched no row because the row moved
    // under the caller. Nothing was written; the caller should re-read and retry.
    expect(domainErrorStatus('guard_failed')).toBe(409)
  })
})
