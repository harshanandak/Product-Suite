import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { MetricCard } from './metric-card'

const currentDir = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(currentDir, 'metric-card.tsx'), 'utf8')

describe('MetricCard shared charting integration', () => {
  test('delegates trend formatting to the shared charting package', () => {
    expect(source).toContain('@product-suite/ui-charting')
    expect(source).toContain('formatTrendValue(trend)')

    const html = renderToStaticMarkup(
      <MetricCard title="Completed" value={12} trend={{ value: 4, direction: 'up' }} />,
    )

    expect(html).toContain('+4%')
  })
})
