import { beforeEach, describe, expect, test, vi } from 'vitest'
import { executeTaskPlanWithAgentCore } from './agent-core-adapter'
import { executeTaskPlan, type ExecutionOptions } from './agent-loop'
import type { TaskPlan } from './task-planner'

const mockedExecuteTaskPlanWithAgentCore = executeTaskPlanWithAgentCore as unknown as {
  mockClear: () => void
}

vi.mock('./agent-core-adapter', () => ({
  executeTaskPlanWithAgentCore: vi.fn(async () => ({
    success: true,
    completedSteps: 1,
    totalSteps: 1,
    results: { 'step-1': { ok: true } },
    errors: [],
    executionTime: 5,
    plan: createPlan(),
  })),
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

describe('agent-loop compatibility wrapper', () => {
  beforeEach(() => {
    mockedExecuteTaskPlanWithAgentCore.mockClear()
  })

  test('preserves executeTaskPlan options while delegating to agent-core adapter', async () => {
    const plan = createPlan()
    const options: ExecutionOptions = {
      onProgress: vi.fn(),
      cancelSignal: { cancelled: false },
      maxExecutionTime: 1000,
      stepDelay: 0,
    }

    const result = await executeTaskPlan(plan, options)

    expect(executeTaskPlanWithAgentCore).toHaveBeenCalledWith(plan, options)
    expect(result.success).toBe(true)
    expect(result.results).toEqual({ 'step-1': { ok: true } })
  })
})
