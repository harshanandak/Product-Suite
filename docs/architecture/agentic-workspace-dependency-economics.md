# Agentic workspace dependency boundaries and economics

Status: decision support; estimates require validation during each spike
Date: 2026-08-06

This document makes every major dependency decision explicit. Estimates are
Product-Suite planning ranges for one experienced engineer delivering authentication,
authorization, tests, observability, failure recovery, migration, and documentation.
They are not vendor commitments or delivery promises.

## Decision rule

Every dependency must record:

1. license and premium/source-available boundary;
2. managed and self-hosted availability;
3. public usage price or `UNKNOWN/procurement-only`;
4. initial integration effort;
5. recurring operational and upgrade burden;
6. data retention/egress behavior;
7. exit/migration cost;
8. what Product-Suite must still develop.

Open source is not automatically cheap. A fork or self-hosted bot fleet can cost more
than a managed adapter because Product-Suite then owns browser churn, migrations,
accessibility, scaling, security, and on-call operations.

## Classification

| Class | Meaning |
| --- | --- |
| **IMPORT** | Package runs inside Product-Suite; exact version and license are governed. |
| **INTEGRATE** | External system stays behind a Product-owned adapter and canonical data model. |
| **DEVELOP** | Strategic authority, identity, policy, event, migration, or export logic Product-Suite must own. |
| **DEFER** | No validated requirement justifies its integration and recurring burden. |

## Canvas, documents, diagrams, and whiteboards

| Option | License/premium boundary | Initial work | Recurring burden | Exit cost | Decision |
| --- | --- | ---: | ---: | ---: | --- |
| BlockSuite | MPL-2.0 core; AFFiNE services are separate | 10–16 engineer-weeks including a 2–3 week kill spike | 6–12 weeks/year; 2–4 weeks per material upgrade | 8–16 weeks with owned export; 16–30 if raw Yjs is the only format | **IMPORT exact-pinned**, conditional |
| BlockNote + React Flow | BlockNote core MPL-2.0; XL packages GPL-3.0/commercial; React Flow MIT | 12–20 weeks for Product-owned blocks plus document/spatial projections | 6–12 weeks/year | 6–12 weeks with Product blocks canonical | **Fallback**, not dual-integrated |
| Mermaid | MIT; installed Streamdown wrapper Apache-2.0 | 1–2 weeks to standardize all render surfaces | 1–2 weeks/year | Under 1–2 weeks because source is text | **IMPORT/keep** |
| Excalidraw | MIT core; hosted services separate | 4–8 weeks standalone; 8–12 Product-native | 2–5 weeks/year | 2–5 weeks if scene JSON remains intact | **DEFER** |

### BlockSuite economic boundary

- Pin all BlockSuite packages to one exact tested version; never use `^` or a canary.
- Keep at most small patches with upstream issue, regression test, owner, and expiry.
- Never patch Store/Yjs semantics, migrations, selection, or editor lifecycle.
- Product-Suite must develop authoritative subdocument persistence, sync-before-edit,
  business revisions, semantic agent commands, comments, permissions, accessibility,
  performance gates, and `BlockExportV1`.
- Fork only if upstream is abandoned and Product-Suite explicitly accepts permanent
  ownership. MPL-2.0 file-level copyleft also requires source availability for modified
  covered files and appropriate distribution notices.

Current import burden is already material: the lock contains dozens of BlockSuite/AFFiNE
packages, Next transpiles related ESM packages, and the repository carries a package patch.
The dominant cost is integration and maintenance, not a license fee.

Sources: [BlockSuite](https://github.com/toeverything/blocksuite),
[MPL 2.0](https://www.mozilla.org/en-US/MPL/2.0/),
[Mozilla MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/),
[BlockNote licensing](https://github.com/TypeCellOS/BlockNote),
[BlockNote pricing](https://www.blocknotejs.org/pricing),
[React Flow](https://github.com/xyflow/xyflow),
[Mermaid](https://github.com/mermaid-js/mermaid),
[Excalidraw](https://github.com/excalidraw/excalidraw).

## Unified collaboration

| Option | Openness/cost | Initial work | Recurring burden and exit | Decision |
| --- | --- | ---: | --- | --- |
| Product Actor/Conversation/Event model | Product-owned on existing Postgres | contract 1–2 weeks; full substrate/migration 3–5 months for one team | We own it, but it prevents every surface from duplicating identity, messages, permissions, and audit | **DEVELOP first** |
| Cloudflare Durable Objects delivery | Proprietary managed Cloudflare service; Workers Paid begins at $5/month plus usage | 2–4 weeks after canonical model | Low operations, medium Cloudflare transport lock-in; durable messages remain in Postgres | **INTEGRATE first transport spike** |
| Stream Chat | Proprietary managed SDK/API; advanced multi-tenancy/search has been listed on a $599/month annual tier | 2–4 weeks | Low operations, high vendor/data-model lock-in unless used only as delivery/projection | **Managed escape hatch** |
| Matrix/Element | Open protocol; clients/server implementations have component-specific licenses | 8–16 weeks for a governed adapter; materially more for homeserver/E2EE/federation operations | High operations and identity/search complexity; strong protocol exit | **DEFER federation adapter** |
| Buzz | Apache-2.0 application, explicitly unfinished | 20+ weeks to fork/integrate meaningfully | Very high: second identity, Nostr authority, Postgres, Redis, MinIO, search, workflow, desktop/mobile shell | **Study concepts; do not import** |
| Mattermost/Rocket.Chat/Zulip | Open/open-core standalone products with edition-specific limits | 8–16+ weeks each for safe bridges | High if embedded/forked; moderate as external connectors | **Connector only** |

Product-Suite must develop `Actor`, principal/delegation, `Conversation`,
`Membership`, ordered `ConversationEvent`, authorization, command receipts,
outbox/idempotency, legacy migration, and audit UX. Realtime vendors may deliver
events but never own canonical conversations.

Sources: [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/),
[Stream pricing](https://getstream.io/chat/pricing/),
[Matrix specification](https://spec.matrix.org/latest/client-server-api/),
[Buzz architecture](https://github.com/block/buzz/blob/main/ARCHITECTURE.md).

## External meetings, hosted rooms, and talkback

These are separate dependency classes:

- `ExternalMeetingConnector` joins or ingests Meet/Teams/Zoom.
- `RoomProvider` hosts Product-Suite calls.
- `RealtimeAgentAdapter` performs listening, turn-taking, speaking, and tools.

| Option | License/hosting and public price | Initial work | Operations/exit | Decision |
| --- | --- | ---: | --- | --- |
| Local capture | Product-owned browser/desktop code; browser APIs have no usage fee | Chrome path 4–7 weeks; desktop +5–8 | Medium browser/OS maintenance; low exit | **DEVELOP default** |
| Recall.ai | Proprietary managed API; $0.50 recording-hour, $0.15/hour built-in transcription, storage after 7 days $0.05/recording-hour/30 days | 3–5 weeks | Low-medium ops; medium exit behind canonical events; high platform-bot policy risk | **INTEGRATE first cross-provider** |
| Zoom RTMS | Proprietary Zoom service; credit-based Developer Pack, published guidance around $0.01/streaming minute without transcription | 5–8 weeks | Medium receiver/reconnect ops; low-medium exit | **DEVELOP next direct Zoom adapter** |
| Google Meet REST | Proprietary managed API; currently no added API charge within quota, excess charging planned | 2–4 weeks | Low ops; dependent on eligible native artifacts; low exit | **DEVELOP artifact adapter** |
| Google Meet Media API | Proprietary Developer Preview; production price unknown | 6–10+ weeks after GA | High preview/policy risk; all-participant enrollment currently blocks normal use | **DEFER** |
| Teams Graph media bot | Proprietary Teams/Graph; Azure Windows media runtime; exact cost workload/region-specific | 12–20 weeks | Very high C#/Azure/admin/certification ops and exit | **DEFER to enterprise demand** |
| Zoom Meeting SDK bot | Proprietary SDK/service; underlying Meetings/ISV terms, no simple public per-minute tariff | 8–14 weeks per bot platform | High client/admission/review/concurrency burden and exit | **DEFER to talkback demand** |
| Meeting BaaS managed | Managed; Free/PAYG, Pro $99, Scale $199, Enterprise $299 monthly; token usage | 3–5 weeks | Low-medium ops; medium exit; browser-bot policy risk | **Recall commercial alternate, not dual-integrated** |
| Meeting BaaS self-hosted | BSL 1.1 source-available, not conventional OSS; commercial Product-Suite use needs written permission; release converts later | 10–16 weeks | High fleet/transcription ops; medium-high legal/technical exit | **DEFER** |
| Vexa managed | Apache-2.0 core; hosted about $0.30 bot-hour plus $0.20/hour realtime transcription | 3–5 weeks | Medium newer-vendor risk; low-medium exit because core is open | **Evaluate escape hatch** |
| Vexa self-hosted | Apache-2.0 | 8–14 weeks | High browser-bot, Redis/Postgres/Kubernetes/GPU operations; low legal exit | **DEFER until sovereignty demand** |
| LiveKit Cloud/self-host | Apache-2.0 server/agents; Cloud Build $0, Ship $50, Scale $500; usage metered | basic rooms 5–9 weeks; polished product 10–16 | Low-medium managed, high self-host; low-medium exit | **RoomProvider leader** |
| Cloudflare RealtimeKit | Proprietary managed beta; beta free; announced audio $0.0005 participant-minute, AV $0.002, exports metered | basic 4–7 weeks; polished 8–14 | Low managed ops, medium-high beta/backend lock-in | **Second RoomProvider candidate** |
| Pipecat | BSD-2-Clause; framework free; Cloud compute/media/model usage metered | 4–8 weeks | Medium self-host/low-medium cloud; low exit | **IMPORT candidate behind RealtimeAgentAdapter** |

For Recall and other bot vendors, configure zero or shortest retention, ingest into
Product storage, preserve explicit consent transitions, and never leak vendor session
IDs into canonical meeting records. Capability negotiation is mandatory because local
capture, RTMS, and participant bots expose different audio, chat, screen, and talkback
abilities.

Sources: [Recall pricing](https://www.recall.ai/pricing),
[Recall retention](https://docs.recall.ai/docs/storage-and-playback),
[Zoom RTMS](https://developers.zoom.us/docs/rtms),
[Zoom developer pricing](https://zoom.us/pricing/developer),
[Google Meet limits](https://developers.google.com/workspace/meet/api/guides/limits),
[Meet Media API](https://developers.google.com/workspace/meet/media-api/guides/overview),
[Teams media requirements](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/calls-and-meetings/requirements-considerations-application-hosted-media-bots),
[Meeting BaaS license](https://www.meetingbaas.com/en/legal/license),
[Vexa self-hosting](https://vexa.ai/self-host),
[LiveKit pricing](https://livekit.com/pricing),
[RealtimeKit pricing](https://developers.cloudflare.com/realtime/realtimekit/pricing/),
[Pipecat](https://github.com/pipecat-ai/pipecat).

## Agent runtime, tools, and durability

| Option | Openness/hosting | Initial integration | Recurring/exit burden | Decision |
| --- | --- | ---: | --- | --- |
| Existing AI SDK 6 | Open-source SDK already installed; model providers remain metered | 1–2 weeks to place behind Product run/event contract | Low incremental; provider adapters remain replaceable | **KEEP first adapter** |
| Cloudflare Agents/Workflows/Sandbox/Code Mode | SDK components open; durable services are Cloudflare managed and usage-priced; Code Mode experimental | 4–8 week hosted spike after protocol | Medium platform lock-in, low operations; keep Product authority outside | **Future strategic spike** |
| Vercel Eve | Apache-2.0 framework; Vercel-hosted production path plus local adapters; public preview | 3–6 weeks to evaluate | Medium Vercel shape and preview churn | **Pattern/reference, not authority** |
| OpenAI Agents SDK | MIT; model/tool/sandbox services metered separately | 2–4 weeks | Low-medium adapter exit; durability still external | **Adapter candidate** |
| Claude Managed Agents | Proprietary managed beta | 2–4 weeks | High provider-state lock-in; low operations | **Prototype only** |
| Cursor Cloud Agents | Proprietary public-beta service | 2–4 weeks | High coding-runtime and cost lock-in; internet-enabled VM risk | **External coding adapter candidate** |
| Trigger.dev | Apache-2.0; managed or self-hosted, but wait/checkpoint parity differs | 2–4 weeks | Medium operations/self-host caveat; good TypeScript exit | **Future durability candidate** |
| Inngest | Apache SDKs; server licensing includes SSPL/delayed-open terms | 2–4 weeks | Managed dependency or licensing/ops burden | **Alternate** |
| Temporal | MIT, managed or self-hosted | 6–12 weeks | Highest conceptual and operational cost; strongest mature portability | **Defer until compliance/high-scale proof** |
| n8n | Sustainable Use License/open-core; customer-facing embedding may require commercial terms | 3–6 weeks as connector | High product-embedding risk; mature user automation | **Connector only** |

Thousands of MCP tools require a Product-owned broker using
`search -> describe -> execute`. Tool schemas, secrets, approvals, idempotency, egress,
and result limits remain Product policy. Cloudflare Code Mode is useful evidence for
token-efficient discovery, but it remains an experimental adapter rather than a mandatory
execution path.

Sources: [Cloudflare Code Mode](https://developers.cloudflare.com/agents/tools/codemode/),
[Cloudflare Workflows pricing](https://developers.cloudflare.com/workflows/reference/pricing/),
[Vercel Eve](https://vercel.com/blog/introducing-eve),
[OpenAI Agents SDK](https://github.com/openai/openai-agents-js),
[Trigger.dev pricing](https://trigger.dev/pricing),
[Inngest licensing](https://github.com/inngest/inngest),
[Temporal](https://github.com/temporalio/temporal),
[n8n license guidance](https://support.n8n.io/article/can-i-use-your-license-for-my-use-case).

## Current minimal dependency path

1. **DEVELOP** Product Actor/principal/delegation, ConversationEvent, run/event,
   artifact, approval, command, migration, and export contracts.
2. **IMPORT** exact-pinned BlockSuite only for the kill spike; keep Mermaid, React Flow,
   Recharts, PDF.js, Yjs/Hocuspocus, and the current AI SDK.
3. **DO NOT IMPORT** Excalidraw, another chat product, workflow engine, agent OS, or
   external meeting bot SDK for the canvas MVP.
4. **INTEGRATE later** Recall behind `ExternalMeetingConnector`, LiveKit behind
   `RoomProvider`, and Pipecat behind `RealtimeAgentAdapter`.
5. Add Cloudflare durability, sandboxing, and Code Mode only after the provider-neutral
   conformance contracts and a measured failure/runtime requirement exist.
