# Agent-editable workspace foundation

Feature: `agentic-canvas-foundation`
Date: 2026-08-06
Status: revised proposal for user approval
Forge issue: `9a77ebc8-1b20-4634-8e93-5bcd920eac31`
Classification: Critical - new artifact and agent-runtime architecture

Architecture record: [agentic-workspace-platform.md](../../architecture/agentic-workspace-platform.md)

## Outcome

Establish the smallest provider-neutral foundation that lets humans and agents create,
edit, discuss, and run work across documents, spatial canvas, charts, diagrams, PDFs,
meetings, chat, and workboards without making an editor or cloud-agent vendor the
Product-Suite authority.

This plan is limited to the contracts and canvas vertical slice. Chat, hosted calls,
talkback, autonomous schedules, and external cloud coding agents remain linked epics and
must not be pulled into this implementation stage.

## Decisions

1. Product-Suite owns the canonical run/event/approval and artifact envelopes.
2. The current AI SDK 6 runtime becomes the first adapter; it is not the protocol.
3. AG-UI compatibility guides UI events; MCP handles tools; ACP handles local coding agents;
   A2A is deferred to independent remote agents.
4. Tool catalogs use tenant-filtered `search -> describe -> execute`; schemas are never
   loaded eagerly at large scale.
5. BlockSuite Store + PageEditor + EdgelessEditor is the conditional document engine because
   it can keep page and spatial editing on one Yjs block tree.
6. BlockSuite is rejected if any core spike gate fails. The fallback is a Product-owned
   artifact model with BlockNote Core for documents and React Flow for spatial projections.
7. Product-Suite owns ACLs, accepted business revisions, comments, provenance, exports,
   and artifact payloads. The editor owns only its native collaborative document state.
8. Existing React Flow, Mermaid, Recharts, PDF.js, Yjs/Hocuspocus, proposal, and Review Inbox
   foundations are reused. No Excalidraw, workflow engine, sandbox fabric, or agent OS is
   added in this slice.

## Licensing and hosting

- BlockSuite is MPL-2.0 and may be used in a closed commercial product; modifications to
  MPL-covered source files carry MPL obligations. Prefer extensions and wrappers over forks.
- BlockNote core is MPL-2.0. `@blocknote/xl-*` is GPL-3.0/commercial and is forbidden in the
  fallback without a separate licensing decision.
- React Flow and Excalidraw are MIT-licensed. Excalidraw remains deferred.
- BlockSuite and BlockNote can use Product-Suite's existing Yjs/Hocuspocus hosting boundary.
  A browser-only editor path is insufficient: the selected engine must pass headless Bun
  mutation and deterministic export gates.
- Product-Suite owns `BlockExportV1`, HTML, and Markdown escape paths. Raw Yjs state is a
  recovery artifact, not the only export.

## Canonical artifact boundary

The shared envelope contains stable identity and authority metadata only:

- Product artifact ID, workspace, kind, schema version, current revision, ACL reference;
- native payload reference and deterministic materialized semantic view;
- actor, run, proposal, idempotency, and provenance references;
- immutable original/derived relationships for uploaded files and PDFs.

Native payloads stay native:

| Artifact kind | MVP engine/payload |
| --- | --- |
| rich document/spatial block page | conditional BlockSuite Y.Doc |
| structured graph/mind map | React Flow graph model |
| diagram | Mermaid source |
| chart | validated chart spec plus source data reference |
| PDF | immutable original plus reviewed annotations/derived versions |

Chat and full-page views resolve the same `ArtifactRef` through one lazy renderer registry.
They never create a second editable copy.

## Agent mutation path

`read semantic view -> propose typed operation with baseRevision -> Review Inbox ->
authorize and compare revision -> apply one domain transaction -> record provenance ->
emit run/artifact events`

Agents do not write raw Yjs updates, storage objects, or application tables. The server
owns semantic operations such as insert/update/move/delete block and placement. Accepted
operations are idempotent and stale proposals are rejected rather than blindly rebased.

## Required spikes

### Run protocol proof

Map the existing AI SDK run into a small Product-Suite envelope without replacing current
behavior. Prove ordered resumable events, approval references, parent runs, artifacts, and
opaque provider metadata. Write conformance tests that a future ACP/cloud adapter can reuse.

### BlockSuite proof

Use one representative document containing nested text, lists, a Product artifact block,
spatial placement, and connectors. The proof must establish:

1. page/edgeless identity and convergence with two clients;
2. headless Bun load and semantic mutation through public APIs;
3. sync-before-edit with slow reconnects and no initialization race;
4. migration of current `0.19.5` golden documents;
5. custom block focus, keyboard, lifecycle, and collaboration behavior;
6. keyboard/NVDA/axe acceptance without patching upstream internals;
7. representative large-document performance budgets;
8. deterministic `BlockExportV1`, HTML, and Markdown export/re-import;
9. server-side permission rejection and stable comment anchors;
10. no global patches, error suppression, timers, canaries, or private APIs.

Any failure in gates 1-4, 8-10 rejects BlockSuite. Failures in 5-7 allow only a short,
explicit wrapper remediation attempt; if upstream internals must be patched, reject it.

## Success criteria

1. One versioned run/event contract is implemented by the current agent runtime adapter and
   can represent approvals, artifacts, cancellation, incomplete runs, and parent/child runs.
2. One engine-neutral artifact contract supports document, graph, diagram, chart, and PDF
   without forcing them into a universal content schema.
3. The editor spike produces a recorded GO/NO-GO against every named rejection gate.
4. A backend Bun process and two browser clients converge through the existing authorized
   Yjs/Hocuspocus boundary using only public editor APIs.
5. An agent can read a materialized semantic view and propose a typed block operation; only
   accepted, current-revision proposals mutate the document exactly once.
6. Canvas and agent chat render the same artifact reference through one lazy registry.
7. Deterministic Product-owned export makes editor replacement possible.
8. No new workflow, chat, meeting, sandbox, or external-agent platform is introduced.

## Out of scope

- Durable human chat implementation, app-shell chat bar, presence, and push delivery.
- Hosted Product-Suite calls, meeting-room provider integration, and talkback agents.
- Autonomous cron/workflow execution or a workflow visual editor.
- Cloudflare Agents/Workflows/Code Mode, Vercel Eve, Claude Managed Agents, Cursor Cloud
  Agents, OpenAI Agents SDK, Temporal, Trigger.dev, Inngest, or n8n adoption.
- A2A implementation, Matrix federation, or a Buzz/Mattermost/Rocket.Chat/Zulip fork.
- Full PDF editing, redaction, signing, or desktop-publishing fidelity.
- Freehand whiteboarding and Excalidraw.
- Eager exposure of large MCP catalogs or unrestricted agent shell/network access.

## Risk handling

| Risk | Required control |
| --- | --- |
| Editor lock-in | public APIs, pinned version, golden migrations, Product-owned export |
| Concurrent human/agent edits | `baseRevision`, server compare-and-set, reject stale accept |
| Forged collaborative update | Hocuspocus authorization and schema validation on every write |
| Duplicate side effect | stable idempotency key and one domain transaction |
| Large tool catalog | tenant-filtered search, lazy describe, bounded result shaping |
| Provider outage or replacement | opaque provider metadata and adapter conformance tests |
| Accessibility failure | rejection gate before editor commitment |
| Bundle/performance regression | route-lazy engine and measured budgets before GO |

## Related roadmap issues

- `53f47332-5605-4822-ba44-e587ec708f04` - app-wide collaboration surface.
- `c9348c5e-bfcb-4a5a-b32c-d3c6bf9ac193` - meeting capture and hosted meeting roadmap.
- `566525dc-a6bb-4f16-9f78-2f7a76e09a01` - conversational companion/talkback agent.

## Human checkpoint

Approval of this plan authorizes the contract and spike tasks in `tasks.md`. It does not
authorize chat, meetings, autonomous workflows, hosted sandboxes, or external agent adapters.
