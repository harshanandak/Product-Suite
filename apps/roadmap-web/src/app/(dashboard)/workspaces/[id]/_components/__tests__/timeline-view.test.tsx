import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(currentDir, '../timeline-view.tsx'), 'utf8')

describe('TimelineView shared planning integration', () => {
  test('normalizes timeline phases through the shared planning package', () => {
    expect(source).toContain('@product-suite/ui-planning')
    expect(source).toContain('normalizeTimelinePhase(item.timeline_phase)')
  })
})
