import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Tier-2 stamp completeness (Fable's guard against the two most likely escape-hatch
 * mistakes): (a) a statement that stamps SOME of the four provenance columns but not
 * all — e.g. forgets `run_id`; and (b) a whole audited write that stamps NONE — e.g.
 * only one of the two `checks` UPDATEs gets converted.
 *
 * The four columns are always stamped as a group. So per route file, each column must
 * appear the SAME number of times (catches partial stamps → counts diverge) AND that
 * number must equal the file's known count of Tier-2 escape-hatch write statements
 * (catches a whole unstamped statement → count falls short). Tier-1 routes stamp via
 * recordWrite (no inline `actor_*` in the route source), so their expected count is 0.
 *
 * `//` comment lines are stripped so prose like "stamps all four actor_* columns"
 * never counts. Update this map when a route gains/loses an escape-hatch statement.
 */
const ROUTES_DIR = fileURLToPath(new URL('../routes', import.meta.url))
const PROVENANCE_COLUMNS = ['actor_type', 'actor_id', 'on_behalf_of', 'run_id'] as const

// Expected number of inline (Tier-2) provenance stamp-groups per route file.
const EXPECTED_STAMP_GROUPS: Record<string, number> = {
  'projects.ts': 1, // 1 escape-hatch UPDATE (create is Tier-1 recordWrite)
  'checks.ts': 2, // 2 escape-hatch UPDATEs (patch + toggle); create is Tier-1
  'dependencies.ts': 1, // 1 escape-hatch INSERT (cycle-guard); delete stamps nothing
  'work-items.ts': 1, // 1 escape-hatch UPDATE (create/activity are recordWrite*)
}

function countColumn(src: string, col: string): number {
  const code = src
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
  return (code.match(new RegExp(`\\b${col}\\b`, 'g')) ?? []).length
}

describe('Tier-2 provenance stamp completeness', () => {
  for (const [file, expected] of Object.entries(EXPECTED_STAMP_GROUPS)) {
    it(`${file}: every escape-hatch statement stamps all four actor_* columns (${expected}×)`, () => {
      const src = readFileSync(`${ROUTES_DIR}/${file}`, 'utf8')
      const counts = PROVENANCE_COLUMNS.map((col) => countColumn(src, col))
      // All four counts equal each other → no partial stamp.
      expect(new Set(counts).size).toBe(1)
      // …and equal the known number of stamp-groups → no whole statement unstamped.
      expect(counts[0]).toBe(expected)
    })
  }
})
