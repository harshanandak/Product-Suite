import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const routeDir = dirname(fileURLToPath(import.meta.url))
const routeSource = readFileSync(join(routeDir, 'route.ts'), 'utf8')

describe('plan approval route agent-core integration', () => {
  test('keeps route concerns local while delegating plan execution through agent-core adapter', () => {
    expect(routeSource).toContain(
      "import { executeTaskPlanWithAgentCore as executeTaskPlan } from '@/lib/ai/agent-core-adapter'"
    )
    expect(routeSource).toContain(
      "import { createCancelSignal, type CancelSignal } from '@/lib/ai/agent-loop'"
    )
    expect(routeSource).not.toContain(
      "import { executeTaskPlan, createCancelSignal, type CancelSignal } from '@/lib/ai/agent-loop'"
    )
    expect(routeSource).not.toContain("@product-suite/agent-core")
  })

  test('preserves the route-owned SSE response contract', () => {
    expect(routeSource).toContain("sendEvent('plan-approved'")
    expect(routeSource).toContain("sendEvent('execution-started'")
    expect(routeSource).toContain("sendEvent('step-progress'")
    expect(routeSource).toContain("sendEvent('execution-complete'")
    expect(routeSource).toContain("'Content-Type': 'text/event-stream'")
    expect(routeSource).toContain("'X-Plan-Id': planId")
  })
})
