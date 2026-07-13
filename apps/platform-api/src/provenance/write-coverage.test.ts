import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Provenance coverage tripwire (design §3.4). Until the fast-follow lands
 * `SET NOT NULL` on `actor_id` (which makes a forgotten stamp fail at the DB),
 * this crude source scan catches the one real failure mode: a route that writes
 * to an audited table WITHOUT stamping provenance — either through `recordWrite*`
 * (Tier 1) or inline via `actorAssignments` (Tier 2).
 *
 * `PENDING_CONVERSION` lists routes whose writes are not yet on the provenance
 * path; it MUST shrink to empty as the fast-follow (PR-B2) converts them, at which
 * point any new unstamped write to an audited table fails this test.
 */
const ROUTES_DIR = fileURLToPath(new URL('../routes', import.meta.url))

const AUDITED_TABLES = [
  'work_items',
  'checks',
  'work_item_dependencies',
  'projects',
  'teams',
  'statuses',
  'activity_events',
]

// Empty: every route that writes to an audited table now stamps provenance
// (Tier-1 recordWrite or Tier-2 actorAssignments). A NEW unstamped write fails here.
const PENDING_CONVERSION = new Set<string>([])

const writeRe = new RegExp(
  `insert\\s+into\\s+"?(?:${AUDITED_TABLES.join('|')})"?|update\\s+"?(?:${AUDITED_TABLES.join('|')})"?\\s+set`,
  'i',
)

describe('provenance write coverage (tripwire)', () => {
  const routeFiles = readdirSync(ROUTES_DIR).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
  )

  for (const file of routeFiles) {
    const src = readFileSync(`${ROUTES_DIR}/${file}`, 'utf8')
    if (!writeRe.test(src)) continue

    it(`${file}: writes to an audited table must go through the provenance path`, () => {
      const stampsProvenance = src.includes('provenance/record-write')
      // Either it stamps (imports recordWrite*/actorAssignments), or it is an
      // explicitly-tracked not-yet-converted route. New routes get neither → fail.
      expect(stampsProvenance || PENDING_CONVERSION.has(file)).toBe(true)
    })
  }
})
