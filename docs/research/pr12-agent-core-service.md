# PR12 Agent-Core Service Research

Date: 2026-05-19
Beads: `product-suite-4xw`

## Local Findings

- `apps/roadmap-web/src/app/api/ai/unified-chat/route.ts` owns large prompt, model-routing, stream, and tool orchestration behavior in a Next route.
- `apps/roadmap-web/src/app/api/ai/agent/plan/approve/route.ts` imports `executeTaskPlan`, `createCancelSignal`, and `CancelSignal` from `apps/roadmap-web/src/lib/ai/agent-loop.ts`.
- `apps/roadmap-web/src/lib/ai/agent-loop.ts` currently owns task-plan execution, retry behavior, cancellation, timeout handling, progress callbacks, and tool execution lookup through Roadmap's `toolRegistry`.
- `apps/roadmap-web/src/lib/ai/tools/tool-registry.ts` owns Roadmap-specific tool metadata and AI SDK tool conversion. This should stay in Roadmap for PR12 because tools still depend on Roadmap persistence and domain semantics.
- `apps/roadmap-web/src/app/api/ai/agent/{execute,approve,rollback,history,preview}` own auth, team/workspace checks, action history persistence, and approval semantics. PR12 should not move these in the first service-boundary slice.

## Reusable Boundary Candidate

The safest first extraction is the task-plan execution loop, not the route handlers. A service-owned engine can accept injected functions for:

- resolving and executing a tool by name,
- generating tool call IDs,
- sleeping between steps,
- reading current time for timeout checks,
- sending progress callbacks.

This keeps shell-specific auth, Supabase clients, route responses, and tool registration inside Roadmap while moving long-running orchestration policy into `services/agent-core`.

## DRY Check

Existing implementations found:

- `apps/roadmap-web/src/lib/ai/agent-loop.ts`: canonical current plan execution loop.
- `apps/roadmap-web/src/lib/ai/task-planner.ts`: canonical task-plan data shape and status helpers.
- `apps/roadmap-web/src/lib/ai/tools/tool-registry.ts`: canonical Roadmap tool registry.

PR12 should extend and wrap these existing surfaces instead of creating a second unrelated executor.

## OWASP Notes

- A01 Broken Access Control: applies if service code bypasses Roadmap route/team checks. Mitigation: keep auth, team membership, workspace ownership, and action approval checks in Roadmap routes.
- A03 Injection: applies to tool params and AI-generated plan steps. Mitigation: service boundary treats params as opaque records and delegates validation to existing tool schemas/routes.
- A04 Insecure Design: applies if long-running orchestration becomes hidden in shell routes. Mitigation: isolate orchestration policy in an injected service engine with explicit timeout, cancellation, and retry tests.
- A05 Security Misconfiguration: applies if new service is not validated in root scripts/CI. Mitigation: wire `services/agent-core` into workspace scripts and repo-tooling CI filters.
- A08 Software and Data Integrity Failures: applies to accidental duplicated execution paths. Mitigation: Roadmap wrapper delegates to the service engine and tests prove there is one execution policy.
- A09 Logging and Monitoring Failures: applies to failed agent steps. Mitigation: preserve result/error aggregation and progress callbacks through the service boundary.

## TDD Scenarios

1. Agent-core executes ordered plan steps through an injected tool executor and marks the plan completed.
2. Agent-core returns a failed plan and records errors when a tool execution fails after retry.
3. Agent-core honors cancellation before executing additional pending steps.
4. Roadmap adapter delegates task-plan execution to `services/agent-core` while resolving tools through Roadmap's `toolRegistry`.
5. Repo tooling fails until root workspace/scripts/CI/docs include `services/agent-core`.
