# Agentic workspace platform architecture

Status: decision candidate; implementation blocked on the named spikes
Date: 2026-08-06
Primary planning issue: `9a77ebc8-1b20-4634-8e93-5bcd920eac31`

## Decision

Product-Suite will own one provider-neutral work and run protocol. Canvas, chat,
meetings, workboards, and external agents are Product-Suite objects or adapters to
that protocol, not independent authorities.

The MVP will not fork a Notion clone, team-chat product, agent OS, workflow engine,
or meeting stack. It will prove the smallest seams that prevent future lock-in:

1. a canonical Product-Suite run/event/approval envelope;
2. a canonical artifact envelope and renderer registry;
3. a BlockSuite page/edgeless proof against production rejection gates;
4. Product-owned durable conversations with replaceable realtime delivery;
5. independent meeting-room and realtime-agent adapters.

This is a calculated commitment to boundaries, not to one vendor's full platform.

Current evidence status (2026-08-06): BlockSuite is not accepted for production yet.
The live integration fails persistence/loading, export/escape, and dependency-hygiene
gates. The decision is an exact-pinned upstream dependency behind a 2–3 engineer-week
kill-or-continue spike—not a fork. Detailed dependency and operating economics are in
[agentic-workspace-dependency-economics.md](./agentic-workspace-dependency-economics.md).

## Product invariants

- Postgres remains authoritative for workspaces, actors, permissions, conversations,
  meetings, runs, approvals, artifact metadata, schedules, and audit records.
- Forge Kernel remains authoritative for Forge issues, leases, workflow state, and
  project memory. An agent provider never receives Kernel authority.
- Provider IDs are opaque adapter metadata. They never become Product-Suite primary keys.
- Human, agent, and service actors use the same identity envelope with explicit kind,
  capabilities, authorship, and provenance.
- Every side effect crosses Product-Suite authorization, approval, revision, and
  idempotency checks even when a provider also supplies approvals.
- Canvas, chat, meetings, and the workboard refer to the same artifact and run IDs.
  They do not copy canonical editable content into surface-specific stores.
- Heavy libraries are route-lazy and replaceable. Export and migration formats are
  Product-owned.

## Authority map

| Domain | Product-Suite owns | Adapter may own temporarily |
| --- | --- | --- |
| Agent run | run ID, actor, trigger, status, approvals, artifacts, audit events | provider session, sandbox, model trace |
| Tools | grants, catalog metadata, approval class, idempotency | MCP connection and provider tool handle |
| Artifact | identity, ACL, revision, provenance, export policy | editor-native payload or uploaded binary |
| Document/canvas | metadata, ACL, accepted business revision, exports | BlockSuite Y.Doc collaboration state |
| Chat | conversation, membership, messages, threads, artifact refs, retention | delivery cursor, typing, presence |
| Meeting | meeting record, participants, consent, transcript, artifacts, follow-ups | room, tracks, recording job, provider transcript |
| Workflow | Product run/schedule reference and result | durable execution/checkpoint state |

## Protocol layers

Use protocols only at the layer they actually solve:

| Boundary | Protocol | Use |
| --- | --- | --- |
| Product UI to agent backend | AG-UI-compatible event stream | lifecycle, text, tools, state, activities, interrupts |
| Agent to tools/data | MCP plus Product tool broker | discover, describe, execute with grants and approvals |
| Editor to local coding agent | ACP | subprocess sessions, streamed updates, permission requests |
| Independent remote agent to Product-Suite | A2A, later | discovery and cross-organization tasks/artifacts |
| Product-Suite to runtime | owned adapter contract | start, resume, decide, cancel, inspect, events |

Do not use MCP for frontend streaming, A2A for internal workers, or provider-specific
session types as the Product run model.

## Minimal run model

The first contract needs only the fields required by two real runtimes:

- `AgentDefinition`: Product identity plus immutable version and capability policy.
- `AgentRun`: Product ID, definition version, actor, trigger, parent run, status,
  runtime kind, timestamps, and provider metadata.
- `RunEvent`: monotonic cursor, type, actor, timestamp, idempotency key, and typed payload.
- `CapabilityGrant`: workspace scope, tool/resource scope, expiry, and approval class.
- `ApprovalRef`: reuse the existing proposal/Review Inbox authority; do not create a
  second approval state machine.
- `ArtifactRef`: stable reference to documents, canvases, charts, PDFs, meetings,
  work items, proposals, and files.

AG-UI is an interoperability target for the event stream, not a replacement for
durable Product run state.

## Tool scale and sandboxing

Thousands of eager MCP schemas are prohibited. The broker flow is:

`search -> describe -> execute`

- Search returns small capability summaries filtered by tenant and grant.
- Describe loads only the selected schemas.
- Execute revalidates grants, approval, arguments, egress, secrets, and idempotency.
- Simple or sensitive side effects stay direct typed calls.
- Code Mode is allowed only for bounded composition in an isolated sandbox. Host-side
  handlers enforce authorization; generated code never sees credentials or unrestricted
  network access.
- Large results are filtered in the sandbox and returned as artifacts or focused data.

Cloudflare demonstrates that 2,594 endpoints can be exposed through `search` and
`execute` at roughly 1,000 schema tokens instead of loading over one million tokens,
but its Code Mode runtime is experimental. It is a future adapter and spike target,
not an MVP dependency.

Sources: [Cloudflare Code Mode](https://developers.cloudflare.com/agents/tools/codemode/),
[Code Mode MCP patterns](https://developers.cloudflare.com/agents/model-context-protocol/codemode/),
[Cloudflare API MCP server](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/).

## Canvas and document decision

### Conditional choice and dependency policy

Use BlockSuite Store + PageEditor + EdgelessEditor for the canonical rich block
document only if the architecture spike passes every rejection gate. Page and
edgeless views can share one Yjs document and block identity without conversion,
which directly satisfies the Notion-like page plus Figma-like spatial requirement.

BlockSuite is MPL-2.0 and can be self-hosted. Product-Suite must still own ACLs,
business revisions, comments, export formats, and artifact payloads. Custom blocks
store immutable Product artifact references, not duplicated domain payloads.

Import BlockSuite as an exact-pinned upstream dependency. Do not use a caret range,
canary build, or Product-Suite fork. A small patch is acceptable only with an upstream
issue, focused regression test, named owner, and removal criterion. Reject patches to
Store/Yjs semantics, schema migration, selection, or editor lifecycle: those are
fork-sized responsibilities. Forking becomes an option only if upstream is effectively
abandoned and Product-Suite deliberately accepts permanent ownership of editor internals,
migrations, accessibility, browser compatibility, and security.

BlockNote is the fallback document editor, paired with React Flow for spatial graphs,
if BlockSuite fails. Its core is MPL-2.0; `@blocknote/xl-*` is GPL-3.0/commercial and
must not enter the product without a separate licensing decision. The fallback gives
better React ergonomics, comments, accessibility, and exports, but page and spatial
views become projections rather than one isomorphic block tree.

AFFiNE/BlockSuite, AppFlowy, Outline, Docmost, and similar full applications are
reference implementations, not dependencies. Forking them imports an app shell,
identity, storage, permissions, and migrations that Product-Suite already owns.

React Flow remains the MIT-licensed engine for structured graphs and dependencies.
Mermaid remains the source-based diagram engine. Recharts remains the chart engine.
PDF.js preserves and renders immutable originals.

Do not import Excalidraw for MVP. BlockSuite Edgeless covers freeform notes, shapes,
connectors, drawing, media, frames, and spatial composition; Mermaid covers deterministic
agent-authored diagrams. Excalidraw is justified only by an explicit requirement for
`.excalidraw` interoperability, its rough hand-drawn visual language, community element
libraries, or conversion of Mermaid into individually editable scene elements. Without
one of those requirements it creates a second spatial authority.

Sources: [BlockSuite repository and license](https://github.com/toeverything/blocksuite),
[BlockSuite Store](https://blocksuite.io/guide/store),
[BlockSuite edgeless structure](https://blocksuite.io/components/editors/edgeless-data-structure),
[BlockNote licensing](https://github.com/TypeCellOS/BlockNote),
[React Flow licensing](https://github.com/xyflow/xyflow),
[Excalidraw](https://github.com/excalidraw/excalidraw).

### Current live gate evidence

The existing green suites are not acceptance evidence for the editor topology. A Bun
probe showed that ordinary `doc.updateBlock(...)` changes the page's `Doc.spaceDoc`
but produces no update on `collection.doc`. `SimpleCanvas` currently gives
`HybridProvider` the collection root, so normal block edits are not marked dirty,
persisted, or sent through its fallback broadcast path.

| Gate | Current result | Meaning |
| --- | --- | --- |
| 1. Page/Edgeless identity | Partial | wrappers share a doc, but no structural identity/convergence test |
| 2. Headless operations | Partial pass | Bun preserves IDs only when root and `spaceDoc` are handled |
| 3. Authoritative loading/persistence | **Fail** | wrong Y.Doc is observed; background loading permits editing after failure |
| 4. Revision/migration | Unproven/readiness fail | no golden migration or business revision fence |
| 5. Product artifact block | Unproven | no reference-only custom BlockSpec lifecycle proof |
| 6. Accessibility | Unproven | no NVDA, spatial keyboard, focus, or axe acceptance suite |
| 7. Performance | Unproven | no representative load/input/pan/zoom/memory budgets |
| 8. Export/escape | **Fail** | no Product-owned normalized export and round-trip |
| 9. Permissions/comments | Partial | room/read-only checks exist; forged updates and durable anchors do not |
| 10. Dependency hygiene | **Fail** | global suppression, timers, broad transpilation, and a package patch remain |

This rejects the current Product-Suite integration, not BlockSuite itself. The first
spike task must correct and test the subdocument persistence topology; if that requires
private BlockSuite internals, BlockSuite is rejected immediately.

### BlockSuite rejection gates

Reject BlockSuite and use the fallback if any core gate fails:

1. Page and edgeless clients edit one document while preserving IDs, nesting, and
   custom artifact references without copied blocks.
2. A Bun service loads the public schema without a browser editor, applies semantic
   operations by block ID, persists one transaction, and converges with two clients.
3. Editing stays disabled until canonical synchronization completes; slow reconnects
   cannot initialize or overwrite local content.
4. Current `0.19.5` golden documents migrate deterministically while preserving IDs,
   nesting, placement, and artifact references.
5. React/Lit custom blocks meet focus, keyboard, lifecycle, and collaborative-update gates
   without global patches, error suppression, or readiness timers.
6. NVDA and keyboard flows are usable in page and spatial modes; axe reports no serious
   or critical violations that require patching BlockSuite internals.
7. The agreed large document meets input, open, and pan/zoom budgets on baseline hardware.
8. Product-owned `BlockExportV1`, HTML, and Markdown round-trip IDs, nesting, and refs.
9. The server rejects forged viewer updates; comment anchors survive moves and mode changes.
10. The selected release can be pinned, route-lazy, upgraded through public APIs, and hosted
    on the existing Yjs/Hocuspocus boundary.

## Unified human and agent conversation foundation

This contract must precede Canvas, meeting, and Agent Board projections. Build four
Product-owned collaboration aggregates:

- `Actor(kind: human | agent | service)` for stable UX identity;
- `Conversation` anchored optionally to a workspace, meeting, artifact, or issue;
- `Membership` for access and conversational role;
- ordered immutable `ConversationEvent`; messages are one event type.

An agent may look like a user in channels, DMs, meetings, and artifacts, but `Actor`
is not a security principal. Every agent event retains the authenticated workload
principal, delegating actor, capability-grant version, provider/runtime, and parent run.
Runs, approvals, schedules, meetings, and artifacts remain authoritative in their owning
domains and appear through typed, versioned resource references.

Presence, typing, streaming tokens, and transient tool progress remain ephemeral. Durable
conversation events project authoritative state; they never infer an approval, schedule,
or completed run from prose. UI controls send explicit commands to the owning domain,
which emits a receipt/outbox event back into the conversation.

Postgres is canonical. A `CollaborationRealtimeAdapter` provides delivery, presence,
typing, and reconnect cursors. Cloudflare Durable Objects are the first custom transport
spike because hibernating WebSockets fit the existing Cloudflare direction; Neon remains
the durable store. Stream Chat is the managed acceleration/escape option behind the same
boundary if building polished chat delays MVP materially.

Buzz is the strongest interaction benchmark: agents and humans are visible workspace
members in channels, DMs, jobs, canvases, and audit trails. Do not fork its entire runtime.
It is explicitly unfinished, desktop-first, and would introduce Nostr, a second event
authority, Redis, MinIO, identity, search, workflow, and application-shell duplication.
Reuse concepts and possibly its Apache-2.0 ACP bridge after API stabilization.

Matrix is the future federation/sovereign adapter. Mattermost, Rocket.Chat, and Zulip
are external connectors, not embedded foundations. Ably and Supabase Realtime are
delivery technologies, not complete Product-Suite collaboration models.

Sources: [Buzz architecture](https://github.com/block/buzz/blob/main/ARCHITECTURE.md),
[Buzz agent vision](https://github.com/block/buzz/blob/main/VISION_AGENT.md),
[Matrix specification](https://spec.matrix.org/latest/client-server-api/),
[Stream React SDK](https://getstream.io/chat/docs/sdk/react/),
[Cloudflare hibernating WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/),
[Supabase Realtime](https://supabase.com/docs/guides/realtime),
[Ably Chat limitations](https://ably.com/docs/chat/rooms).

## Meeting and talkback decision

Meeting rooms, external meeting access, and voice agents are three separate replaceable
capabilities:

- `RoomProvider`: room/token lifecycle, participants, media tracks, chat import,
  recording/export, webhooks, and consent signals.
- `ExternalMeetingConnector`: join or ingest an arbitrary Meet, Teams, Zoom, or other
  supported meeting URL; emit canonical media/transcript/chat/consent/degradation events;
  optionally send chat/audio only when capability negotiation permits it.
- `RealtimeAgentAdapter`: join/leave, listen, turn detection, speak, interrupt,
  tools, handoff, transcript events, and cost/latency telemetry.

Cloudflare RealtimeKit is the first hosted human-call spike because it fits the
Cloudflare deployment direction, supports web/mobile calls, chat, recording, separate
audio tracks, transcription, summaries, R2 export, and low announced usage pricing.
It is beta and its chat/transcript retention is not Product authority.

LiveKit is the leading future talkback candidate because its Apache-2.0 ecosystem
combines open/self-hosted realtime media with production voice-agent primitives.
Pipecat is the vendor-neutral talkback benchmark. A provider can implement both
interfaces, but Product-Suite must not couple them.

MVP meeting scope remains Product-owned local/botless capture and durable
summary/artifact handoff. Add Recall.ai as the first optional managed cross-provider
connector, with explicit zero/short retention and canonical events. Add Zoom RTMS next
for direct botless Zoom ingestion. Google Meet REST is useful for native post-meeting
artifacts; its Media API remains preview-limited. Native Teams media bots, Zoom Meeting
SDK bots, and self-hosted browser-bot fleets are deferred until enterprise/talkback demand
justifies their cost. Hosted calls and talkback remain separate spikes. Meeting chat is
projected into Product conversations; provider chat is never canonical.

Sources: [RealtimeKit](https://developers.cloudflare.com/realtime/realtimekit/),
[RealtimeKit pricing](https://developers.cloudflare.com/realtime/realtimekit/pricing/),
[LiveKit Agents](https://docs.livekit.io/agents/),
[LiveKit self-hosting](https://docs.livekit.io/transport/self-hosting/),
[Daily/Pipecat pricing](https://www.daily.co/pricing/video-sdk/).

Detailed licenses, prices, implementation estimates, recurring operations, retention,
and exit costs are recorded in
[agentic-workspace-dependency-economics.md](./agentic-workspace-dependency-economics.md).

## Runtime and workflow evaluation

| Option | Best role | MVP decision | Main risk |
| --- | --- | --- | --- |
| Existing AI SDK 6 runtime | Current in-product chat adapter | Keep | not a durable control plane |
| Cloudflare Agents/Workflows/Sandbox | future hosted Product runtime | spike after protocol | young/experimental pieces |
| Claude Managed Agents | turnkey managed adapter | optional prototype | beta and Anthropic-owned state |
| OpenAI Agents SDK | lightweight model/runtime adapter | adapter candidate | durability is external |
| Vercel Eve | architecture reference or adapter | do not adopt wholesale | public preview and Vercel shape |
| Cursor Cloud Agents | first external coding-agent adapter | candidate | lock-in, cost, internet-enabled VM risk |
| Trigger.dev | portable TypeScript background execution | future durability candidate | self-hosted waits differ from cloud |
| Inngest | managed durable functions | alternative | server licensing is not pure Apache today |
| Temporal | compliance/high-scale durability | defer | largest operational/conceptual cost |
| n8n | user-authored business automation connector | connector only | embedding license and weak coding runtime |

Cloudflare is the best strategic hosted target because it combines stateful agents,
Workflows, Sandbox, browser use, MCP, approvals, Code Mode, and the product's existing
deployment direction. It is not selected as Product authority. Vercel Eve and Cloudflare
OS are valuable pattern libraries for versioned agent definitions, durable sessions,
sandboxing, permissions, and file-oriented workspaces; adopting either entire framework
would duplicate the control plane before requirements are proven.

No workflow engine is added for MVP. Introduce one only when a real run must survive
process/deploy failure or wait beyond the existing request lifecycle. Evaluate Cloudflare
Workflows first, Trigger.dev when portability matters more, and Temporal only for
compliance-grade or very high-scale durability.

Experimental components are allowed behind capability-tested adapters:

- `stable`: schedules and delegated writes may be enabled under normal policy;
- `preview`: tenant opt-in, stricter approvals, budgets, and fallback;
- `experimental`: per-run opt-in, no durable schedules or destructive/credential tools,
  short-lived grants, hard timeout, spend cap, kill switch, and mandatory fallback.

Promotion requires conformance evidence for cancellation, event ordering, idempotency,
approval interruption, artifact delivery, delegation, observability, and recovery after
process loss. “AI is experimental” permits controlled experiments; it does not permit an
experimental provider to become Product-Suite authority.

Sources: [Cloudflare Agents](https://developers.cloudflare.com/agents/),
[Cloudflare Workflows](https://developers.cloudflare.com/workflows/),
[Vercel Eve](https://vercel.com/blog/introducing-eve),
[OpenAI Agents SDK](https://openai.github.io/openai-agents-js/),
[ACP architecture](https://agentclientprotocol.com/get-started/architecture),
[AG-UI](https://docs.ag-ui.com/),
[A2A concepts](https://a2a-protocol.org/latest/topics/key-concepts/),
[Trigger.dev](https://trigger.dev/docs/introduction),
[Inngest durable agents](https://www.inngest.com/docs/learn/durable-agents).

## Progressive delivery and effort

| Phase | Outcome | Expected effort | Dependency created |
| --- | --- | --- | --- |
| 0 | actor/principal/delegation, conversation-event, run/event, and artifact contracts | 1-2 weeks | Product-owned schemas only |
| 1 | BlockSuite rejection spike and deterministic escape export | 1-2 weeks | pinned BlockSuite only if gates pass |
| 2 | agent-editable document vertical slice through Review Inbox | 2-4 weeks | existing Yjs/Hocuspocus and AI SDK |
| 3 | durable chat model and app-shell bar; DO or Stream delivery spike | 3-5 weeks | replaceable delivery adapter |
| 4 | RealtimeKit hosted-call spike and canonical meeting ingest | 2-4 weeks | replaceable RoomProvider |
| 5 | LiveKit/Pipecat talkback spike | 3-6 weeks | replaceable RealtimeAgentAdapter |
| 6 | cloud coding adapter, lazy MCP broker, schedules/durability | 4-8 weeks | selected adapters only |

These are planning ranges, not delivery promises. Phase 0 and the canvas spike are the
only architecture work required before the current canvas MVP decision. Later phases
are separately authorized issues.

## Decision triggers

- Use Stream instead of custom chat delivery if the app-shell chat slice misses its
  quality target by more than two weeks and vendor export/tenancy terms pass review.
- Add Cloudflare Workflows when the first approved run must pause/retry across deploys,
  or when scheduled runs leave the current process lifecycle.
- Add a sandbox backend when agents execute user-generated code or shell commands.
- Add A2A only when an independently operated external agent must accept Product tasks.
- Add Matrix when federation, E2EE sovereign deployment, or external Matrix rooms become
  a signed requirement.
- Add Excalidraw only when freehand drawing is a validated use case that structured
  blocks and Mermaid cannot cover.
- Reject any platform that requires Product-Suite to surrender canonical identity,
  permissions, artifacts, approvals, runs, or exportability without decisive benefit.

## Open spike questions

- Can BlockSuite pass headless mutation, migration, accessibility, export, and performance
  gates using public APIs only?
- Does Durable Objects room behavior meet expected tenant geography and reconnect ordering?
- Do Stream/Cursor/Claude contracts provide acceptable export, residency, billing, and
  deletion guarantees?
- Can RealtimeKit provide the required recording consent evidence and durable export before
  its seven-day AI artifact retention expires?
- What is the lowest-latency LiveKit/Pipecat configuration that preserves interruption,
  tool approval, and meeting provenance?
