import {
  executeTaskPlan as executeAgentCoreTaskPlan,
  type AgentCoreTaskPlan,
  type AgentCoreTaskStep,
} from '@product-suite/agent-core'
import { toolRegistry } from './tools/tool-registry'
import type { TaskPlan, TaskStep } from './task-planner'

export interface RoadmapExecutionResult {
  success: boolean
  completedSteps: number
  totalSteps: number
  results: Record<string, unknown>
  errors: string[]
  executionTime: number
  plan: TaskPlan
}

export type RoadmapProgressCallback = (
  step: TaskStep,
  plan: TaskPlan,
  message: string
) => void

export interface RoadmapCancelSignal {
  cancelled: boolean
}

export interface RoadmapExecutionOptions {
  onProgress?: RoadmapProgressCallback
  cancelSignal?: RoadmapCancelSignal
  maxExecutionTime?: number
  stepDelay?: number
}

interface ExecutableTool {
  execute: (
    params: Record<string, unknown>,
    context: { toolCallId: string; abortSignal: AbortSignal }
  ) => Promise<unknown>
}

interface ToolRegistryLike {
  get(name: string): ExecutableTool | undefined
}

export async function executeTaskPlanWithAgentCore(
  plan: TaskPlan,
  options: RoadmapExecutionOptions = {},
  registry: ToolRegistryLike = toolRegistry as ToolRegistryLike
): Promise<RoadmapExecutionResult> {
  const corePlan = toAgentCorePlan(plan)

  const coreResult = await executeAgentCoreTaskPlan(corePlan, {
    executeTool: ({ step, abortSignal }) =>
      executeRegistryTool(registry, step.toolName, step.params, abortSignal),
    onProgress: event => {
      options.onProgress?.(
        toRoadmapStep(event.step, plan),
        toRoadmapPlan(event.plan, plan),
        event.message
      )
    },
    cancelSignal: options.cancelSignal,
    maxExecutionTimeMs: options.maxExecutionTime,
    stepDelayMs: options.stepDelay,
    retryLimit: 1,
  })

  return {
    success: coreResult.success,
    completedSteps: coreResult.completedSteps,
    totalSteps: coreResult.totalSteps,
    results: coreResult.results,
    errors: coreResult.errors,
    executionTime: coreResult.executionTime,
    plan: toRoadmapPlan(coreResult.plan, plan),
  }
}

async function executeRegistryTool(
  registry: ToolRegistryLike,
  toolName: string,
  params: Record<string, unknown>,
  abortSignal: AbortSignal
): Promise<unknown> {
  const tool = registry.get(toolName)
  if (!tool || typeof tool.execute !== 'function') {
    throw new Error(`Tool not found: ${toolName}`)
  }

  const result = await tool.execute(params, {
    toolCallId: `agent_${Date.now()}`,
    abortSignal,
  })

  if (result && typeof result === 'object' && 'needsConfirmation' in result) {
    const confirmationResult = result as {
      needsConfirmation: boolean
      data?: unknown
      executeConfirmed?: () => Promise<unknown>
    }

    if (confirmationResult.needsConfirmation && confirmationResult.executeConfirmed) {
      return confirmationResult.executeConfirmed()
    }

    return confirmationResult.data ?? result
  }

  return result
}

function toAgentCorePlan(plan: TaskPlan): AgentCoreTaskPlan {
  return {
    id: plan.id,
    status:
      plan.status === 'executing' ||
      plan.status === 'completed' ||
      plan.status === 'failed' ||
      plan.status === 'cancelled'
        ? plan.status
        : 'pending',
    steps: plan.steps.map(toAgentCoreStep),
  }
}

function toAgentCoreStep(step: TaskStep): AgentCoreTaskStep {
  return {
    id: step.id,
    order: step.order,
    description: step.description,
    toolName: step.toolName,
    params: step.params,
    dependsOn: step.dependsOn,
    status: step.status,
    result: step.result,
    error: step.error,
  }
}

function toRoadmapPlan(corePlan: AgentCoreTaskPlan, originalPlan: TaskPlan): TaskPlan {
  return {
    ...originalPlan,
    status:
      corePlan.status === 'pending'
        ? originalPlan.status
        : corePlan.status,
    steps: corePlan.steps.map(step => toRoadmapStep(step, originalPlan)),
    summary: corePlan.summary ?? originalPlan.summary,
  }
}

function toRoadmapStep(coreStep: AgentCoreTaskStep, originalPlan: TaskPlan): TaskStep {
  const originalStep = originalPlan.steps.find(step => step.id === coreStep.id)

  return {
    ...originalStep,
    id: coreStep.id,
    order: coreStep.order,
    description: coreStep.description,
    toolName: coreStep.toolName,
    params: coreStep.params,
    dependsOn: coreStep.dependsOn ?? originalStep?.dependsOn ?? [],
    status: coreStep.status,
    result: coreStep.result,
    error: coreStep.error,
  }
}
