import { describe, expect, it } from 'vitest'

import { checkQuality, type CuratorCandidate } from './quality'

/**
 * Quality-in-isolation: is this candidate well-formed as a standalone memory, judged
 * WITHOUT looking at anything else in the store? SAP's three isolation checks
 * (meaningful name, clear scope, single rule) split so each is individually testable.
 *
 * Every finding must carry a human-readable `reason` that names its evidence — a bare
 * code (or a score) is not something a reviewer can act on.
 */
function candidate(over: Partial<CuratorCandidate> = {}): CuratorCandidate {
  return {
    kind: 'fact',
    title: 'Pricing pages ship through the growth review',
    body: 'The growth lead signs off before a pricing page goes live.',
    topics: [],
    appliesWhen: null,
    scopeType: 'org',
    scopeId: null,
    ...over,
  }
}

const codes = (c: CuratorCandidate) => checkQuality(c).map((f) => f.code)

describe('checkQuality — meaningful name', () => {
  it('passes a well-formed candidate with no findings at all', () => {
    expect(checkQuality(candidate())).toEqual([])
  })

  it('flags a blank title as title_missing', () => {
    expect(codes(candidate({ title: '   ' }))).toEqual(['title_missing'])
  })

  it('flags a placeholder title, naming the placeholder word', () => {
    const findings = checkQuality(candidate({ title: 'Note' }))
    expect(findings.map((f) => f.code)).toEqual(['title_placeholder'])
    expect(findings[0]!.reason).toContain('Note')
  })

  it('flags a one- or two-word title as title_terse, naming the word count', () => {
    const findings = checkQuality(candidate({ title: 'Pricing rules' }))
    expect(findings.map((f) => f.code)).toEqual(['title_terse'])
    expect(findings[0]!.reason).toContain('2 words')
  })

  it('reports EXACTLY ONE title finding — a blank title is not also terse', () => {
    // One bad title producing three findings would read as three problems.
    expect(codes(candidate({ title: '' }))).toEqual(['title_missing'])
    expect(codes(candidate({ title: 'tbd' }))).toEqual(['title_placeholder'])
  })

  it('accepts a three-word title (the threshold is inclusive)', () => {
    expect(codes(candidate({ title: 'Refunds need approval' }))).toEqual([])
  })
})

describe('checkQuality — single assertion', () => {
  it('flags a body carrying several directives, naming how many it found', () => {
    const findings = checkQuality(
      candidate({
        body: 'Deployments must be reviewed. Releases should never happen on a Friday.',
      }),
    )
    expect(findings.map((f) => f.code)).toEqual(['bundled_assertions'])
    expect(findings[0]!.reason).toContain('2')
  })

  it('flags an enumerated body as bundled, naming the list', () => {
    const findings = checkQuality(
      candidate({ body: 'Checks before release:\n- run the smoke suite\n- notify support' }),
    )
    expect(findings.map((f) => f.code)).toEqual(['bundled_assertions'])
    expect(findings[0]!.reason).toContain('2')
  })

  it('does NOT flag a single directive stated in several sentences', () => {
    expect(
      codes(
        candidate({
          body: 'Deployments must be reviewed by a second engineer. This exists because of the March outage.',
        }),
      ),
    ).toEqual([])
  })

  it('does NOT flag a single-item list', () => {
    expect(codes(candidate({ body: 'Before release:\n- run the smoke suite' }))).toEqual([])
  })
})

describe('checkQuality — applicability', () => {
  it('flags a rule that states no applicability', () => {
    const findings = checkQuality(
      candidate({ kind: 'rule', title: 'Use the shared logger', body: 'Prefer the shared logger.' }),
    )
    expect(findings.map((f) => f.code)).toEqual(['applicability_missing'])
    expect(findings[0]!.reason).toContain('rule')
  })

  it('accepts a rule whose applicability is in attrs.applies_when', () => {
    expect(
      codes(
        candidate({
          kind: 'rule',
          title: 'Use the shared logger',
          body: 'Prefer the shared logger.',
          appliesWhen: 'writing a new service',
        }),
      ),
    ).toEqual([])
  })

  it('accepts a rule whose applicability is a conditional in the body', () => {
    expect(
      codes(
        candidate({
          kind: 'rule',
          title: 'Use the shared logger',
          body: 'When adding a new service, prefer the shared logger.',
        }),
      ),
    ).toEqual([])
  })

  it('does NOT demand applicability of a fact or a decision', () => {
    expect(codes(candidate({ kind: 'fact', body: 'The billing cutover finished in March.' }))).toEqual([])
    expect(codes(candidate({ kind: 'decision', body: 'We chose Neon over RDS.' }))).toEqual([])
  })

  it('does not demand applicability when the kind is unknown', () => {
    expect(codes(candidate({ kind: null, body: 'Prefer the shared logger.' }))).toEqual([])
  })
})

describe('checkQuality — reporting shape', () => {
  it('reports several independent findings together', () => {
    expect(
      codes(
        candidate({
          kind: 'rule',
          title: 'Rules',
          body: 'Deployments must be reviewed. Releases should never ship on Friday.',
        }),
      ),
    ).toEqual(['title_placeholder', 'bundled_assertions', 'applicability_missing'])
  })

  it('gives every finding a non-empty human-readable reason (never a bare code)', () => {
    const findings = checkQuality(candidate({ kind: 'rule', title: 'x', body: 'a must. b never.' }))
    expect(findings.length).toBeGreaterThan(0)
    for (const finding of findings) {
      expect(finding.reason.length).toBeGreaterThan(20)
      expect(finding.reason).not.toBe(finding.code)
    }
  })
})
