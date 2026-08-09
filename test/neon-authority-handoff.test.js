import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = join(import.meta.dir, '..')
const read = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8')

describe('canonical Neon authority handoff', () => {
  test('publishes one current Neon/public topology and Drizzle migration plane', () => {
    const ownership = read('docs/architecture/schema-domain-ownership.md')
    const readme = read('README.md')
    const design = read('DESIGN.md')
    const index = read('docs/INDEX.md')

    for (const document of [ownership, readme, design, index]) {
      expect(document).toContain('Neon')
      expect(document).toContain('neondb')
      expect(document).toContain('public')
      expect(document).toContain('packages/db/migrations')
    }
    expect(ownership).toContain('historical_non_authoritative')
    expect(readme).toContain('Neon is the sole live Postgres authority')
    expect(design).toContain('single Neon/public topology')
  })

  test('records the exact PR A 0020 contract for both history variants', () => {
    const decision = read('docs/work/2026-08-09-neon-db-authority/decisions.md')
    const plan = read('docs/work/2026-08-09-neon-db-authority/plan.md')
    const tasks = read('docs/work/2026-08-09-neon-db-authority/tasks.md')
    const handoff = `${decision}\n${plan}\n${tasks}`

    for (const field of [
      'original-production',
      'repaired-bootstrap',
      '0020_meeting_authority_foundation.sql',
      'bun run migrate:database -- apply --history-variant <variant> --expected-pending <ordered-tags>',
      'bun run migrate:database -- verify --history-variant <variant> --expected-floor <tag>',
      '0019_neon_authority_reconciliation',
      'NOLOGIN',
      'catalog',
      'grant',
    ]) {
      expect(handoff).toContain(field)
    }
    expect(handoff).toMatch(/PR A[^\n]*0020|0020[^\n]*PR A/i)
    expect(handoff).toMatch(/does not (modify|touch) (the )?repair/i)
  })

  test('does not create a second manifest/journal authority or claim a real proof without evidence', () => {
    const docs = [
      read('docs/architecture/schema-domain-ownership.md'),
      read('README.md'),
      read('DESIGN.md'),
      read('docs/INDEX.md'),
      read('docs/work/2026-08-09-neon-db-authority/decisions.md'),
    ].join('\n').replace(/\s+/g, ' ')
    expect(docs).toMatch(/manifest[^\n]*(validation|provenance)[^\n]*(not|never)\s+(a )?second/i)
    expect(docs).toMatch(/real[- ]Neon[^\n]*(INCOMPLETE|unavailable|credentials)/i)
  })

  test('keeps the canonical index path explicit', () => {
    expect(existsSync(join(repoRoot, 'docs/INDEX.md'))).toBe(true)
  })
})
