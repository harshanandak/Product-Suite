import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Tier-2 stamp completeness (Fable's guard against the two most likely escape-hatch
 * mistakes): (a) a statement that stamps SOME of the four provenance columns but not
 * all — e.g. forgets `run_id`; and (b) a whole audited write that stamps NONE — e.g.
 * only one of the two `checks` UPDATEs gets converted.
 *
 * Each tagged INSERT/UPDATE is checked independently. The total catches wholly
 * unstamped writes; exact per-statement column counts catch partial or duplicate
 * stamps. SELECTs and ordinary TypeScript fields are intentionally ignored.
 */
const ROUTES_DIR = fileURLToPath(new URL('../routes', import.meta.url))
const DOMAIN_DIR = fileURLToPath(new URL('../domain', import.meta.url))
const PROVENANCE_COLUMNS = ['actor_type', 'actor_id', 'on_behalf_of', 'run_id'] as const

// Expected number of inline (Tier-2) provenance stamp-groups per file. The single
// write path moved the work-items Tier-2 UPDATE out of the route and into the
// domain command, so the route is now stamp-free (Tier-1 via the commands) and the
// domain module carries the one escape-hatch UPDATE.
const EXPECTED_STAMP_GROUPS: Record<string, number> = {
  'routes/projects.ts': 1, // 1 escape-hatch UPDATE (create is Tier-1 recordWrite)
  'routes/checks.ts': 2, // 2 escape-hatch UPDATEs (patch + toggle); create is Tier-1
  'routes/dependencies.ts': 1, // 1 escape-hatch INSERT (cycle-guard); delete stamps nothing
  'routes/work-items.ts': 0, // thin route — writes go through the domain commands
  'domain/work-items.ts': 1, // 1 escape-hatch UPDATE (create/activity are recordWrite*)
}

function dirFor(relPath: string): string {
  return relPath.startsWith('domain/') ? DOMAIN_DIR : ROUTES_DIR
}

function inlineWriteBodies(src: string): string[] {
  return [...src.matchAll(/\bsql\s*`([\s\S]*?)`/g)]
    .map((match) => match[1] ?? '')
    .filter((body) => /^\s*(?:insert\s+into|update)\b/i.test(body))
}

function columnCount(body: string, column: string): number {
  return (body.match(new RegExp(`\\b${column}\\b`, 'g')) ?? []).length
}

function assertInlineWriteCoverage(src: string, expected: number): void {
  const writes = inlineWriteBodies(src)
  expect(writes).toHaveLength(expected)
  for (const body of writes) {
    const counts = PROVENANCE_COLUMNS.map((column) => columnCount(body, column))
    expect(counts).toEqual([1, 1, 1, 1])
  }
}

describe('statement-level provenance extraction', () => {
  it('ignores provenance column names in SELECTs', () => {
    const source =
      'const rows = sql`select actor_type, actor_id, on_behalf_of, run_id from work_items`'
    expect(inlineWriteBodies(source)).toEqual([])
  })

  it.each([
    ['INSERT', 'const rows = sql`insert into things (actor_type) values (${actor})`'],
    ['UPDATE', 'const rows = sql`update things set actor_type = ${actor}`'],
  ])('rejects a partial %s statement', (_verb, source) => {
    expect(() => assertInlineWriteCoverage(source, 1)).toThrow()
  })
})

describe('Tier-2 provenance stamp completeness', () => {
  for (const [file, expected] of Object.entries(EXPECTED_STAMP_GROUPS)) {
    it(`${file}: every escape-hatch statement stamps all four actor_* columns (${expected}×)`, () => {
      const base = file.slice(file.indexOf('/') + 1)
      const src = readFileSync(`${dirFor(file)}/${base}`, 'utf8')
      assertInlineWriteCoverage(src, expected)
    })
  }
})
