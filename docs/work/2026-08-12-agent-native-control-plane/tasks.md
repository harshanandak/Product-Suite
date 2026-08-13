# Agent-native control plane delivery tasks

This task list is an execution map for separate medium PRs. Each PR is claimed and
owned by one autonomous agent. Tasks from different PRs must not be co-edited in the
same worktree.

## PR CP0 — Capability context and protected configuration writes

Forge issue: `af872dc9-3c53-4f9d-9fc0-3e0bbdf6889f`.

### Task 1: Canonical membership role contract

OWNS: `packages/contracts/src/**`, `packages/db/src/**`, the next canonical migration,
and their tests/manifests.

What to implement: define `viewer|member|admin|owner` as the only membership roles and
make the database/API contract reject every other value. Because there is no production
data, prefer the clean constraint/enum over compatibility logic.

TDD steps:
1. Add contract and migration tests proving the four accepted roles and rejection of
   `org_admin`, empty, unknown, and malformed roles.
2. Run the focused tests and capture the missing-contract RED.
3. Add the contract and schema/migration constraint.
4. Re-run focused tests and migration parity/manifest gates.
5. Commit `feat(auth): define canonical membership roles`.

Expected output: role parsing and database enforcement agree on exactly four values.

### Task 2: Provider-neutral capability context

OWNS: `apps/platform-api/src/auth/capabilities.ts`,
`apps/platform-api/src/auth/tenant-scope.ts`, and focused auth tests.

What to implement: resolve the caller's internal user, one requested active tenant,
canonical role, and capabilities from Clerk identity without treating Clerk claims or
request bodies as role authority. Unknown/inactive/multiple matches fail closed.

TDD steps:
1. Add matrix tests for all four roles, inactive/missing/unknown roles, ambiguous
   memberships, and cross-tenant requests.
2. Run focused tests and capture missing resolver/matrix RED.
3. Implement the minimal resolver and `read|edit|configure` matrix.
4. Re-run auth tests and keep existing tenant-scope behavior green.
5. Commit `feat(auth): add canonical capability context`.

Expected output: a typed server-derived context or a stable deny/not-found decision.

### Task 3: Guard configuration mutations

OWNS: `apps/platform-api/src/routes/teams.ts`, `statuses.ts`, `projects.ts`, and their
route tests.

What to implement: require `configure` for team/status creation and the documented
`edit` capability for project create/update. Keep foreign resources `404`, known
insufficient members `403`, and existing provenance server-derived.

TDD steps:
1. Add route tests across viewer/member/admin/owner, forged body role/tenant, inactive
   membership, cross-tenant IDs, and ambiguous tenant membership.
2. Run focused route tests and capture unauthorized success RED.
3. Wire the shared capability guard without duplicating SQL/policy in routes.
4. Run package lint, typecheck, focused tests, then the full platform-api suite.
5. Commit `feat(auth): protect platform configuration writes`.

Expected output: only the explicit capability matrix can authorize each mutation.

## PR CP1 — Versioned command kernel vertical

Forge issue: `0f825242-6214-4661-81c4-28f878123b15`.

### Task 4: Command contracts and stable errors

OWNS: `packages/contracts/src/**`, `apps/platform-api/src/commands/**`, and contract
tests.

What to implement: versioned preview/execute envelopes, stable error shape, request ID,
server-derived actor and optional server-derived on-behalf-of provenance, capability
decision, idempotency key, expected version, preview hash, approval state, and
retryability. Reject body-derived tenant, actor, role, approval, delegation, and
`onBehalfOf`.

TDD steps:
1. Add serialization and invalid-envelope tests including tenant/actor forgery.
2. Capture missing-contract RED.
3. Implement strict parsers and stable error mapping.
4. Re-run contract and platform-api type tests.
5. Commit `feat(commands): define versioned command envelopes`.

Expected output: one canonical request/result/error contract for UI, agent, and SDK.

### Task 5: Durable version, idempotency, and audit authority

OWNS: `packages/db/src/**`, canonical migration `0021`, migration tests/manifests,
and command persistence tests.

What to implement: real work-item version/CAS, command idempotency records bound to
canonical request hashes, and append-only command audit metadata in the same
transaction as the domain write. Preserve and advance the exact `0018`/`0019`/`0020`
topology, harness, evidence, and readiness contracts. Do not apply the migration to
production and do not add compatibility or backfill logic because there is no
production data.

TDD steps:
1. Add tests for duplicate same-input replay, duplicate different-input conflict,
   stale version, rollback, and audit/idempotency atomicity.
2. Capture missing-table/version RED.
3. Add the schema/migration and persistence repository.
4. Run migration history/parity, DB tests, and focused command persistence tests.
5. Commit `feat(commands): persist CAS idempotency and audit`.

Expected output: retries are deterministic and no success can exist without its audit.

### Task 6: Preview/execute registry for first verticals

OWNS: `apps/platform-api/src/commands/**`, versioned routes in `app.ts`, proposal/domain
adapters, and focused integration tests.

What to implement: register work-item create/update and proposal apply; preview the
same normalized operation execute uses; require matching preview hash for sensitive
execution; call existing domain commands rather than raw duplicate SQL.
`work-item.create` and `work-item.update` require server-derived `edit`, are
non-sensitive for a directly authenticated human, and reject client delegation.
Agent-proposed mutation is available only through `proposal.apply`, which derives its
target command/capability and approval from the stored accepted/approved proposal,
binds the stored snapshot/version/preview, and records the proposing agent as
server-derived `onBehalfOf` provenance.

TDD steps:
1. Add happy path, duplicate retry, stale version, preview drift, denied capability,
   cross-tenant, stored approval, body-forgery/delegation rejection, idempotency
   changed-input, and transaction rollback tests. Assert `404` cross-tenant, `403`
   known insufficient capability, `409` stale/drift/changed-input, original terminal
   result on same-key/same-input replay, and no partial write/audit/idempotency state.
2. Capture missing route/registry RED.
3. Implement `/api/v1/commands/:command/preview|execute` and adapters.
4. Run focused integration, platform-api, DB, lint, and typecheck gates.
5. Commit `feat(commands): add governed preview and execution`.

Expected output: humans and accepted agent proposals share one transactional write path.

CP1 excludes CP2 UI/E2E/activity timeline, generic CRUD/workflow engines,
modules/marketplace/arbitrary execution, Cloudflare, Meeting delivery, and production
migration execution.

### Task 7: SDK command client

OWNS: `packages/sdk/src/**` and SDK tests.

What to implement: typed preview/execute methods, stable errors, request/idempotency/
version headers or fields, and retry-safe result handling.

TDD steps:
1. Add request-shape, error, retry, and preview-hash tests.
2. Capture missing API RED.
3. Implement the client without provider-specific auth assumptions.
4. Run SDK and contract tests.
5. Commit `feat(sdk): expose governed commands`.

Expected output: web and agent clients can use the same typed command contract.

## PR CP2 — Governed command UX

Forge issue: `8e80ca7c-cf37-4d5f-9309-f50cb56f3450`.

### Task 8: Preview, approval, execute, and result UX

OWNS: affected `apps/platform-web/src/**` mutation flows and focused tests.

What to implement: replace direct writes for the first verticals with SDK preview and
execute; display diff, permission, approval, request ID, actionable failure, and result.

TDD steps:
1. Add component/integration tests for preview, keyboard flow, stale preview, safe
   retry, denied capability, and errors.
2. Capture direct-write/absent-preview RED.
3. Implement accessible governed mutation UI.
4. Run platform-web lint, typecheck, unit tests, build, and bundle checks.
5. Commit `feat(web): add governed command review flow`.

Expected output: the UI cannot silently bypass preview/execute for the owned flows.

### Task 9: Unified activity timeline and one E2E

OWNS: activity UI/query adapter and one affected Playwright E2E specification.

What to implement: show human/agent/module identity, delegation, approvals, failures,
retries, and compensation using command audit events. This PR is the sole E2E owner.

TDD steps:
1. Add timeline mapping tests and an E2E for preview → approve/execute → activity.
2. Capture missing timeline/event RED.
3. Implement the minimal query/view and E2E fixture.
4. Run affected unit/build/E2E and accessibility gates once.
5. Commit `feat(web): unify command activity`.

Expected output: one traceable product story from intent through durable outcome.

## PR CP3 — First-party manifest-only module registry

Forge issue: `0c9250aa-2b34-49be-a85f-54ee00327fb4`.

### Task 10: Manifest schema and registry

OWNS: `packages/contracts/src/**`, `modules/workboard/manifest.*`,
`modules/meeting/manifest.*`, registry code, and tests.

What to implement: strict data-only manifests for identity/version, resources,
commands, tools, views/blocks, schemas, permissions, and events. Reject unknown
capabilities and permission expansion without approval metadata.

TDD steps:
1. Add valid, malformed, unknown-permission, duplicate-ID, expansion, and schema-drift
   tests.
2. Capture absent-registry RED.
3. Implement strict manifest validation and the two first-party manifests.
4. Run contract/registry tests and source-test coupling.
5. Commit `feat(modules): add first-party capability registry`.

Expected output: trusted manifests are discoverable data, never executable payloads.

### Task 11: Resource-reference canvas/view integration

OWNS: registry view/block metadata and focused reference validation tests.

What to implement: require blocks to reference canonical resources plus layout; all
mutations resolve to registered commands. No business-resource copies in canvas state.

TDD steps:
1. Add reference, missing-resource, wrong-tenant, unknown-command, and stale-version
   tests.
2. Capture unsupported-reference RED.
3. Implement metadata validation only; do not add a new canvas runtime.
4. Run registry/contract tests.
5. Commit `feat(modules): bind blocks to canonical resources`.

Expected output: module views cannot create a second business-data authority.

## PR CP4 — Generated discovery, SDK, tools, and docs

Forge issue: `cfb7ed68-32db-4503-9b0e-dee1284d4bed`.

### Task 12: Deterministic capability compiler

OWNS: compiler/generator source, fixtures, generated contract artifacts, and tests.

What to implement: deterministically compile registry and command contracts into a
versioned discovery payload and contract hash. Detect nondeterminism and drift.

TDD steps:
1. Add stable ordering/hash, duplicate, malformed, and drift tests.
2. Capture missing-compiler RED.
3. Implement the minimal compiler and checked contract artifact.
4. Run twice and assert byte-identical output.
5. Commit `feat(capabilities): compile discovery contracts`.

Expected output: one exact contract hash identifies all generated consumers.

### Task 13: SDK, agent-tool, and documentation adapters

OWNS: generated SDK metadata, agent-tool schemas, API documentation/explorer fixtures,
and drift tests.

What to implement: derive all three adapters from the compiled registry. Agent tools
include only granted capabilities and safe retry/version/preview fields.

TDD steps:
1. Add least-privilege, schema parity, example, and stale-generation tests.
2. Capture missing-adapter RED.
3. Implement generation adapters without copying schema logic.
4. Run contract, SDK, agent-tool, and docs drift gates.
5. Commit `feat(capabilities): generate clients tools and docs`.

Expected output: UI/SDK/agents/docs cannot silently disagree about capabilities.

## Per-PR final gate

Before first push: focused RED/GREEN evidence, affected lint/type/unit/build, migration
and security gates when applicable, `git diff --check`, source-test coupling, and one
CodeRabbit CLI review with all valid findings batched into one correction. After push:
resolve all actionable threads, require exact-head required checks, observe the final
10-minute stable-green window, and hand the merge to the human. After merge, verify
main and refresh the next PR base before its owner begins.
