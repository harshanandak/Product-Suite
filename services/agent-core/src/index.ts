export type AgentCorePlanStatus =
  | "pending"
  | "executing"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentCoreStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export interface AgentCoreTaskStep {
  id: string;
  order: number;
  description: string;
  toolName: string;
  params: Record<string, unknown>;
  status: AgentCoreStepStatus;
  result?: unknown;
  error?: string;
  dependsOn?: string[];
}

export interface AgentCoreTaskPlan {
  id: string;
  status: AgentCorePlanStatus;
  steps: AgentCoreTaskStep[];
  summary?: string;
}

export interface AgentCoreExecutionResult {
  success: boolean;
  completedSteps: number;
  totalSteps: number;
  results: Record<string, unknown>;
  errors: string[];
  executionTime: number;
  plan: AgentCoreTaskPlan;
}

export interface AgentCoreToolContext {
  step: AgentCoreTaskStep;
  plan: AgentCoreTaskPlan;
  abortSignal: AbortSignal;
}

export interface AgentCoreProgressEvent {
  step: AgentCoreTaskStep;
  plan: AgentCoreTaskPlan;
  message: string;
}

export interface AgentCoreCancelSignal {
  cancelled: boolean;
}

export interface AgentCoreExecutionOptions {
  executeTool: (context: AgentCoreToolContext) => Promise<unknown>;
  onProgress?: (event: AgentCoreProgressEvent) => void;
  isCancelled?: () => boolean;
  cancelSignal?: AgentCoreCancelSignal;
  maxExecutionTimeMs?: number;
  stepDelayMs?: number;
  retryLimit?: number;
}

const DEFAULT_MAX_EXECUTION_TIME_MS = 5 * 60 * 1000;
const DEFAULT_STEP_DELAY_MS = 500;
const DEFAULT_RETRY_LIMIT = 1;

export function createCancelSignal(): AgentCoreCancelSignal {
  return { cancelled: false };
}

export function cancelExecution(signal: AgentCoreCancelSignal): void {
  signal.cancelled = true;
}

export async function executeTaskPlan(
  plan: AgentCoreTaskPlan,
  options: AgentCoreExecutionOptions,
): Promise<AgentCoreExecutionResult> {
  const {
    executeTool,
    onProgress,
    isCancelled,
    cancelSignal,
    maxExecutionTimeMs = DEFAULT_MAX_EXECUTION_TIME_MS,
    stepDelayMs = DEFAULT_STEP_DELAY_MS,
    retryLimit = DEFAULT_RETRY_LIMIT,
  } = options;

  const startedAt = Date.now();
  let currentPlan = updatePlanStatus(plan, "executing");
  const results: Record<string, unknown> = {};
  const errors: string[] = [];

  while (true) {
    if (isCancelled?.() || cancelSignal?.cancelled) {
      currentPlan = updatePlanStatus(currentPlan, "cancelled");
      break;
    }

    if (Date.now() - startedAt > maxExecutionTimeMs) {
      errors.push(formatTimeoutError(maxExecutionTimeMs));
      currentPlan = updatePlanStatus(currentPlan, "failed");
      break;
    }

    const nextStep = getNextPendingStep(currentPlan);
    if (!nextStep) {
      const allCompleted = currentPlan.steps.every(
        (step) => step.status === "completed" || step.status === "skipped",
      );
      currentPlan = updatePlanStatus(currentPlan, allCompleted ? "completed" : "failed");
      break;
    }

    currentPlan = updateStepStatus(currentPlan, nextStep.id, "running");
    const runningStep = currentPlan.steps.find((step) => step.id === nextStep.id) ?? {
      ...nextStep,
      status: "running" as const,
    };
    onProgress?.({
      step: runningStep,
      plan: currentPlan,
      message: `Executing: ${nextStep.description}`,
    });

    const execution = await executeStepWithRetry({
      executeTool,
      getPlan: () => currentPlan,
      maxExecutionTimeMs,
      retryLimit,
      startedAt,
      step: runningStep,
      stepDelayMs,
    });

    if (execution.success) {
      results[nextStep.id] = execution.result;
      currentPlan = updateStepStatus(
        currentPlan,
        nextStep.id,
        "completed",
        execution.result,
      );
      onProgress?.({
        step: { ...runningStep, status: "completed", result: execution.result },
        plan: currentPlan,
        message: `Completed: ${nextStep.description}`,
      });
    } else {
      const error = execution.error;
      errors.push(
        isTimeoutError(error) ? error : `Step ${nextStep.order} (${nextStep.toolName}): ${error}`,
      );
      currentPlan = updateStepStatus(currentPlan, nextStep.id, "failed", undefined, error);
      currentPlan = updatePlanStatus(currentPlan, "failed");
      onProgress?.({
        step: { ...runningStep, status: "failed", error },
        plan: currentPlan,
        message: `Failed: ${nextStep.description}`,
      });
      break;
    }

    if (stepDelayMs > 0) {
      await delay(stepDelayMs);
    }
  }

  const completedSteps = currentPlan.steps.filter(
    (step) => step.status === "completed",
  ).length;

  return {
    success: currentPlan.status === "completed",
    completedSteps,
    totalSteps: currentPlan.steps.length,
    results,
    errors,
    executionTime: Date.now() - startedAt,
    plan: currentPlan,
  };
}

function updatePlanStatus(
  plan: AgentCoreTaskPlan,
  status: AgentCorePlanStatus,
): AgentCoreTaskPlan {
  return { ...plan, status };
}

function updateStepStatus(
  plan: AgentCoreTaskPlan,
  stepId: string,
  status: AgentCoreStepStatus,
  result?: unknown,
  error?: string,
): AgentCoreTaskPlan {
  return {
    ...plan,
    steps: plan.steps.map((step) =>
      step.id === stepId
        ? {
            ...step,
            status,
            ...(result === undefined ? {} : { result }),
            ...(error === undefined ? {} : { error }),
          }
        : step,
    ),
  };
}

function getNextPendingStep(plan: AgentCoreTaskPlan): AgentCoreTaskStep | undefined {
  return [...plan.steps]
    .sort((a, b) => a.order - b.order)
    .find((step) => {
      if (step.status !== "pending") {
        return false;
      }

      return (step.dependsOn ?? []).every((dependencyId) =>
        plan.steps.some(
          (candidate) =>
            candidate.id === dependencyId && candidate.status === "completed",
        ),
      );
    });
}

async function executeStepWithRetry(args: {
  executeTool: (context: AgentCoreToolContext) => Promise<unknown>;
  getPlan: () => AgentCoreTaskPlan;
  maxExecutionTimeMs: number;
  retryLimit: number;
  startedAt: number;
  step: AgentCoreTaskStep;
  stepDelayMs: number;
}): Promise<{ success: true; result: unknown } | { success: false; error: string }> {
  for (let attempt = 0; attempt <= args.retryLimit; attempt += 1) {
    const controller = new AbortController();

    try {
      const result = await withRemainingTimeout(
        args.executeTool({
          step: args.step,
          plan: args.getPlan(),
          abortSignal: controller.signal,
        }),
        args.startedAt,
        args.maxExecutionTimeMs,
      );

      return { success: true, result };
    } catch (error) {
      controller.abort();
      const message = error instanceof Error ? error.message : "Unknown error";

      if (attempt >= args.retryLimit || message.startsWith("Execution timed out")) {
        return { success: false, error: message };
      }

      if (args.stepDelayMs > 0) {
        await delay(args.stepDelayMs);
      }
    }
  }

  return { success: false, error: "Unknown error" };
}

async function withRemainingTimeout<T>(
  promise: Promise<T>,
  startedAt: number,
  maxExecutionTimeMs: number,
): Promise<T> {
  const elapsed = Date.now() - startedAt;
  const remainingMs = Math.max(0, maxExecutionTimeMs - elapsed);

  if (remainingMs <= 0) {
    throw new Error(formatTimeoutError(maxExecutionTimeMs));
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(formatTimeoutError(maxExecutionTimeMs))),
          remainingMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function formatTimeoutError(maxExecutionTimeMs: number): string {
  return `Execution timed out after ${Math.round(maxExecutionTimeMs / 1000)} seconds`;
}

function isTimeoutError(error: string): boolean {
  return error.startsWith("Execution timed out");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
