# Agent-editable workspace foundation — TDD task list

Plan: `docs/work/2026-08-06-agentic-canvas-foundation/plan.md`  
Forge issue: `9a77ebc8-1b20-4634-8e93-5bcd920eac31`  
Status: proposed for user approval; `/dev` has not started

## Execution rules

- Run each task RED → GREEN → REFACTOR and commit only after its focused checks pass.
- The listed `OWNS` paths are exclusive within a wave. Cross-wave reuse is sequential.
- Agents never write raw Yjs state or application tables; mutations use typed proposals and
  artifact domain commands.
- The BlockNote decision gate is mandatory. If it fails gates 2–5 in the plan, substitute the
  Tiptap fallback without changing the Product-Suite contracts.
- AI SDK 7 and Cloudflare durability are separate follow-ups and do not block this MVP.

## Wave 1 — contract and editor proof

### Task 1: Define the engine-neutral artifact contract

OWNS: `packages/contracts/contracts/artifact-core.json`, `packages/contracts/src/artifacts.js`,
`packages/contracts/src/artifacts.test.ts`, `packages/contracts/src/index.js`,
`packages/contracts/src/index.d.ts`, `packages/contracts/src/index.test.ts`

File(s): the owned contract files above.

What to implement: Add canonical artifact kinds, envelope fields, native payload validators,
semantic operation schemas, `baseRevision`, provenance, and operation-specific validation.
Keep BlockNote, React Flow, Mermaid, Recharts, and PDF library names out of the shared envelope.

TDD steps:

1. Write test: parse valid document/graph/diagram/chart/pdf envelopes and each MVP semantic
   operation; reject unknown kinds, future versions, invalid revisions, and cross-kind operations.
2. Run test: confirm failure because `artifactCoreContract` and validators do not exist.
3. Implement: the JSON artifact plus JS/TypeScript exports and Zod/runtime validators following
   the existing independently-derived contract test pattern.
4. Run test: `bun run test:contracts`; confirm all contract artifacts and exports agree.
5. Commit: `feat(contracts): define artifact envelope and operations`

Expected output: one engine-neutral, machine-readable contract accepted by API and web code.

### Task 2: Prove BlockNote through the real Product-Suite seams

OWNS: `packages/ui-canvas/src/blocknote-adapter.ts`,
`packages/ui-canvas/src/blocknote-adapter.test.ts`,
`apps/platform-web/src/canvas/BlockNoteSpike.tsx`,
`apps/platform-web/src/canvas/BlockNoteSpike.test.tsx`,
`apps/platform-web/package.json`, `packages/ui-canvas/package.json`, `bun.lock`

File(s): the owned spike adapter, test component, and dependency manifests.

What to implement: A time-boxed BlockNote Core/Shadcn/server-util proof that converts JSON ↔
Y.Doc, applies semantic block operations from Bun, mounts under React 19, and exposes a lazy
browser editor. Exclude every XL package. Capture bundle and accessibility evidence in test
output or the decisions log.

TDD steps:

1. Write test: JSON → Y.Doc → semantic insert/replace/delete → JSON preserves stable IDs and the
   MVP block set; component test proves lazy mount, keyboard naming, and no XL import.
2. Run test: confirm module-not-found or missing-adapter failure before dependencies/adapter exist.
3. Implement: minimal adapter and spike component using only public BlockNote APIs.
4. Run test: focused UI-canvas/platform tests plus a two-client Hocuspocus smoke; confirm all seven
   go/no-go gates in the plan or record the exact failed gate and activate Tiptap fallback.
5. Commit: `spike(canvas): prove blocknote collaboration and server mutation`

Expected output: an evidence-backed GO for BlockNote or a deterministic fallback decision to
Tiptap Core without production artifact data.

## Wave 2 — authority and collaboration

### Task 3: Add authoritative artifact persistence and revision fencing

OWNS: `packages/db/src/schema.ts`, `packages/db/src/schema.test.ts`,
`packages/db/migrations/0016_artifacts.sql`, `packages/db/migrations/meta/_journal.json`,
`apps/platform-api/src/artifacts/repository.ts`,
`apps/platform-api/src/artifacts/repository.test.ts`

File(s): the owned DB and repository files. Use the next free migration number if `0016` is no
longer free when `/dev` starts.

What to implement: Artifact rows, immutable revision history or equivalent append-only revision
evidence, original/derived object references, optimistic compare-and-set, tenant scoping,
idempotency keys, and migration-version rejection. Preserve existing `blocksuite_documents`.

TDD steps:

1. Write test: create/read/list artifact, compare-and-set current revision, reject stale/cross-tenant
   writes, redrive one idempotency key, and retain immutable PDF originals.
2. Run test: confirm repository/schema failures because artifact tables and methods do not exist.
3. Implement: smallest schema and repository satisfying the contract; parameterize all queries.
4. Run test: DB unit tests, migration parity, and focused API repository tests.
5. Commit: `feat(artifacts): add revisioned persistence boundary`

Expected output: Postgres is the sole authoritative artifact/revision ledger.

### Task 4: Extend proposals with artifact apply and compensation

OWNS: `apps/platform-api/src/proposals/artifact-operations.ts`,
`apps/platform-api/src/proposals/artifact-operations.test.ts`,
`apps/platform-api/src/proposals/apply.ts`, `apps/platform-api/src/proposals/apply.test.ts`,
`apps/platform-api/src/proposals/undo.ts`, `apps/platform-api/src/proposals/undo.test.ts`,
`apps/platform-api/src/proposals/repository.ts`

File(s): the owned proposal domain files.

What to implement: Validate artifact proposals, render deterministic before/after data, recheck
tenant/permission/revision at accept, apply once through the artifact repository, and create a
compensating operation for supported mutations. Preserve work-item and memory behavior.

TDD steps:

1. Write test: accepted current-revision operation applies once; stale, unauthorized, malformed,
   rejected, and replayed proposals make no duplicate write; undo compensates only its revision.
2. Run test: confirm artifact operations are rejected as unsupported.
3. Implement: artifact operation branch through existing write-first/flip-last protocol; add no
   second approval state machine.
4. Run test: focused proposal apply/undo tests plus existing work-item and memory regressions.
5. Commit: `feat(proposals): apply reviewed artifact operations`

Expected output: Review Inbox remains the only mutation authority for agent-authored artifacts.

### Task 5: Connect the selected document engine to Hocuspocus safely

OWNS: `packages/ui-canvas/src/index.ts`, `packages/ui-canvas/src/index.test.ts`,
`services/hocuspocus/src/index.ts`, `services/hocuspocus/src/index.test.ts`,
`services/hocuspocus/src/server.ts`, `services/hocuspocus/src/server.test.ts`

File(s): the owned UI-canvas and collaboration service files.

What to implement: Generalize canvas document identity to artifact collaboration identity without
breaking current rooms; authorize every connect/load/store; persist selected document-engine
Y.Doc state; expose an apply hook for one validated semantic operation; never expose raw Yjs to
agent tools.

TDD steps:

1. Write test: two clients sync within one workspace, cross-workspace room names/auth fail,
   remote updates are not rebroadcast, backend operation reaches clients, and store failure is
   observable rather than reported as success.
2. Run test: confirm missing artifact room/apply APIs.
3. Implement: additive compatibility helpers and Hocuspocus hooks using existing room/auth seams.
4. Run test: `bun run test:ui-canvas`, `bun run test:hocuspocus`, and
   `bun run test:roadmap-canvas-boundary`.
5. Commit: `feat(canvas): add artifact collaboration boundary`

Expected output: human and backend edits share one authorized Y.Doc transport.

## Wave 3 — product surfaces

### Task 6: Build the Canvas workspace and renderer registry

OWNS: `apps/platform-web/src/canvas/ArtifactRenderer.tsx`,
`apps/platform-web/src/canvas/ArtifactRenderer.test.tsx`,
`apps/platform-web/src/canvas/CanvasScreen.tsx`,
`apps/platform-web/src/canvas/CanvasScreen.test.tsx`,
`apps/platform-web/src/router.tsx`, `apps/platform-web/src/router.test.tsx`,
`apps/platform-web/src/shell/nav-truth.test.ts`

File(s): the owned Canvas surface and route files.

What to implement: Replace only the `/canvas` placeholder with artifact list/detail/edit routes,
resolve renderers by artifact kind, lazy-load heavy engines, and expose loading/error/unsupported
states. Keep starred/shared routes compatible but do not invent sharing behavior beyond current
permissions.

TDD steps:

1. Write test: `/canvas` no longer resolves `BoardScreen`; each kind selects its registered lazy
   renderer; unknown/future kinds fail safely; keyboard focus and error recovery are preserved.
2. Run test: confirm Canvas routes still render the generic placeholder.
3. Implement: the minimal registry and Canvas screen, using repository injection for testability.
4. Run test: focused Canvas/router/nav tests and platform-web typecheck.
5. Commit: `feat(canvas): add artifact workspace and renderer registry`

Expected output: one Canvas shell renders native artifact engines without importing them eagerly.

### Task 7: Add graph, diagram, chart, and PDF adapters

OWNS: `apps/platform-web/src/canvas/renderers/GraphArtifact.tsx`,
`apps/platform-web/src/canvas/renderers/GraphArtifact.test.tsx`,
`apps/platform-web/src/canvas/renderers/DiagramArtifact.tsx`,
`apps/platform-web/src/canvas/renderers/DiagramArtifact.test.tsx`,
`apps/platform-web/src/canvas/renderers/ChartArtifact.tsx`,
`apps/platform-web/src/canvas/renderers/ChartArtifact.test.tsx`,
`apps/platform-web/src/canvas/renderers/PdfArtifact.tsx`,
`apps/platform-web/src/canvas/renderers/PdfArtifact.test.tsx`,
`packages/ui-charting/src/index.jsx`, `packages/ui-charting/src/index.d.ts`,
`packages/ui-charting/src/index.test.jsx`, `apps/platform-web/package.json`, `bun.lock`

File(s): the owned renderer and charting files.

What to implement: React Flow JSON graph rendering/editing, strict Mermaid source preview,
validated Product-Suite chart spec over Recharts v3, and lazy PDF.js read-only viewing. Include
semantic outlines/data tables/descriptions. Do not add Excalidraw or pdf-lib.

TDD steps:

1. Write test: valid native payloads render; semantic mutations emit typed operations; malformed
   payloads fail closed; hostile Mermaid cannot execute; chart/PDF/graph alternatives are named.
2. Run test: confirm renderer modules and chart spec do not exist.
3. Implement: minimal adapters, standardize platform-web on Recharts v3, and lazy-load PDF.js.
4. Run test: focused renderer/ui-charting tests, axe checks, typecheck, and shell bundle check.
5. Commit: `feat(canvas): render structured artifact types`

Expected output: all non-document MVP artifact kinds render and preview safely.

### Task 8: Expose artifact read/propose tools and chat/Inbox previews

OWNS: `apps/platform-api/src/agent/tools.ts`, `apps/platform-api/src/agent/tools.test.ts`,
`apps/platform-api/src/routes/agent-chat.test.ts`,
`apps/platform-web/src/agent-chat/ArtifactProposalCard.tsx`,
`apps/platform-web/src/agent-chat/ArtifactProposalCard.test.tsx`,
`apps/platform-web/src/agent-chat/AgentChatPanel.tsx`,
`apps/platform-web/src/agent-chat/AgentChatPanel.test.tsx`,
`apps/platform-web/src/agent-chat/proposal-card-data.ts`,
`apps/platform-web/src/agent-chat/proposal-card-data.test.ts`,
`apps/platform-web/src/data/proposals/types.ts`,
`apps/platform-web/src/data/proposals/types.test.ts`

File(s): the owned agent and web proposal files.

What to implement: Read-only artifact retrieval plus propose-only semantic tools; embed the shared
renderer preview in chat and Review Inbox; display base/current revision, before/after, provenance,
and stale/accepted/rejected/undone states. Do not add SDK-level auto-approval.

TDD steps:

1. Write test: tools cannot directly mutate; one valid call stores one typed proposal; chat/Inbox
   render identical preview data; cross-tenant IDs and stale revisions expose safe typed errors.
2. Run test: confirm missing artifact tool and proposal-card support.
3. Implement: extend the current `ToolRegistry`, proposal data adapter, and panel/card composition.
4. Run test: focused API tools/chat route and platform agent-chat/proposal tests.
5. Commit: `feat(agent): propose and preview artifact changes`

Expected output: agents can safely create/revise every MVP artifact through human review.

## Wave 4 — compatibility and gates

### Task 9: Preserve and export existing BlockSuite documents

OWNS: `apps/roadmap-web/src/components/blocksuite/export-adapter.ts`,
`apps/roadmap-web/src/components/blocksuite/export-adapter.test.ts`,
`apps/roadmap-web/src/components/blocksuite/persistence-types.ts`,
`apps/roadmap-web/src/components/blocksuite/__tests__/persistence-types.test.ts`,
`packages/contracts/src/canvas.js`, `packages/contracts/contracts/canvas-core.json`,
`packages/contracts/src/index.test.ts`

File(s): the owned compatibility files.

What to implement: Explicitly mark existing BlockSuite payloads as legacy-compatible, export a
materialized semantic snapshot with stable IDs where possible, and prove that the new Canvas
does not silently reinterpret or overwrite them. Do not perform bulk migration in this task.

TDD steps:

1. Write test: representative Page/Edgeless snapshots export deterministically; unsupported
   blocks are retained as explicit legacy/opaque nodes; original Yjs data remains unchanged.
2. Run test: confirm no export compatibility adapter exists.
3. Implement: read/export-only adapter and additive contract metadata.
4. Run test: Roadmap BlockSuite boundary tests and contract tests.
5. Commit: `feat(canvas): preserve legacy blocksuite artifacts`

Expected output: existing data remains accessible while new documents use the selected engine.

### Task 10: Run the critical validation and operational gates

OWNS: `docs/VALIDATION.md`,
`docs/work/2026-08-06-agentic-canvas-foundation/decisions.md`

File(s): the owned validation and decision-log files. Application files remain owned by their
earlier tasks; fixes return to the owning task before this gate passes.

What to implement: Record engine decision evidence, migrations, security/a11y checks, performance
budget, focused and full validation commands, manual collaboration/PDF/Mermaid cases, and rollout/
rollback instructions. Run dependency advisories and license checks for all new packages.

TDD steps:

1. Write test/check: define expected validation commands and manually reproducible acceptance
   cases before executing them.
2. Run checks: confirm any missing command/evidence fails the gate rather than being waived.
3. Implement: only documentation and root-cause fixes in the owning tasks; add no exemptions.
4. Run checks: contracts, DB, UI canvas/chat/charting, Hocuspocus, API proposals/agent, platform
   typecheck/lint/build, repository tooling, security/license audit, axe/keyboard, and full CI.
5. Commit: `docs: record agentic canvas validation and decisions`

Expected output: a reviewable evidence bundle proving the MVP preserves authority, compatibility,
accessibility, and operational safety.

## YAGNI review

Every retained task maps to a success criterion or edge case in the plan. The following are
intentionally excluded and require their own Forge issue plus evidence before planning:

- Excalidraw/freehand whiteboard collaboration.
- Rich PDF editing, redaction, signing, or export suite.
- Vega-Lite, ECharts, Plotly, or another chart platform.
- AI SDK 7 migration.
- Cloudflare Workflows queued/autonomous execution.
- Cloudflare Agents/Durable Objects live-session migration.
- Cloudflare Sandbox/Computer, Code Mode, or generated Gadgets.
- Cloudflare OS, Eve, Mastra, LangGraph, OpenAI Agents, or another agent control plane.

