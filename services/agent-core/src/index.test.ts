import { describe, expect, test } from "bun:test";
import { executeTaskPlan, type AgentCoreTaskPlan } from "./index";

function createPlan(): AgentCoreTaskPlan {
  return {
    id: "plan-1",
    status: "pending",
    steps: [
      {
        id: "step-1",
        order: 1,
        description: "Create first record",
        toolName: "createRecord",
        params: { title: "First" },
        status: "pending",
      },
      {
        id: "step-2",
        order: 2,
        description: "Create second record",
        toolName: "createRecord",
        params: { title: "Second" },
        status: "pending",
      },
    ],
  };
}

describe("agent-core task plan executor", () => {
  test("executes a multi-step plan through the injected tool executor", async () => {
    const calls: Array<{ toolName: string; params: Record<string, unknown> }> = [];

    const result = await executeTaskPlan(createPlan(), {
      executeTool: async ({ step }) => {
        calls.push({ toolName: step.toolName, params: step.params });
        return { id: `${step.id}-result` };
      },
      stepDelayMs: 0,
    });

    expect(result.success).toBe(true);
    expect(result.completedSteps).toBe(2);
    expect(result.totalSteps).toBe(2);
    expect(result.results).toEqual({
      "step-1": { id: "step-1-result" },
      "step-2": { id: "step-2-result" },
    });
    expect(calls).toEqual([
      { toolName: "createRecord", params: { title: "First" } },
      { toolName: "createRecord", params: { title: "Second" } },
    ]);
    expect(result.plan.status).toBe("completed");
    expect(result.plan.steps.map((step) => step.status)).toEqual([
      "completed",
      "completed",
    ]);
  });

  test("retries a failed step once and returns a failed plan when retry also fails", async () => {
    const attempts: string[] = [];

    const result = await executeTaskPlan(createPlan(), {
      executeTool: async ({ step }) => {
        attempts.push(step.id);
        throw new Error("write failed");
      },
      retryLimit: 1,
      stepDelayMs: 0,
    });

    expect(result.success).toBe(false);
    expect(attempts).toEqual(["step-1", "step-1"]);
    expect(result.completedSteps).toBe(0);
    expect(result.errors).toEqual(["Step 1 (createRecord): write failed"]);
    expect(result.plan.status).toBe("failed");
    expect(result.plan.steps[0].status).toBe("failed");
    expect(result.plan.steps[0].error).toBe("write failed");
    expect(result.plan.steps[1].status).toBe("pending");
  });

  test("honors cancellation before executing the next pending step", async () => {
    let cancelled = false;
    const executedSteps: string[] = [];

    const result = await executeTaskPlan(createPlan(), {
      executeTool: async ({ step }) => {
        executedSteps.push(step.id);
        cancelled = true;
        return { ok: true };
      },
      isCancelled: () => cancelled,
      stepDelayMs: 0,
    });

    expect(result.success).toBe(false);
    expect(result.plan.status).toBe("cancelled");
    expect(executedSteps).toEqual(["step-1"]);
    expect(result.completedSteps).toBe(1);
    expect(result.plan.steps[0].status).toBe("completed");
    expect(result.plan.steps[1].status).toBe("pending");
  });

  test("aborts an in-flight tool when cancellation is requested", async () => {
    const cancelSignal = { cancelled: false };
    let abortObserved = false;

    const resultPromise = executeTaskPlan(createPlan(), {
      executeTool: async ({ abortSignal }) =>
        new Promise((resolve, reject) => {
          abortSignal.addEventListener("abort", () => {
            abortObserved = true;
            reject(new Error("tool aborted"));
          });

          setTimeout(() => resolve({ ok: true }), 100);
        }),
      cancelSignal,
      retryLimit: 0,
      stepDelayMs: 0,
    });

    setTimeout(() => {
      cancelSignal.cancelled = true;
    }, 10);

    const result = await resultPromise;

    expect(abortObserved).toBe(true);
    expect(result.success).toBe(false);
    expect(result.plan.status).toBe("cancelled");
    expect(result.completedSteps).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.plan.steps[0].status).toBe("failed");
    expect(result.plan.steps[0].error).toBe("Execution cancelled");
    expect(result.plan.steps[1].status).toBe("pending");
  });

  test("honors cancel signals during in-flight tools when isCancelled returns false", async () => {
    const cancelSignal = { cancelled: false };
    let abortObserved = false;

    const resultPromise = executeTaskPlan(createPlan(), {
      executeTool: async ({ abortSignal }) =>
        new Promise((resolve, reject) => {
          abortSignal.addEventListener("abort", () => {
            abortObserved = true;
            reject(new Error("tool aborted"));
          });

          setTimeout(() => resolve({ ok: true }), 100);
        }),
      cancelSignal,
      isCancelled: () => false,
      retryLimit: 0,
      stepDelayMs: 0,
    });

    setTimeout(() => {
      cancelSignal.cancelled = true;
    }, 10);

    const result = await resultPromise;

    expect(abortObserved).toBe(true);
    expect(result.success).toBe(false);
    expect(result.plan.status).toBe("cancelled");
    expect(result.completedSteps).toBe(0);
  });

  test("rejects plans with duplicate step ids before executing tools", async () => {
    const plan = createPlan();
    const executeTool = mockExecuteTool();
    plan.steps[1].id = plan.steps[0].id;

    const result = await executeTaskPlan(plan, {
      executeTool,
      stepDelayMs: 0,
    });

    expect(executeTool.calls).toBe(0);
    expect(result.success).toBe(false);
    expect(result.completedSteps).toBe(0);
    expect(result.errors).toEqual([
      "Plan validation failed: duplicate step ids are not allowed",
    ]);
    expect(result.plan.status).toBe("failed");
  });

  test("rejects plans with dependencies that reference unknown steps", async () => {
    const plan = createPlan();
    const executeTool = mockExecuteTool();
    plan.steps[1].dependsOn = ["missing-step"];

    const result = await executeTaskPlan(plan, {
      executeTool,
      stepDelayMs: 0,
    });

    expect(executeTool.calls).toBe(0);
    expect(result.success).toBe(false);
    expect(result.completedSteps).toBe(0);
    expect(result.errors).toEqual([
      'Plan validation failed: step "step-2" depends on unknown step "missing-step"',
    ]);
    expect(result.plan.status).toBe("failed");
  });

  test("marks execution failed when a tool exceeds the timeout", async () => {
    const result = await executeTaskPlan(createPlan(), {
      executeTool: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { ok: true };
      },
      maxExecutionTimeMs: 5,
      retryLimit: 0,
      stepDelayMs: 0,
    });

    expect(result.success).toBe(false);
    expect(result.plan.status).toBe("failed");
    expect(result.completedSteps).toBe(0);
    expect(result.errors).toEqual(["Execution timed out after 0 seconds"]);
    expect(result.plan.steps[0].status).toBe("failed");
    expect(result.plan.steps[0].error).toBe("Execution timed out after 0 seconds");
  });
});

function mockExecuteTool(): ((() => Promise<unknown>) & { calls: number }) {
  const executeTool = (async () => {
    executeTool.calls += 1;
    return { ok: true };
  }) as (() => Promise<unknown>) & { calls: number };
  executeTool.calls = 0;
  return executeTool;
}
