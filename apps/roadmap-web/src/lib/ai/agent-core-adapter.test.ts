import { beforeEach, describe, expect, test, vi } from 'vitest'
import { executeTaskPlan as executeAgentCoreTaskPlan } from '@product-suite/agent-core'
import { executeTaskPlanWithAgentCore } from './agent-core-adapter'
import type { TaskPlan } from './task-planner'

vi.mock('@product-suite/agent-core', () => ({
  executeTaskPlan: vi.fn(async (plan, options) => {
    const firstStep = plan.steps[0]
    const result = await options.executeTool({
      step: firstStep,
      plan,
      abortSignal: new AbortController().signal,
    })

    options.onProgress?.({
      step: { ...firstStep, status: 'completed', result },
      plan: {
        ...plan,
        status: 'completed',
        steps: [{ ...firstStep, status: 'completed', result }],
      },
      message: `Completed: ${firstStep.description}`,
    })

    return {
      success: true,
      completedSteps: 1,
      totalSteps: 1,
      results: { [firstStep.id]: result },
      errors: [],
      executionTime: 7,
      plan: {
        ...plan,
        status: 'completed',
        steps: [{ ...firstStep, status: 'completed', result }],
      },
    }
  }),
}))

function createPlan(): TaskPlan {
  return {
    id: 'plan-1',
    goal: 'Create a record',
    estimatedDuration: 'fast',
    requiresApproval: true,
    createdAt: 123,
    status: 'approved',
    steps: [
      {
        id: 'step-1',
        order: 1,
        description: 'Create a record',
        toolName: 'createRecord',
        params: { title: 'First' },
        dependsOn: [],
        status: 'pending',
      },
    ],
  }
}

describe('agent-core adapter', () => {
  beforeEach(() => {
    vi.mocked(executeAgentCoreTaskPlan).mockClear()
  })

  test('delegates ordered execution to agent-core while resolving tools through a registry', async () => {
    const execute = vi.fn(async (params: Record<string, unknown>) => ({
      id: 'created-1',
      params,
    }))
    const registry = {
      get: vi.fn(() => ({ execute })),
    }
    const progress = vi.fn()

    const result = await executeTaskPlanWithAgentCore(
      createPlan(),
      { onProgress: progress, stepDelay: 0 },
      registry,
    )

    expect(executeAgentCoreTaskPlan).toHaveBeenCalledTimes(1)
    expect(registry.get).toHaveBeenCalledWith('createRecord')
    expect(execute).toHaveBeenCalledWith(
      { title: 'First' },
      expect.objectContaining({
        toolCallId: expect.stringMatching(/^agent_/),
        abortSignal: expect.any(AbortSignal),
      }),
    )
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'step-1', status: 'completed' }),
      expect.objectContaining({ id: 'plan-1', status: 'completed' }),
      'Completed: Create a record',
    )
    expect(result.success).toBe(true)
    expect(result.results).toEqual({
      'step-1': { id: 'created-1', params: { title: 'First' } },
    })
    expect(result.plan.goal).toBe('Create a record')
    expect(result.plan.status).toBe('completed')
  })
})
