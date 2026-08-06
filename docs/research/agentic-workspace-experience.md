# Agentic workspace experience research

Date: 2026-08-06
Status: planning evidence; no product implementation authorized
Parent architecture issue: `9a77ebc8-1b20-4634-8e93-5bcd920eac31`

## Decision under research

How should Product-Suite combine human chat, agents, work, meetings, documents, canvas,
artifacts, approvals, and background jobs into one understandable experience without
creating separate products or hiding authority, cost, and failure?

**Result: CONFIRMED.** Build an object-centered workspace with agents as scoped members:

> A workspace contains durable objects. Humans own outcomes. Agents are visible members
> delegated to bounded runs. Conversations happen around objects; approved results become
> the objects.

The alternative—an AI sidebar independently bolted onto each board—duplicates context,
runtime, notifications, and approval behavior and makes agent state impossible to trust.

## Live Product-Suite evidence

The repository is further along than older design notes imply:

- Durable `chat_threads` already group agent runs and retain linked-object context;
  transcripts are derived from runs rather than copied into a second message authority
  ([schema](../../packages/db/src/schema.ts#L87)).
- The shell agent panel already captures context without silently changing it on navigation,
  offers a new-thread affordance, persists threads on first send, and renders proposals
  ([AgentChatPanel](../../apps/platform-web/src/agent-chat/AgentChatPanel.tsx#L143)).
- Workboard, work-item detail, Review Inbox, and meeting triage are real routes. The meeting
  index and all Canvas routes still render `BoardScreen` placeholders
  ([router](../../apps/platform-web/src/router.tsx#L67)).
- The Agent Board was already removed; the shell has Home, Workboard, Meeting board, and
  Canvas board. Agent work should remain a projection of Work Items and Runs, not a fifth
  authority ([boards](../../apps/platform-web/src/shell/boards.ts#L1)).
- The Inbox deep-link contract is still unsafe: a junk or missing `proposal` can degrade to
  first-row selection. An action link must instead open the exact object or fail closed
  ([router](../../apps/platform-web/src/router.tsx#L80)).
- The previous live UX audit found misleading provenance, inconsistent queue vocabulary,
  stale proposal output, raw errors, missing keyboard behavior, and cross-surface friction
  ([audit](./2026-07-26-ux-audit-and-simplification.md#L126)).

Therefore the plan reuses the current shell, thread, run, proposal, Inbox, Work Item, meeting,
and artifact seams. It does not introduce another chat store, Agent Board, or per-surface agent.

## Strong patterns and their limits

| Reference | Pattern to reuse | Boundary |
| --- | --- | --- |
| Notion | Canonical blocks, resource-scoped permissions, agent history, scheduled triggers | Do not copy page-centric navigation or make chat canonical knowledge |
| Linear | One accountable human owner plus an agent delegate; activity and Inbox visibility | Work delegation is not general conversation or artifact authority |
| Slack | Agents in channels and split view beside active work | Chat delivery is not Product authority |
| Buzz | Humans, agents, jobs, canvases, and audit in one social model | Do not import its unfinished Nostr/runtime/application stack |
| GitHub Copilot | Inspectable sessions, tool logs, steering, validation, reviewable output | Do not expose hidden reasoning or assume deterministic replay |
| Perplexity Computer | Scheduled, Needs attention, Completed, history, quiet no-op runs | External connector breadth must not bypass Product permissions |
| Teams | Recap groups meeting evidence and follow-ups; approval hub plus inline projection | Generated commitments still require participant confirmation |

Primary sources:
[Notion Agent](https://www.notion.com/help/notion-agent),
[Notion custom agents](https://www.notion.com/help/custom-agents),
[Linear agents](https://linear.app/docs/agents-in-linear),
[Linear assignment](https://linear.app/docs/assigning-issues),
[Slack agents](https://slack.com/help/articles/33076000248851-Work-with-AI-agents-and-assistants-in-Slack),
[Buzz](https://github.com/block/buzz),
[GitHub agent sessions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents),
[Perplexity Tasks](https://www.perplexity.ai/help-center/en/articles/11521526-perplexity-tasks),
[Teams recap](https://support.microsoft.com/en-US/teams/meetings-events/recap-a-teams-meeting).

## Options considered

| Option | Wins | Loses | Decision |
| --- | --- | --- | --- |
| Separate chat, canvas, meeting, and board agents | Fast isolated demos | Duplicate state, user confusion, inconsistent authority | Reject |
| Chat-first operating system | Familiar and flexible | Chat becomes an unreadable knowledge/work database | Reject |
| Object-only workspace with AI commands | Strong durable structure | Poor collaboration, handoff, and thinking experience | Reject |
| Object-centered workspace plus conversation fabric and bounded runs | One mental model, durable truth, visible autonomy | Requires careful cross-surface contracts | Select |

## Experience invariants

1. Chat is where people think and ask; it is durable context, not accepted knowledge.
2. Artifacts are where durable thinking is shaped; Page and Edgeless are views of one object.
3. Work Items are where commitments live; one human remains accountable.
4. Runs are bounded executions with scope, owner, state, evidence, cost, and recovery.
5. Meetings are events that produce linked evidence, recap artifacts, and draft commitments.
6. Inbox is the single attention and authorization surface; inline cards project the same
   canonical approval or handoff.
7. Activity is a human-readable causal timeline; raw provider/debug detail is secondary.
8. Settings owns agent capabilities, connectors, schedules, retention, and budgets.
9. Every surface starts the same provider-neutral Run contract.
10. Navigation never silently changes a thread or run's pinned context.

## State model

Do not overload “working.” Keep five dimensions independent:

- Run: `created -> queued -> authorizing -> running -> waiting_human |
  waiting_external | retrying -> completed | completed_partial | failed | cancelled |
  expired`.
- Commitment: `conversation -> draft -> proposal -> applied change`.
- Attention: quiet, watched, unread result, decision required, degraded, or failed.
- Authority/consent: read, draft, propose, approved-for-this-apply; not-required,
  requested, granted, denied, or revoked.
- Transport: connected, reconnecting, offline, buffering, uploading, degraded-to-text,
  muted/listening/speaking.

Streaming tokens, typing, presence, cursors, viewport, and reconnect backoff are ephemeral.
Messages, run transitions, handoffs, consent events, transcript gaps, artifact versions,
proposals, costs, and audit events are durable. Hidden chain-of-thought is never stored.

## Red-team findings

| Failure | Required defense |
| --- | --- |
| Silent context drift | Pin context and version per thread/run; offer a new thread |
| Wrong-object deep link | Exact match or explicit missing/disposed/unauthorized state |
| Agent says “done” before apply | Enforce answer/draft/proposed/applied vocabulary |
| Stale canvas or work mutation | Base revision, diff, invalidation, explicit rebase |
| Permission laundering | Derivatives inherit source visibility; recheck on read/apply |
| Duplicate retry or webhook | Persist idempotency before provider dispatch |
| Endless or stalled run | Heartbeat, last step, time/budget cap, Needs attention |
| Notification storm | Five event classes, materiality, bundling, snooze/mute/digest |
| Meeting summary invents commitments | Timestamp evidence and participant confirmation |
| Automation burns money or recurses | Human owner, budgets, depth guard, circuit breaker |
| Canvas excludes keyboard/mobile users | Equivalent structured outline and non-drag actions |
| Provider fallback changes privacy/cost | Capability preview and reauthorization |

## Security and OWASP pass

| Area | Applies | Planned control |
| --- | --- | --- |
| A01 broken access control | Yes | tenant and resource ACL checks on retrieval, projection, notifications, and apply |
| A02 cryptographic failures | Yes | encrypted transport/storage; bounded encrypted local media buffer |
| A03 injection | Yes | typed semantic operations, sanitized rendering, strict Mermaid, tool validation |
| A04 insecure design | Yes | threat-model delegation, approvals, stale state, retries, automation depth |
| A05 misconfiguration | Yes | capability defaults deny; environment/provider readiness surfaced |
| A06 vulnerable components | Yes | exact pins, license inventory, public-API gates, upgrade owner |
| A07 auth failures | Yes | principal distinct from Actor; short-lived run delegation and revalidation |
| A08 integrity failures | Yes | signed provider callbacks, idempotency, revision fences, immutable audit |
| A09 logging failures | Yes | causal events, consent/provenance, redaction, no secrets or hidden reasoning |
| A10 SSRF | Yes | brokered connectors, URL allow/policy validation, egress controls |

## DRY and blast radius

Reuse: `ShellLayout`, `AgentChatPanel`, `chat_threads`, `agent_runs`, proposals,
`InboxScreen`, Workboard routes, meeting triage, `ArtifactRef`, and the renderer registry.
Do not add parallel message/run/approval tables.

Likely implementation surfaces:

- `apps/platform-web/src/router.tsx`, `shell/*`, `agent-chat/*`,
  `boards/inbox/*`, `boards/workboard/*`, `boards/meetings/*`;
- `apps/platform-api/src/routes/agent-chat*`, run/proposal/meeting routes;
- `packages/db/src/schema.ts`, `packages/ui-chat`, `packages/ui-canvas`;
- canonical contract artifacts and migrations.

## TDD journey scenarios

1. Happy: ask from a Work Item -> pinned thread -> proposal -> exact Inbox review -> apply ->
   Work Item provenance and run receipt.
2. Failure: proposal target changes -> approval invalidates -> refresh/rebase keeps original
   evidence and never applies stale content.
3. Edge: navigate while a run continues -> old context remains visible -> new-thread offer;
   reload reconstructs the same run without duplication.
4. Meeting: explicit capture -> transcript with citations/gaps -> draft actions -> participant
   confirmation -> proposal.
5. Accessibility: complete Inbox/run/canvas-outline journey with keyboard and screen reader;
   asynchronous updates announce state without log spam.

## Recommendation

Freeze the experience architecture before building additional Canvas, meeting, or autonomous
surfaces. First correct trust-contract gaps, then ship one coherent vertical loop. Visual
polish and new provider integrations follow only after the interaction prototype and
acceptance tests prove that users understand ownership, agent state, required action, and
recovery.
