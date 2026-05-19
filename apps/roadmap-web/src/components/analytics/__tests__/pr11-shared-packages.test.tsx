import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import roadmapPackageJson from '../../../../package.json'
import { MetricCard } from '../metric-card'

const currentDir = dirname(fileURLToPath(import.meta.url))
const timelineViewSource = readFileSync(
  resolve(currentDir, '../../../app/(dashboard)/workspaces/[id]/_components/timeline-view.tsx'),
  'utf8',
)
const metricCardSource = readFileSync(resolve(currentDir, '../metric-card.tsx'), 'utf8')

describe('PR11 shared planning and charting package integration', () => {
  test('roadmap declares the shared planning and charting packages', () => {
    expect(roadmapPackageJson.dependencies['@product-suite/ui-planning']).toBe('workspace:*')
    expect(roadmapPackageJson.dependencies['@product-suite/ui-charting']).toBe('workspace:*')
  })

  test('roadmap wrappers consume package exports without moving shell data ownership', () => {
    expect(timelineViewSource).toContain('@product-suite/ui-planning')
    expect(timelineViewSource).toContain('normalizeTimelinePhase')
    expect(metricCardSource).toContain('@product-suite/ui-charting')
    expect(metricCardSource).toContain('formatTrendValue')
  })

  test('metric card still renders through the roadmap wrapper', () => {
    const html = renderToStaticMarkup(
      <MetricCard
        title="Planning throughput"
        value={12}
        description="Completed items"
        trend={{ value: 4, direction: 'up' }}
      />,
    )

    expect(html).toContain('Planning throughput')
    expect(html).toContain('Completed items')
    expect(html).toContain('+4%')
  })
})
