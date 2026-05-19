# PR12 Agent-Core Service Design

Feature: `pr12-agent-core-service`
Date: 2026-05-19
Status: planned
Beads: `product-suite-4xw`
Classification: Critical - new service architecture boundary
Research: `docs/research/pr12-agent-core-service.md`

## Purpose

Move long-running agent orchestration policy out of Roadmap shell code and into a service-owned boundary without changing provider, auth, persistence, or user-facing agent behavior yet.

## Success Criteria

- `services/agent-core` exists as a workspace-owned service package with focused tests.
- The service owns task-plan execution policy: ordered steps, retry, cancellation, timeout, progress, and result aggregation.
- Roadmap consumes agent-core through a thin adapter that resolves tools through the existing Roadmap tool registry.
- Roadmap routes continue to own auth, team/workspace access checks, approval checks, action history, and HTTP response shape.
- Root validation, repo-tooling tests, docs, and CI path filters include `services/agent-core`.
- Existing Roadmap agent routes remain behaviorally compatible.

## Out Of Scope

- Moving Supabase access, team membership checks, action history persistence, or route handlers into the service.
- Moving AI provider/model routing out of `unified-chat`.
- Moving Roadmap tool implementations or the `toolRegistry`.
- Creating a separately deployed runtime service.
- Changing approval UX, rollback semantics, or the public API route paths.

## Approach Selected

Create `services/agent-core` as an internal workspace package that exports an injected task-plan executor. The executor will not import Roadmap aliases, Supabase clients, Next APIs, or AI SDK tool registries. It will receive tool execution through an explicit callback.

Roadmap will add a local adapter in `apps/roadmap-web/src/lib/ai/agent-core-adapter.ts` that maps the existing `toolRegistry` and `TaskPlan` helpers to the service interface. Existing route imports can then point to the adapter or to a compatibility wrapper, keeping route behavior stable while removing the orchestration loop from the shell-owned module.

This is preferred over moving `unified-chat` wholesale because that route still mixes prompts, model routing, stream formatting, RAG context, and tool selection. Pulling it in one PR would blur ownership and increase rollback risk.

## Constraints

- `services/agent-core` must not import `@/` aliases.
- `services/agent-core` must not import Supabase, Next.js route APIs, or Roadmap tool modules.
- Public Roadmap API routes stay stable.
- The first service boundary must be validated by deterministic unit tests before route integration.
- Service validation must run from root scripts and CI path filters.

## Edge Cases

- Missing tool executor result returns a failed step without throwing through the route.
- Failed steps retry once, matching current Roadmap behavior.
- Cancellation before the next step stops execution and returns a cancelled plan.
- Timeout marks execution failed and preserves accumulated errors.
- Confirmation-style tool results with `executeConfirmed` still resolve through the Roadmap adapter.

## Ambiguity Policy

Use the 7-dimension decision gate. Proceed when a decision preserves current Roadmap behavior, stays inside task-plan orchestration, and confidence is at least 80%. Stop and ask before moving route handlers, auth, persistence, model routing, `unified-chat` streaming, or tool implementations into the service.

## Technical Research

See `docs/research/pr12-agent-core-service.md`.

TDD scenarios:

1. `services/agent-core` executes a two-step plan through an injected executor and returns a completed plan.
2. `services/agent-core` retries a failed tool once, records the failure, and marks the plan failed.
3. `services/agent-core` honors cancellation before executing the next pending step.
4. Roadmap adapter test proves existing `executeTaskPlan` behavior delegates to `services/agent-core`.
5. Repo-tooling test proves `services/agent-core` is in workspaces, validation docs, scripts, and CI filters.
