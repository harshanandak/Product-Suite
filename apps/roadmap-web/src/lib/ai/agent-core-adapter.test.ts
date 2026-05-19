import { beforeEach, describe, expect, test, vi } from 'vitest'
import { executeTaskPlan as executeAgentCoreTaskPlan } from '@product-suite/agent-core'
import { executeTaskPlanWithAgentCore } from './agent-core-adapter'
import type { TaskPlan } from './task-planner'

const mockedExecuteAgentCoreTaskPlan = executeAgentCoreTaskPlan as unknown as {
  mockClear: () => void
}

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
    mockedExecuteAgentCoreTaskPlan.mockClear()
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

  test('executes confirmed tool actions when a Roadmap tool requests confirmation', async () => {
    const executeConfirmed = vi.fn(async () => ({ id: 'confirmed-1' }))
    const execute = vi.fn(async () => ({
      needsConfirmation: true,
      executeConfirmed,
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
    expect(execute).toHaveBeenCalledTimes(1)
    expect(executeConfirmed).toHaveBeenCalledTimes(1)
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'step-1', status: 'completed' }),
      expect.objectContaining({ id: 'plan-1', status: 'completed' }),
      'Completed: Create a record',
    )
    expect(result.success).toBe(true)
    expect(result.results).toEqual({ 'step-1': { id: 'confirmed-1' } })
    expect(result.plan.goal).toBe('Create a record')
    expect(result.plan.status).toBe('completed')
  })

  test('does not execute confirmation callbacks when the tool result is not a confirmation request', async () => {
    const executeConfirmed = vi.fn(async () => ({ id: 'should-not-run' }))
    const execute = vi.fn(async () => ({
      needsConfirmation: false,
      data: { id: 'plain-data' },
      executeConfirmed,
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
    expect(execute).toHaveBeenCalledTimes(1)
    expect(executeConfirmed).not.toHaveBeenCalled()
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'step-1', status: 'completed' }),
      expect.objectContaining({ id: 'plan-1', status: 'completed' }),
      'Completed: Create a record',
    )
    expect(result.success).toBe(true)
    expect(result.results).toEqual({ 'step-1': { id: 'plain-data' } })
    expect(result.plan.goal).toBe('Create a record')
    expect(result.plan.status).toBe('completed')
  })
})
