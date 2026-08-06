# Unified agentic workspace experience

Feature: `agentic-workspace-experience`
Date: 2026-08-06
Status: draft for user review
Forge issue: `b07480ea-f990-424f-b848-2b659a6dba18`
Classification: Critical - product-wide interaction and authority architecture

Research: [agentic-workspace-experience.md](../../research/agentic-workspace-experience.md)
Platform architecture: [agentic-workspace-platform.md](../../architecture/agentic-workspace-platform.md)
Dependency economics: [agentic-workspace-dependency-economics.md](../../architecture/agentic-workspace-dependency-economics.md)

## Outcome

Deliver one coherent workspace where a user can talk with people and agents, shape durable
artifacts, conduct or capture meetings, delegate work, review changes, and resume background
runs without learning separate products or guessing:

- what is conversation versus accepted truth;
- which object and revision an agent is using;
- which human remains accountable;
- whether the agent answered, drafted, proposed, or applied something;
- what needs attention, what failed, what it cost, and how to recover.

This plan defines the experience and delivery sequence. It does not authorize implementation.

## Product thesis

> A workspace contains durable objects. Humans own outcomes. Agents are visible members
> delegated to bounded runs. Conversations happen around objects; approved results become
> the objects.

Product-Suite is not a collection of Canvas, Chat, Meeting, Workboard, and Agent applications.
It is one object-centered collaboration system with several views.

## User promises

1. **One place to think:** use the same conversation fabric from every surface.
2. **One source of truth:** artifacts, work, meetings, approvals, and runs keep canonical IDs.
3. **Visible agency:** an agent looks like a workspace member but is always machine-badged.
4. **Human accountability:** delegation never silently transfers ownership.
5. **Truthful progress:** state language distinguishes answer, draft, proposal, and applied work.
6. **Control without babysitting:** background work is inspectable, interruptible, and quiet
   until it needs attention.
7. **Recovery by default:** stale state, partial completion, offline gaps, and provider failure
   have explicit recovery paths.

## Human-convenience operating model

Convenience means reducing attention, navigation, memory, repetition, and recovery work without
hiding agency or consequence. It is not the fewest clicks at any cost. The interface adds
friction only when the action's blast radius, irreversibility, privacy impact, or cost requires
it.

### Convenience budgets

| Budget | Product rule |
| --- | --- |
| Attention | Interrupt only for a decision, blocked work, failure, or material completion. |
| Memory | Keep scope, ownership, state, and the next action visible; never require transcript recall. |
| Navigation | Let users act where the object already is and return them to the same focus and scroll position. |
| Repetition | Reuse authorized context and preferences, but show what will be reused before acting. |
| Recovery | Preserve drafts and evidence; every failure offers a safe next action instead of a dead end. |

### Risk-proportional friction

| Action class | Default experience | Required control |
| --- | --- | --- |
| Read, search, summarize | Start immediately in pinned scope | stop and source inspection |
| Draft or private exploration | Edit inline without a modal | discard, revise, promote explicitly |
| Reversible internal change | Show an in-context preview | one-action approval, provenance, and one-batch undo |
| Shared mutation | Show exact target and before/after change | revision-bound approval |
| External, destructive, financial, permission, or privacy change | Pause before execution | consequence, scope, approver, step-up control where needed |

Do not use generic confirmation dialogs. Confirmation language names the object, action,
audience, material cost, and reversibility. A low-risk action must not inherit the ceremony of a
high-risk action merely because both use an agent.

### UI execution rules

1. Present one primary action for the current state; keep alternatives nearby but visually
   secondary.
2. Keep object title, pinned scope, human owner, acting agent, and Run state in stable locations.
3. Use outcome verbs such as `Draft`, `Propose`, `Approve and apply`, `Stop`, and `Undo`; avoid
   generic `Continue`, unexplained status codes, or agent implementation terminology.
4. Start common work inline. Open a full Run, settings, or audit view only when the user asks
   for detail or the situation requires intervention.
5. Preserve composer text, selection, focus, filters, scroll position, and unsent input across
   navigation, reconnect, and temporary panels.
6. Use inline state for lasting outcomes; toasts may acknowledge but never be the only record
   of success, failure, approval, or recovery.
7. Offer equivalent pointer, keyboard, touch, and structured-list paths. Spatial manipulation
   is an enhancement, not the only way to complete work.
8. Let advanced users batch, filter, use the command palette, and stay on the keyboard without
   exposing that complexity to a first-time user.

## Six product primitives

| Primitive | User meaning | Canonical authority |
| --- | --- | --- |
| Workspace | membership, permissions, navigation, policy | Product workspace/ACL |
| Artifact | durable content; Page and Edgeless are views | Product metadata/revision plus native payload |
| Thread | durable discussion attached to the smallest useful scope | Conversation events |
| Work Item | a commitment with one accountable human | Work domain |
| Run | one bounded agent/automation execution | Run/event domain |
| Meeting | time-bounded event with evidence and draft follow-ups | Meeting domain |

An “Agent Board” is a filtered Work/Run view. It never gets a second task database.

## Information architecture

### Global navigation

1. **Home** - recent work, workspace pulse, resume.
2. **Inbox** - approval, input required, failure, mention/assignment, material completion.
3. **Work** - list/board/timeline/graph over Work Items, filterable by agent delegate.
4. **Meetings** - upcoming events, capture state, and durable recaps.
5. **Automations** - background and scheduled runs, budgets, history.
6. **Spaces** - workspace/project/content hierarchy.
7. **Search/command palette** - one index across artifacts, threads, work, meetings, and runs.

Do not add “AI” as a primary destination. Agents are actors across the workspace.

### Workspace shell

The active object remains central. A collapsible collaboration rail contains:

- the object's thread;
- participants and agent members;
- related runs and human-readable activity;
- approval/handoff projections;
- sources, provenance, and version state.

The rail can expand into a full Conversation, Run, Activity, or Approval view without
changing object identity. On small screens it becomes a route/sheet, not a compressed
three-column layout.

### Progressive disclosure

| Level | Show |
| --- | --- |
| Ambient | avatar, state, last material action, one-line result |
| Context rail | thread, run summary, sources, changes, approval/handoff |
| Full Run | plan, steps, tools, outputs, cost, validation, retry/recovery |
| Administration | instructions, capabilities, connectors, budgets, schedules, audit export |

Long work uses a persistent run chip, never only a typing indicator.

## Surface responsibilities

| Surface | Primary job | Must not become |
| --- | --- | --- |
| Chat | think, ask, coordinate, hand off | accepted knowledge or approval authority |
| Artifact/Canvas | shape durable knowledge and visual work | copied chat payload |
| Work | own and track commitments | a second agent queue |
| Inbox | decide, supply input, recover failures | an undifferentiated activity feed |
| Activity/Run | inspect causality, progress, cost, evidence | raw provider logs |
| Meeting | capture conversation and confirm outcomes | an isolated content silo |
| Settings | configure access, connectors, retention, budgets | everyday task execution |

Every surface starts the same provider-neutral `AgentRun`; none owns its own runtime.

## Interaction grammar

Use one composer and explicit output states, not separate “meeting agent,” “canvas agent,”
or “board agent” modes.

- **Ask**: read-only answer grounded in visible pinned context.
- **Draft**: produce an editable artifact or ghost preview; nothing canonical changes.
- **Propose**: create a revision-bound change for the Inbox.
- **Run in background**: create a durable Run with owner, scope, cap, and notification.
- **Schedule**: create a schedule that mints an independent occurrence Run.

The UI vocabulary is exact:

- “I found…” for an answer;
- “I drafted…” for an artifact draft;
- “I proposed…” while waiting for review;
- “Applied after <human> approved” only after the owning command succeeds.

Navigation never changes pinned context. It offers “Start a new thread about this page.”

## Agent identity and ownership

- `Actor(kind=agent)` is a visible UX member, never the authenticated principal.
- Agents use a persistent machine badge, profile, capabilities, instructions, and run history.
- A Work Item has exactly one accountable human owner and optionally one active agent delegate.
- Initiator, delegated human, workload principal, agent, provider, and run remain distinct.
- Agent messages can participate in channels/threads; agent actions always link to a Run.

## State model

Keep five orthogonal state dimensions:

### Run lifecycle

```text
created -> queued -> authorizing -> running
        -> waiting_human | waiting_external | retrying
        -> completed | completed_partial | failed | cancelled | expired
```

### Commitment

```text
conversation -> draft -> proposal -> applied durable change
```

### Attention

`quiet | watched | unread_result | decision_required | degraded | failed`

### Authority and consent

`read | draft | propose | approved_for_this_apply`

`not_required | required | requested | granted | denied | revoked`

### Ephemeral transport

`connected | reconnecting | offline | buffering | uploading | degraded_to_text |
muted | listening | speaking`

Meaningful transport failures project into the durable Run; ordinary presence/typing does not.

## Core journeys

### Ask from any object

1. Open the shell conversation.
2. See and edit the pinned object/block/meeting/work scope before sending.
3. Answer immediately for read-only work; preflight background or action-producing work.
4. Render activity in human language and durable outputs as canonical cards.
5. Keep the conversation usable while background work continues.
6. Deep-link cards to the exact artifact, run, proposal, or failure.

### Delegate from Work

1. Human owner remains visible.
2. Agent delegate receives explicit outcome, scope, sources, cap, and deadline.
3. The Work Item and Run show the same progress and activity.
4. Proposed mutations go to Inbox; removing delegation does not erase completed evidence.

### Edit an artifact or Canvas

1. Select a block, region, chart, or whole artifact.
2. Pin its stable ID and base revision to the thread/run.
3. Answer, draft a ghost preview, or create a semantic-operation proposal.
4. Show before/after; concurrent edits make the proposal stale.
5. Apply only after revalidation; create a new revision and causal activity event.
6. Page, Edgeless, chat card, and full view resolve the same object.

### Meet

Before: show organizer, attendees, visibility, capture method, capabilities, consent, and
explicit Start. Never auto-capture only because calendar time arrived.

During: keep capture/consent and Stop visible; distinguish Live, Waiting room, Buffering,
Uploading, Gap detected, and Agent disconnected. Listen and speak are separate permissions.

After: transcript -> chapters -> cited summary -> draft decisions/actions -> participant
confirmation -> proposal. Meeting chat projects into the same conversation fabric.

### Run in background

Preflight shows owner, scope, outputs, permissions, estimated range, maximum cost, duration,
and notification destination. Reload reconstructs the Run from durable events. Cancel stops
future effects and reports what already occurred. Useful partial output ends
`completed_partial`, never silently `completed`.

### Human handoff

`waiting_human` contains one exact question, why work cannot continue, evidence, two or
three safe choices, effect/cost, deadline/default, owner, and Answer/Transfer/Cancel controls.

## Human-convenience validation battery

The five core journeys must be exercised through the following situations. These are not
personas or separate feature variants; they are conditions the same product model must handle.

| Case | Human situation | Convenience target | Expected UI and agent behavior |
| --- | --- | --- | --- |
| First useful minute | A new user arrives with no knowledge of the object model | reach one useful outcome without setup study | show recent/owned work, one clear Ask action, and examples tied to the current object |
| Quick capture | A thought, task, or decision must be saved in seconds | do not force classification before capture | accept plain language immediately, preserve it as a draft, and suggest destination afterward |
| Return after interruption | The user resumes hours or days later | understand what changed and what needs action without rereading chat | show a compact `Since you left` summary with exact objects, decisions, failures, and resume action |
| Cross-surface continuation | Work starts in a meeting and continues in chat, Canvas, or Work | avoid re-explaining context or creating copies | carry canonical references and offer a visible context change before starting a new thread |
| Focused deep work | The user wants help without losing editor or Canvas focus | keep creation in the center, automation peripheral | use inline selection actions and a collapsible rail; restore focus after agent interaction |
| Power-user throughput | A frequent user triages many items | reduce repeated opening and mouse travel | support keyboard navigation, batch review of compatible items, saved filters, and command palette actions |
| Mobile and one-handed use | The user checks progress or approves away from a desk | finish urgent non-spatial tasks without desktop layout | prioritize Inbox, reply, stop, approve, and undo; use structured artifact/Canvas views and large targets |
| Assistive technology | The user relies on keyboard, screen reader, zoom, voice, or reduced motion | provide the same outcome and state understanding | expose semantic headings, concise announcements, non-drag controls, logical focus, and reduced-motion progress |
| Team handoff | One person transfers a blocked decision or responsibility | preserve accountability and context | transfer the human owner explicitly while keeping initiator, agent, evidence, and prior decisions intact |
| Meeting participation | The user is speaking, listening, or presenting | avoid demanding visual attention during capture | keep capture/consent/stop persistent, defer non-urgent prompts, and surface cited follow-up after the meeting |
| Background work | A user delegates and continues other work | avoid babysitting or losing trust | keep a quiet persistent Run, notify only on material completion or intervention, and support stop/steer from anywhere |
| Noisy workspace | Many agents, meetings, and teammates generate events | find real obligations without notification fatigue | group by object/Run, deduplicate, rank decisions and failures first, and keep no-change runs silent |
| Weak or changing connectivity | The user moves offline, reconnects, or changes devices | preserve input and avoid duplicate work | buffer safe drafts, show transport state, restore durable Runs, and reconcile idempotently with explicit gaps |
| High-risk approval | An action affects external people, money, access, privacy, or deletion | understand consequence without reading raw logs | show target, audience, diff/effect, evidence, cost, reversibility, and the exact approving action |
| Agent uncertainty or failure | The agent lacks evidence, permission, capability, or provider availability | recover without interpreting backend errors | state what is known, what failed, what was preserved, and offer retry, narrower scope, fallback, or human handoff |
| Cost-sensitive work | The user has limited time or budget | choose value before spend and avoid surprise | show estimates only when material, enforce caps, disclose actual usage, and offer lower-cost scope or provider options |
| Private-to-shared transition | Personal thinking becomes team-visible work | prevent accidental disclosure | preview audience and included sources, exclude unauthorized material, and require explicit promotion/sharing |

The battery fails if a case needs a new canonical object, a separate agent, or a special runtime.
The same primitives, Run protocol, and attention model must absorb it.

## Attention and approvals

One Inbox has five classes only:

1. approval required;
2. input required;
3. failed or blocked;
4. mention or assignment;
5. material completion.

No-op background runs remain quiet. Events bundle by object/run and support snooze, mute,
digest, and mark unread. Every item resolves exactly or shows missing/disposed/unauthorized;
it never selects another row.

Approval cards show action, target, before/after or exact side effect, initiator, acting
agent, evidence, permission scope, cost/time when material, reversibility, expiry, and base
revision. Changed revision, permissions, or scope invalidates approval.

MVP agents may read, draft, and propose. They do not directly write. Future risk tiers may
allow reversible internal auto-apply only after atomic undo and policy evidence exist.

## Run controls and recovery

Every active Run supports:

- **Steer** without discarding completed evidence;
- **Pause** at a safe checkpoint;
- **Cancel** future work and disclose existing effects;
- **Retry from step** as a linked attempt;
- **Fork** from current data or the original snapshot.

Recovery includes local undo, atomic agent-batch undo, object history/checkpoints, trash,
restore preview, stale-conflict handling, and provider fallback disclosure. “Replay” means
inspect or fork; it never promises deterministic model reproduction.

## Accessibility and responsive behavior

- WCAG 2.2 AA is a release gate.
- Every critical action is keyboard operable; no drag-only Canvas operation.
- Page, Chat, Work, Inbox, Meeting, and Run views reflow at 320 CSS pixels.
- Edgeless has an equivalent structured outline/list for keyboard, screen-reader, and mobile
  users: open, move, edit, connect, inspect.
- Focus remains visible/unobscured and status never relies on color.
- Async state uses restrained live announcements; raw step logs do not flood assistive tech.
- Meeting captions/transcripts and timestamps are keyboard navigable.

## MVP definition

The MVP is one coherent outcome loop, not every planned surface:

```text
ask or meeting
  -> durable thread + pinned context
  -> bounded Run with visible state
  -> canonical artifact or revision-fenced proposal
  -> exact Inbox decision
  -> applied Work/Artifact change
  -> provenance, receipt, and undo
```

Ship:

1. trust repairs: exact deep links, truthful state vocabulary, stable navigation, human errors;
2. Actor/principal/delegation and Conversation/Run/Artifact contracts;
3. current durable chat upgraded to the shared thread/run projection;
4. one Inbox and run/activity view with revision-bound proposals;
5. Work Item human owner plus agent delegate;
6. one canonical artifact in Page/Edgeless/chat/full views, conditional on Canvas gates;
7. explicit local meeting capture -> cited recap -> draft actions -> proposals;
8. one-shot background Run with owner, budget, cancel, handoff, and receipt;
9. keyboard/mobile structured journeys and Canvas outline fallback;
10. global search/command entries for the implemented objects.

## MVP non-goals

- direct agent writes, auto-accept, or autonomous external side effects;
- cron mutation, multi-agent swarms, staffing/capacity optimization;
- full visual workflow builder or agent marketplace;
- provider parity, production Meet Media API, native Teams media bot;
- agent speech by default, silent capture, or silent provider switching;
- a separate meeting/canvas/board agent or Agent Board database;
- rich simultaneous spatial editing on mobile;
- advanced cross-agent memory or deterministic replay.

## Delivery plan

| Gate | Outcome | Estimate | Exit condition |
| --- | --- | ---: | --- |
| 0 | low-fidelity interaction prototype and human-convenience/red-team validation | 1-2 weeks | core journeys pass the convenience battery and users correctly explain ownership, state, attention, recovery |
| 1 | trust repairs and vocabulary/deep-link consistency | 1-2 weeks | no wrong-object navigation or false completion copy |
| 2 | Actor/Conversation/Run/Artifact contracts and conformance tests | 2-3 weeks | all surfaces consume one provider-neutral model |
| 3 | shell conversation, run/activity, Inbox attention loop | 4-6 weeks | durable reload/reconnect/handoff loop |
| 4 | Work delegation and artifact/Canvas semantic proposal loop | 4-7 weeks | exact provenance, staleness, undo, accessibility |
| 5 | local meeting capture and cited recap-to-work loop | 4-6 weeks | explicit consent, gaps, confirmation, proposals |
| 6 | one-shot background Run and optional external connector beta | 3-5 weeks | budget, idempotency, fallback, partial completion |

Estimates are one experienced product team and exclude the BlockSuite rejection spike already
tracked separately. Do not parallel-build Gates 3-6 before Gates 0-2 settle the model.

## Design validation gate

Before production implementation:

1. Prototype five journeys: ask, delegate, artifact proposal, meeting recap, handoff/failure.
2. Run every human-convenience battery case against at least one journey; test first use,
   returning use, team work, mobile, and assistive-technology conditions rather than treating
   one desktop power user as representative.
3. Test with at least five representative users across individual and team work, including at
   least one keyboard-only session and one narrow-screen session.
4. Include stale proposal, offline recovery, missing permission, partial transcript, noisy
   Inbox, privacy transition, agent uncertainty, and budget exhaustion—not only happy paths.
5. Measure time to first useful outcome, resume time after interruption, context switches,
   approval comprehension, recovery success, and unnecessary interruptions.
6. Record vocabulary and convenience failures and update contracts before writing migrations.

## Measurable acceptance

1. A new user can identify within 30 seconds: owned work, active agents, required decisions,
   failures, and recovery.
2. Navigation changes the context of an existing thread/run 0% of the time.
3. 100% of action links resolve the exact object or an explicit safe error.
4. UI copy has zero “created/updated/completed” claims before successful apply.
5. Version mismatch blocks apply 100% of the time and preserves the original snapshot.
6. Reload/reconnect restores each non-terminal Run without creating another Run.
7. Replaying a provider event ten times creates one canonical event/result/proposal.
8. Every applied mutation traces initiator -> agent -> Run -> proposal -> approver -> diff ->
   target revision -> cost and supports one-batch undo.
9. Unauthorized tests expose zero fields, names, snippets, notification previews, or derived
   artifacts.
10. Meeting capture is explicit; indicator appears within one second and Stop acknowledges
    within two seconds; gaps propagate to all derived output.
11. No new billable step starts after a cap; actual usage appears in the final receipt.
12. All MVP journeys are keyboard operable and non-spatial views reflow at 320px.
13. At least 80% of first-time prototype participants, with a minimum cohort of five, complete
    one grounded Ask and locate its source or object without instruction.
14. A returning participant identifies the current owner, last material change, required
    decision, and resume action within 15 seconds without rereading the full thread.
15. Low-risk read and draft journeys introduce no confirmation modal; every high-risk journey
    identifies target, audience, consequence, reversibility, and approving action before execution.
16. Round-trip navigation, reconnect, and temporary panels preserve unsent composer text, selection,
    focus target, filters, and recoverable drafts.
17. Every user-facing failure names what was preserved and offers at least one safe next action;
    raw provider or backend errors are never required to recover.
18. Repeated events for one object/Run produce one grouped attention item, and a successful
    no-change background run produces no interruptive notification.


## Product metrics

- task success and time-to-understand for the five prototype journeys;
- time to first useful outcome, interruption-resume time, and avoidable context switches;
- unnecessary confirmation rate, approval comprehension, and interruptions per material outcome;

- proposal acceptance, edit, stale, reject, and undo rates;
- wrong-context and wrong-deep-link incidents;
- runs needing human attention, time waiting, recovery success, duplicate rate;
- notification open/dismiss/mute rate and no-op silence rate;
- meeting gap, confirmation, and promoted-action rates;
- cost estimate error and budget-stop compliance;
- accessibility defects by journey, not only page.

Metrics diagnose trust and usability; they do not optimize for agent activity volume.

## Risks and controls

| Risk | Control |
| --- | --- |
| Scope becomes “build an operating system” | six primitives, one MVP loop, gated phases |
| Chat becomes truth | explicit promotion and owning-domain references |
| Approval fatigue | risk tiers, grouping, materiality, scoped policy later |
| Agent/human identity ambiguity | machine badge, human owner, initiator/delegation |
| Canvas decision delays UX | contracts and structured fallback precede editor dependency |
| Provider lock-in | Product authority plus thin adapters and economic exit gates |
| Accessibility postponed | prototype and release acceptance from Gate 0 |

## Human checkpoint

User confirmation of this experience model is required before producing the final TDD task
list or handing the issue to `/dev`. The next planning step after confirmation is low-fidelity
journey prototypes and task decomposition; it is not product implementation.
