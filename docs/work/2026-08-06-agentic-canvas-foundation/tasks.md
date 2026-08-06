# Agent-editable workspace foundation - TDD task list

Plan: `docs/work/2026-08-06-agentic-canvas-foundation/plan.md`
Architecture: `docs/architecture/agentic-workspace-platform.md`
Forge issue: `9a77ebc8-1b20-4634-8e93-5bcd920eac31`
Status: revised proposal; `/dev` has not started

## Execution rules

- Run every task RED -> GREEN -> REFACTOR and commit only after focused checks pass.
- The main agent assigns exact non-overlapping file ownership before each task.
- Existing proposal/Review Inbox authority is reused; no second approval model.
- Agents never write raw Yjs state or application tables.
- BlockSuite is conditional. A failed core gate switches the remaining editor tasks to the
  documented BlockNote + React Flow fallback without changing Product contracts.
- Stop after the vertical slice. Chat, meetings, workflows, and cloud-agent adapters are
  separate issues.

## Wave 0 - evidence and contracts

### Task 0: Freeze evidence fixtures and budgets

Create current BlockSuite `0.19.5` golden documents, a representative large document,
keyboard/accessibility scenarios, and explicit timing/bundle budgets. Tests must prove the
fixtures open in the current integration before they are used to judge an upgrade.

Expected evidence: reproducible fixtures and a gate matrix covering all ten plan gates.

### Task 1: Define the provider-neutral run/event contract

Add the minimum `AgentDefinitionVersion`, `AgentRun`, `RunEvent`, `CapabilityGrant`,
`ApprovalRef`, and `ArtifactRef` schemas. Provider session data must stay opaque. Add an
adapter conformance suite for ordered cursors, cancellation, incomplete/error states,
parent/child runs, approvals, and artifact emission.

Expected evidence: current runtime data can round-trip without losing existing provenance;
future adapters can be tested without changing Product tables.

### Task 2: Adapt the current AI SDK runtime

Map the existing AI SDK 6 stream, durable run row, transcript, tool proposals, and Review
Inbox approvals into Task 1. Preserve current behavior and public API. Add no new agent
framework or scheduler.

Expected evidence: existing agent tests pass plus the adapter conformance suite.

### Task 3: Define the artifact and semantic-operation contracts

Add the engine-neutral artifact envelope, native payload references, revisions, provenance,
materialized semantic view, and typed operations for document, graph, diagram, chart, and
PDF. Keep vendor library names outside shared schemas.

Expected evidence: valid envelopes and operations parse; unknown versions, invalid revisions,
and cross-kind operations fail.

## Wave 1 - editor decision spike

### Task 4: Prove BlockSuite identity, hosting, and headless operations

Using the fixtures from Task 0, mount PageEditor and EdgelessEditor on one document, connect
two clients through the authorized Hocuspocus boundary, and apply server-side semantic block
operations in Bun using public APIs. Editing must wait for canonical synchronization.

Required gates: plan gates 1-4 and 10. Any failure records NO-GO and activates fallback.

### Task 5: Prove custom artifacts, accessibility, and performance

Render one immutable Product artifact reference in page and edgeless modes. Exercise focus,
selection, entry/exit, resize, disposal, collaboration, keyboard, NVDA, and axe flows. Measure
the agreed large document and route-lazy bundle.

Required gates: plan gates 5-7. Do not patch BlockSuite internals to pass.

### Task 6: Prove export, migration, permissions, and comments

Implement a deterministic Product-owned `BlockExportV1` adapter with HTML and Markdown
exports, then re-import while preserving IDs, nesting, and artifact refs. Prove golden
migration, forged-viewer rejection, and Product-owned comment anchors across moves/modes.

Required gates: plan gates 4, 8, and 9. Any core failure records NO-GO and activates fallback.

### Task 7: Record the editor GO/NO-GO

Write one decision entry with measurements and evidence for every gate. On GO, pin the proven
BlockSuite release and remove obsolete error suppression/timers from the production seam. On
NO-GO, implement only the smallest BlockNote Core + React Flow proof needed to show the same
Product contracts remain valid; import no XL packages.

Expected evidence: one falsifiable editor decision, not an opinion or vendor claim.

## Wave 2 - authoritative vertical slice

### Task 8: Add artifact persistence and revision fencing

Persist artifact metadata, native state references, accepted revisions, original/derived
relationships, idempotency keys, and provenance. Preserve existing BlockSuite documents and
migrate only through the proven path. Reject stale and cross-tenant writes.

Expected evidence: create/read/list, compare-and-set, redrive, tenant isolation, and immutable
original tests.

### Task 9: Add semantic read and reviewed mutation services

Expose tenant-scoped materialized reads and proposal-only semantic document operations. Apply
accepted operations exactly once after ACL, schema, and base-revision validation. Record actor,
run, proposal, prior revision, next revision, and compensation metadata.

Expected evidence: no direct-agent write path; stale, forged, duplicate, and invalid operations
fail; one accepted operation converges across clients.

### Task 10: Add one renderer registry for Canvas and chat

Resolve the same `ArtifactRef` in Canvas, full view, and the existing agent chat. Lazy-load
heavy renderers, preserve fallback/error states, render Mermaid strictly, expose chart data
summaries, and preserve immutable PDF originals.

Expected evidence: identical refs render across surfaces without copied editable content or
eager editor bundle cost.

### Task 11: Validate the end-to-end slice and stop

Run focused tests, contracts, typecheck, lint, build, two-client convergence, migration,
accessibility, performance, security, and export checks. Update the decision record and Forge
issue with the exact result and remaining separately filed work.

Expected evidence: all selected-engine gates and repository quality gates pass on one commit.
Stop at the `/plan` -> `/dev` or `/dev` -> `/validate` checkpoint as appropriate; do not begin
chat, meeting, workflow, sandbox, or external-agent implementation.
