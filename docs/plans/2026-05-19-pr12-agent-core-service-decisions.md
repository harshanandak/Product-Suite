# PR12 Agent-Core Service Decisions

Feature: `pr12-agent-core-service`
Date: 2026-05-19
Author: Codex
Beads: `product-suite-4xw`

## DEC-001: Inject Tool Execution Into Agent-Core

- Summary: `services/agent-core` owns task-plan execution policy while callers inject the concrete tool executor.
- Rationale: Injecting execution keeps the service reusable and prevents Roadmap-only dependencies such as `toolRegistry`, Supabase clients, Next route APIs, or workspace auth from entering the service boundary.
- Alternatives considered: Import Roadmap `toolRegistry` directly in the service. Rejected because it would make the service depend on the Roadmap shell and prevent reuse by other agent surfaces.
- Consequences: Agent-core can be unit-tested deterministically, and Roadmap remains responsible for mapping its registry/tool conventions into the service interface.
- Action items / owners: Roadmap adapter owners must keep registry-to-service mapping tests current when tool result shapes change.
- Date: 2026-05-19
- Author: Codex

## DEC-002: Keep Auth, Persistence, And Route Shape In Roadmap

- Summary: PR12 keeps team/workspace authorization, Supabase thread metadata, approval state, SSE formatting, and API route paths inside Roadmap.
- Rationale: The PR goal is to extract long-running orchestration policy, not to change public API behavior or move shell-owned security and persistence concerns.
- Alternatives considered: Move the plan approval route and thread metadata writes into agent-core. Rejected because that would combine a service boundary extraction with auth and persistence migration risk.
- Consequences: Existing routes remain behaviorally compatible while execution policy moves behind a smaller service-owned interface.
- Action items / owners: Future PRs can evaluate persistence or deployed-runtime movement only after this service boundary is stable.
- Date: 2026-05-19
- Author: Codex

## DEC-003: Use A Roadmap Adapter Rather Than Direct Route Imports

- Summary: Roadmap routes call `executeTaskPlanWithAgentCore` through a local adapter instead of importing `@product-suite/agent-core` directly.
- Rationale: The adapter translates Roadmap `TaskPlan`/tool result conventions to the service contract and keeps route code focused on HTTP, auth, and SSE concerns.
- Alternatives considered: Import `@product-suite/agent-core` directly in route handlers. Rejected because every route would need to know service mapping details and confirmation/tool execution behavior.
- Consequences: `agent-loop.ts` can stay as a compatibility wrapper for existing imports, and route-level tests can assert the adapter boundary without duplicating service tests.
- Action items / owners: Keep adapter tests covering confirmation results, cancellation propagation, and result shape pass-through.
- Date: 2026-05-19
- Author: Codex

## DEC-004: Keep Validation Local To The Registered Workspace Service

- Summary: Add `test:agent-core` and include it in repo tooling, CI filters, and pre-push validation.
- Rationale: A new service boundary must have its own focused validation entrypoint and must also run in the repo-wide safety chain.
- Alternatives considered: Rely only on Roadmap integration tests. Rejected because service-level retry, cancellation, timeout, and aggregation rules need deterministic unit coverage.
- Consequences: Agent-core changes fail fast in local and CI validation, and Roadmap integration tests only need to prove adapter wiring.
- Action items / owners: Expand `services/agent-core` tests before changing execution policy.
- Date: 2026-05-19
- Author: Codex
