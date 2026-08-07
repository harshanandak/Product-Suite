# Cross-platform architecture conformance

**Status:** Proposed - implementation requires user approval
**Classification:** Critical - architecture, authorization, data, and release controls
**Forge issue:** `db5ad299-2988-4ff2-958b-4a37d35dffe7`
**Base:** `origin/main@a88f97b397942561628c6b0f47dfff71c7af9342`

## Decision

Product-Suite will use one product-owned architecture conformance contract to keep current MVP work
compatible with the future platform. It will extend the existing path-aware pre-push classifier and
domain tests. It will not introduce a second workflow engine, a policy language, or a new service.

The contract records durable invariants for the application shell, data, authorization, UI, commands,
versions, blocks and artifacts, agents, workflows, and meetings. A feature declares which contracts it
touches. The repository independently derives the affected contracts from changed paths and dependency
edges. The union determines the checks, so under-declaration cannot hide work.

The operating rule is:

> Block incompatible architecture early, review material trade-offs explicitly, warn about bounded
> future work, and run expensive proof only where it can change the decision.

## Why this is the smallest useful system

The repository already has most of the mechanics:

- `scripts/prepush-classify.mjs` derives affected workspaces and transitive dependents;
- `scripts/prepush-gate.mjs` supports full and quick paths;
- source/test coupling and repo-tooling checks are always on;
- migration parity, DB contract, Supabase exposure, and Worker secret checks cover specific risks;
- PR workflows are path-scoped;
- the platform deploy rejects stale SHAs and human-gates irreversible Neon migrations;
- Forge already owns issues, human approvals, stage evidence, and exceptions.

The missing piece is a canonical mapping from future-facing product contracts to executable evidence.
Adding that mapping is smaller and safer than adding another policy runtime.

## Scope

This plan governs:

1. application maintenance and dependency adoption;
2. app shell, routes, persistent chat, and surface registration;
3. Neon data authority, migrations, tenant integrity, and versioning;
4. server authorization and UI access states;
5. design-system use, accessibility, responsive behavior, and visual quality;
6. human, agent, CLI, MCP, and workflow commands;
7. block, document, canvas, chart, Mermaid, PDF, and artifact contracts;
8. provider-neutral agent runs, tools, proposals, provenance, and budgets;
9. Workflow Automation as a separate product over typed events and actions;
10. Meeting Agent capture, provider adapters, consent, retrieval, talkback, and follow-through;
11. Custom Mode compatibility without building Custom Mode during the MVP.

It does not select every provider, build Custom Mode, add a general policy engine, fork BlockSuite,
or implement meeting-provider bots.

## Canonical conformance record

Implementation should add one versioned data file, `architecture-conformance.v1.json`, validated by
one small script. Each contract entry has only:

```ts
type ConformanceContractV1 = {
  id: string;
  authority: string;
  invariant: string[];
  paths: string[];
  checks: { local: string[]; pullRequest: string[]; release: string[] };
  owner: string;
  decision: string;
};
```

The first implementation must not add a general expression language. Paths and named package scripts
are sufficient. Complicated conditions remain normal tested code in existing scripts.

Each feature issue or approved plan records:

- `contracts_touched`;
- `decisions_used`;
- new or upgraded dependencies;
- schema, permission, command, agent-action, and UI-surface changes;
- required human decisions and accepted waivers.

Missing metadata is a review failure for architecture-changing work, not for typo-sized changes. Path
inference always remains authoritative.

## Gate levels and latency budgets

| Level           | When                   |                           Budget | Evidence                                                                                                     | Failure behavior                                         |
| --------------- | ---------------------- | -------------------------------: | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| L0 intent       | Plan/issue transition  |                        under 2 s | Contract IDs, decision links, dependency and migration declarations                                          | Block unknown IDs or unresolved authority conflicts      |
| L1 local        | Commit/push            | under 15 s before affected tests | Schema validation, dependency/import boundaries, source-test coupling, migration parity                      | Block deterministic violations                           |
| L2 pull request | Changed contracts only |              target under 12 min | Affected package, contract, a11y, visual, permission, migration, and adapter tests                           | PASS, FAIL, or INCOMPLETE; incomplete never passes       |
| L3 release      | Once per candidate SHA |              target under 30 min | Full integration, exact-SHA provenance, production migration preflight, license/SBOM and performance budgets | Block release; never duplicate a successful same-SHA run |
| L4 drift        | Scheduled or requested |                off critical path | Undeclared paths, stale decisions, expired waivers, rules without executable evidence                        | File or update Forge issues; do not spam unrelated PRs   |

`forge push --quick` remains valid: lint and types can be local while CI owns tests, except packages
whose tests are their only local safety net. Cross-cutting files and unclassified paths continue to
force the full suite.

## Severity

- **BLOCK:** security, tenant isolation, data loss, authority bypass, stale revision, unsupported
  persisted version, inaccessible core flow, unreviewed irreversible migration, or an unproven
  dependency that would become canonical.
- **REVIEW:** a reversible trade-off with material cost, hosting, licensing, provider lock-in, bundle,
  accessibility, or operational impact. Forge records the human decision.
- **WARN:** a bounded future capability is intentionally deferred and has a Forge issue, owner, and
  trigger for reconsideration.

Warnings cannot be used for security, privacy, authorization, durability, or destructive migration
failures.

## Domain contract matrix

| Contract             | Product authority             | Always-invariant boundary                                                                                                   | Primary evidence                                                               |
| -------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `shell.v1`           | Product-Suite shell registry  | One registered surface, not a route per block; durable chat preserves context; unknown surfaces fail safely                 | Route/registry tests, navigation and responsive E2E                            |
| `data.neon.v1`       | Neon through `packages/db`    | Bound tenant scope, composite tenant integrity where needed, no request-supplied authority, reversible/versioned migrations | Migration parity, fresh Neon branch, cross-tenant DB contracts                 |
| `auth.capability.v1` | Server domain layer           | Deny by default; UI visibility/read-only is never authorization; derivatives inherit source visibility                      | Role/capability matrices and adversarial API tests                             |
| `ui.system.v1`       | Shared design system          | Tokens and canonical components; keyboard, focus, contrast, loading, empty, error, denied, offline, and responsive states   | Unit/a11y tests, scoped visual regression, manual UX review for new patterns   |
| `command.v1`         | Typed domain command bus      | Humans, agents, MCP, CLI, and workflows use the same validated, authorized, idempotent operation                            | Command contract, revision, replay, and proposal tests                         |
| `version.v1`         | Product-owned contracts       | Stable IDs, explicit versions, deterministic migrations, unknown-version fallback, immutable releases and rollback          | Golden fixtures and round-trip/migration tests                                 |
| `block.v1`           | Product-owned block registry  | Editor/rendering libraries never own identity, data, permissions, commands, or export                                       | Manifest, fallback, export, a11y, budget, and agent-edit tests                 |
| `run.v1`             | Provider-neutral Run protocol | Provider adapters cannot become run, tool, identity, approval, or audit authority                                           | Lifecycle, cancellation, replay, budget, provenance, and provider parity tests |
| `workflow.v1`        | Workflow Automation           | Separate definitions and schedules; consumes typed events and invokes typed actions only                                    | Trigger/action contracts, idempotency, retry and approval tests                |
| `meeting.v1`         | Meeting domain plus `run.v1`  | Visible consent, provider-neutral occurrence identity, visibility inheritance, resumable capture, cited derivatives         | Capture recovery, consent, permissions, provider fixtures and cost gates       |
| `custom-app.v1`      | Declarative app definition    | Stable IDs; separate layout/data/permissions/secrets; trusted blocks; semantic edits and immutable releases                 | Normalize/diff/publish/rollback and permission simulation tests                |

## Non-negotiable domain blockers

### Application shell and UI

- A feature cannot introduce its own competing app shell, identity, design system, chat runtime, or
  navigation authority.
- A block registers inside a stable surface; it does not add a sidebar route per instance.
- Every new core flow defines loading, empty, error, permission-denied, reconnect, and narrow-screen
  behavior before visual sign-off.
- New reusable UI uses tokens and shared components. A one-off component is allowed when it is truly
  local; speculative abstraction is not required.
- Keyboard and screen-reader access are blocking basics. Visual regression is scoped to changed
  surfaces rather than the whole application.

### Data, authorization, and versions

- New shared platform data uses Neon. Existing Roadmap Supabase paths remain isolated compatibility
  assets until separately migrated.
- A privileged database connection makes application authorization a hard boundary. Every repository
  operation binds tenant and caller capability; payload `tenantId` is never authoritative.
- Role-aware publishing, deletion, permission editing, agent action, and meeting retrieval must exist
  before those capabilities ship.
- Persisted contracts carry stable IDs, schema versions, optimistic revisions, provenance, and
  deterministic migration. Unknown data is preserved safely but cannot execute.
- Production migrations remain human-approved, non-cancellable, serialized, and rejected when the
  verified SHA is no longer current.

### Commands, agents, MCP, CLI, and workflows

- No surface writes domain data directly. It emits a named command or a proposal intent.
- Each mutation validates input, authorizes on the server, accepts an idempotency key and expected
  revision where applicable, records actor and authorizing human, and returns a normalized result.
- Agents act with the caller's permissions. Tool search discovers capability-scoped tools; it does
  not grant them.
- External coding agents edit lossless projections through parse -> normalize -> validate -> diff ->
  policy -> draft. File edits never publish directly.
- Workflow definitions, schedules, retries, and triggers remain separate from Custom Mode layouts and
  from the agent Run protocol.

### Blocks, documents, canvas, and artifacts

Every block requires immutable identity, namespaced kind, schema version, revision, runtime decoding,
deterministic migration, typed bindings and commands, server authorization, structured fallback,
text/JSON export, accessibility behavior, and resource budgets.

React Flow, Mermaid, Recharts, PDF tooling, and document/canvas editors are renderers or adapters.
Canonical state cannot contain React elements, React Flow nodes, generated Mermaid HTML, chart
instances, executable PDF content, editor objects, or provider IDs.

#### BlockSuite decision gate

BlockSuite remains a conditional dependency, not a decided authority. Import it as a pinned dependency
for a bounded spike; do not fork it. It may be selected only if the same release proves:

1. page and edgeless modes edit one canonical document with preserved IDs and references;
2. a browserless Bun service applies semantic block-ID operations and converges with clients;
3. reconnect cannot initialize from stale local state or overwrite canonical content;
4. supported golden documents migrate deterministically without losing IDs, nesting, placement, or
   artifact references;
5. custom React/Lit blocks meet lifecycle, keyboard, focus, and collaboration requirements through
   public APIs, without global error suppression or readiness timers;
6. accessibility has no unresolved serious/critical violations requiring internal patches;
7. agreed large-document open, input, and pan/zoom budgets pass on baseline hardware;
8. product-owned JSON, HTML, and Markdown export round-trip IDs, nesting, and references;
9. forged viewer updates are rejected and comment anchors survive moves and mode changes;
10. the release is pinnable, route-lazy, self-hostable on the Yjs/Hocuspocus boundary, licensed for
    the intended distribution, and replaceable through product-owned contracts.

Failure does not trigger a fork. It triggers a recorded comparison against the minimum composition:
product-owned block contract plus a focused text editor, React Flow/perfect-freehand spatial surface,
Mermaid, charting, and PDF adapters. Forking becomes a separate decision only after a public-API gap is
stable, narrow, security-reviewed, and cheaper to maintain than replacement.

### Meeting Agent

The MVP and external-provider work have separate gates:

- **MVP:** board-native promote loop; local/web capture; 5-15 second idempotent slices; IndexedDB
  recovery; server-authoritative finalize; visible recording state; notes and cited derivatives;
  proposal-based follow-through.
- **v1.5 external wedge:** read-only Google/Microsoft calendar recognition, pre-created meeting page,
  explicit start nudge, Chrome extension and desktop collector after slice recovery is proven.
- **v2 hosted calls:** a four-operation room-provider adapter may select RealtimeKit or another proven
  provider without changing occurrences, participants, artifacts, chat, or runs.
- **Later talkback:** a realtime voice adapter can use LiveKit Agents or another provider only after
  interruption, latency, consent, identity, cost, cancellation, and audit gates pass.

Joining Zoom, Google Meet, or Teams is not part of the local-capture MVP. A provider adapter must prove
waiting-room and bot-disclosure behavior, occurrence identity, participant/host authority, reconnect,
partial transcript handling, regional/privacy constraints, predictable cost, and graceful fallback.

All meeting artifacts and extracted memories inherit meeting visibility. Meeting-aware unified chat is
blocked until retrieval filters by the requesting user's visibility across search, injection, rules,
exports, and proposals. A private meeting may never become broadly injected memory.

## Dependency adoption gate

Any dependency that becomes a persisted-data, UI-runtime, collaboration, agent, meeting, or execution
foundation needs one short decision record covering:

- license and distribution obligations;
- self-hosting and managed-service cost at expected and 10x use;
- maintenance activity and public API maturity;
- exact pin, bundle/runtime impact, security history, and upgrade path;
- data portability, deterministic export, fallback, rollback, and removal path;
- which Product-Suite contract contains it;
- the spike that proves the hard requirement it is being adopted for.

Ordinary leaf libraries do not require this ceremony. License/SBOM scanning is release evidence; human
review is required only for copyleft, source-available, ambiguous, or competitively restricted terms.

## Waivers and decisions

A blocker can be waived only by a human Forge gate event containing:

```yaml
contract: block.v1
check: block-accessibility
scope: one release or path
reason: why compliance is temporarily impossible
risk: concrete user or operating impact
owner: accountable person
issue: removal work
expires_at: date or release
removal_test: evidence that closes the waiver
```

Expired, widened, ownerless, or issue-less waivers fail. Security, tenant isolation, destructive data
loss, secret exposure, and forged authorization are never waivable release warnings.

## Conformance receipt

Each architecture-affecting PR should publish a compact generated receipt:

- head SHA and base SHA;
- declared, path-inferred, and final contract set;
- checks run with PASS/FAIL/INCOMPLETE and evidence links;
- decision records and active waivers;
- dependency, migration, permission, and persisted-contract changes;
- exact-SHA release result when applicable.

The receipt is generated evidence, not another hand-maintained checklist. CodeRabbit and human review
remain useful challenge layers; neither substitutes for executable contract proof.

## Implementation sequence after approval

1. **Inventory and schema:** add the small versioned contract file and validator; map existing scripts,
   workflows, paths, owners, and decision sources without changing current gates.
2. **Classifier integration:** union declared contracts with path/dependency inference; print the chosen
   checks and reasons; unknown paths still select the full suite.
3. **Receipt and waiver validation:** generate the PR receipt and validate Forge-backed, expiring human
   waivers. Do not build a new approval database.
4. **Fill highest-risk evidence gaps:** tenant/capability adversarial tests, version golden fixtures,
   block manifest/fallback/export checks, and meeting consent/visibility/capture recovery contracts.
5. **Release and drift:** attach exact-SHA evidence, license/SBOM and performance checks; schedule a
   non-blocking drift report that files Forge issues for gaps.

Each step is a separate issue/PR with TDD. Do not combine the conformance framework, BlockSuite spike,
Custom Mode schema, meeting provider selection, or workflow runtime in one implementation branch.

## TDD and acceptance

The first implementation is accepted only when tests prove:

1. a docs-only change stays cheap;
2. a leaf package change runs its checks and transitive dependents only;
3. an undeclared changed path cannot escape checking and falls back to full suite;
4. a declared contract adds checks but cannot remove path-inferred checks;
5. a cross-tenant, authorization, revision, or unsupported-version violation blocks;
6. a material dependency or irreversible migration reaches an explicit human decision gate;
7. an expired or malformed waiver blocks and a valid waiver is limited to its scope;
8. a missing, timed-out, or non-reconstructable result is INCOMPLETE, never PASS;
9. the receipt identifies the exact SHA and all evidence used;
10. the same successful exact-SHA release suite is not run twice;
11. normal feature PR latency stays within the L1/L2 budgets;
12. every matrix row has an owner, decision source, trigger paths, and at least one executable check or
    a Forge issue naming the missing evidence.

## Approval checkpoint

Approval of this plan authorizes only decomposition into implementation issues. It does not authorize
BlockSuite adoption, a BlockSuite fork, Custom Mode implementation, a meeting provider, arbitrary user
code, or production migration. Those remain separate decisions behind the contracts above.

## Related decisions and work

- Agentic workspace platform: Forge issue `9a77ebc8-1b20-4634-8e93-5bcd920eac31`.
- Detailed agentic workspace, canvas, collaboration, runtime, tool-option, licensing, hosting, and
  cost research: `feat/agentic-canvas-foundation@32a6859` and
  `feat/agentic-workspace-experience@ee6661d`, especially
  `docs/architecture/agentic-workspace-platform.md` and
  `docs/architecture/agentic-workspace-dependency-economics.md`.
- Custom Mode plan: `feat/custom-mode-platform@98d38c04a8573d163d701ebeb3b16d825ec7257c`.
- Custom Mode research: `feat/custom-mode-platform@98d38c04`,
  `docs/research/custom-mode-platform.md`.
- Workflow Automation boundary: Forge issue `ce69295d-0dcd-4650-8ad6-7c9dd7060b3a`.
- Product UX: Forge issue `b07480ea-f990-424f-b848-2b659a6dba18`.
- Live UX findings: `docs/research/2026-07-26-ux-audit-and-simplification.md`.
- Component reuse and UI sourcing: `docs/design/component-sourcing-matrix-2026-06-17.md`
  and `docs/design/component-sourcing-addendum-2026-06-18.md`.
- Meeting roadmap: `docs/design/2026-07-25-meeting-product-roadmap.md`.
- Meeting provider, capture, bot economics, and talkback research:
  `docs/research/2026-07-25-meeting-experience-and-livekit.md`,
  `docs/research/2026-07-10-meeting-bot-economics-and-alternatives.md`, and
  `docs/research/2026-07-10-meeting-web-capture-and-stt.md`.
- Cloudflare runtime research: `docs/research/2026-07-12-cloudflare-workers-for-platforms-eval.md`.
- Existing classifier: `scripts/prepush-classify.mjs`.
- Current production migration gate: `.github/workflows/platform-api-deploy.yml`.
