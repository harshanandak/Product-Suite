# Meeting Experience Teardowns + Hosted-Calls Transport Research

**Date:** 2026-07-25
**Purpose:** Design input for the meeting-experience roadmap.
**Scope (revised 2026-07-25):** three fronts — (a) in-person meetings captured in-app via device mic; (b) org-member calls **hosted by us**; (c) **external Zoom/Meet/Teams meetings via the Granola pattern — on-device capture + calendar awareness, NOT bots.** Part 5 covers (c)'s integration mechanics.
**Labels:** `[verified]` = primary source (vendor docs/pricing page fetched directly) · `[claim]` = vendor marketing or secondary reporting · `[reasoning]` = my inference

---

## Part 1 — Product-experience teardowns

### 1.1 Granola

**Capture model.** No bot. Captures **system/device audio** locally and transcribes in the background; nobody on the call sees a participant join. `[claim]` — vendor page (https://www.granola.ai/ai-note-taker) and Zapier's teardown (https://zapier.com/blog/granola-ai/) both describe it this way. Users prefer it because the call "stays completely normal" — no consent friction from a visible bot, and it works in *any* audio context including in-person and Slack huddles `[claim]`.

**Core UX loop — the pattern to steal.** This is the single most important interaction design in the category:

1. During the meeting, Granola shows a **plain notepad**. You type sparse, shorthand notes — the marketing metaphor is "leaving a trail of breadcrumbs."
2. Granola records + transcribes silently in parallel. It does *not* stream AI suggestions at you mid-meeting.
3. On meeting end, it **merges your rough notes with the transcript**: your notes define *what mattered and in what structure*; the transcript supplies the detail, quotes, numbers, and names you didn't have time to write.

`[claim]` — sourced from https://techcrunch.com/2024/05/22/granola-debuts-an-ai-notepad-for-meetings and https://www.businesswire.com/news/home/20240522650474/en/. The strategic framing in their launch material is "**enhances, not replaces, your thinking**."

`[reasoning]` Why this beats pure auto-summary: a generic AI summary has no priors about what *you* cared about, so it produces evenly-weighted mush. Two words the user typed ("pricing pushback?") are an extremely high-signal relevance prior over a 60-minute transcript. It also solves the trust problem — the user recognizes their own structure in the output, so they believe the enriched parts. And it converts note-taking from a transcription chore into a *pointing* gesture, which is genuinely lower cognitive load rather than merely automated.

**Templates.** Customizable per-meeting-type templates drive the output sections (Decisions Made, Action Items, Next Steps) `[claim]` — https://www.granola.ai/blog/granola-integrations-hubspot-slack-notion-zapier.

**Action items — the weakness.** Granola extracts and attributes action items, but **has no native task-manager integration** — no Linear, Asana, or Todoist. Items stay inside Granola unless manually copied or routed through Zapier. Multiple 2026 reviews name this as the #1 complaint, described as notes "staying isolated instead of flowing into existing workflows" `[claim]` — https://summarizemeeting.com/en/app-reviews/granola-action-item-features, https://www.bluedothq.com/blog/granola-review, https://thebusinessdive.com/granola-review. Native integrations that do exist (Notion, Slack, HubSpot, Affinity, Attio) are **Business-plan-gated and configured per-destination**, and each meeting still requires choosing where output goes `[claim]`.

**Second weakness: speaker attribution.** Multiple reviewers flag that Granola "cannot reliably identify speakers in transcripts" `[claim]` — https://thebusinessdive.com/granola-review. `[reasoning]` Expected: single mixed system-audio stream means all remote participants arrive on one channel, so diarization is the only lever and it is weak (see Part 3.2).

**Pricing** `[claim]`, secondary sources, some disagreement:
- Free/Basic — $0. History-limited. Sources conflict on the exact cap: "25 lifetime meetings + 14-day history" (https://get-alfred.ai/blog/granola-pricing) vs "unlimited meetings, rolling 30-day note access" (https://www.usecarly.com/blog/granola-pricing/). **Treat the number as unverified; the *shape* — unlimited capture, paywalled history — is consistent.**
- Business — **$14/user/mo**: unlimited history, better models, Notion/Slack/HubSpot/Zapier, API.
- Enterprise — from **$35/user/mo**: SSO, org-wide training opt-out, analytics.
- Seat-based, no per-minute or per-meeting charge `[claim]`.

**Platform conflict, flagged:** reviews say "no Android app limits team adoption" `[claim]` while a Google Play listing for "Granola - AI Meeting Notes" exists (https://play.google.com/store/apps/details?id=ai.granola). `[reasoning]` Android likely shipped after those reviews. Do not rely on either claim.

**Steal list:**
1. **Notepad-first meeting view.** The during-meeting surface is a text editor, not a transcript firehose. Transcript is available but not the default focus.
2. **Notes-as-relevance-prior.** Feed user-typed notes into the summarization prompt as the section skeleton *and* the importance weighting — not as an appendix.
3. **Template = output contract**, selected per meeting type before/at start, so the enrichment step has a known target shape.

---

### 1.2 Wispr Flow

**Not a meeting tool** — it's dictation. Included because one interaction pattern transfers directly.

**Capture model.** Background desktop app (macOS/Windows, plus iOS/Android). Hold a hotkey (Fn default), speak, release; it transcribes, runs an LLM cleanup pass (strips filler, fixes grammar, formats for the target app), and pastes at the cursor `[claim]` — https://wisprflow.ai/ and https://bossai.tech/blog/wispr-flow-review.

**Command Mode.** Select existing text, hold hotkey, say "make this more formal" / "summarize in bullet points" — the AI rewrites the selection in place `[claim]`.

**Action items:** N/A — no meeting object, no extraction, no destination. Not a competitor on this axis.

**Pricing** `[claim]`: Free 2,000 words/week (~8 min dictation/day). Pro **$15/mo** monthly or **$12/mo** annual ($144/yr) — removes the word cap and unlocks Command Mode. https://weesperneonflow.ai/en/blog/2026-06-27-wispr-flow-pricing-2026/.

**Steal list:**
1. **Push-to-talk voice capture on the meeting note itself** — during an in-person meeting, holding a key to speak a note is far faster than typing, and produces exactly the Granola-style breadcrumb. This composes: voice breadcrumbs + room transcript.
2. **Select-then-command on generated notes.** After the summary exists, let the user select a section and say/type "tighten this" or "turn these into tasks." Turns the summary from a static artifact into an editable surface.
3. **The LLM-cleanup-is-invisible principle.** Users never see raw ASR output. `[reasoning]` Never show users a raw transcript as the primary artifact — raw ASR reads as broken even at high WER, and it anchors their quality judgment of the whole product on the worst-looking layer.

---

### 1.3 Otter.ai

**Capture model.** Bot/integration-based for virtual meetings, plus direct mobile recording for in-person. Has an explicit in-person positioning page (https://otter.ai/blog/ai-notetaker-for-in-person-meetings) `[claim]`.

**Core UX loop.** Live streaming transcript during the meeting (the transcript *is* the primary surface — the opposite of Granola), then AI summary after. Workspace **Channels** where you @-mention Otter to query a meeting and @-mention teammates to assign work `[claim]` — https://otter.ai/blog/best-ai-meeting-assistant.

**Action items — the strongest incumbent here, and still not board-native.** "My Action Items" is a **cross-meeting action-item inbox**: auto-identified items from all your meetings in one place, where you can access, manage, **reassign**, and check off `[claim]` — https://otter.ai/blog/streamline-workflows-with-my-action-items-otter-ai-can-now-keep-track-of-all-your-action-items-across-all-your-meetings.

**Weakness:** `[reasoning]` this is a *parallel task system* — a second inbox that competes with wherever the team actually plans work. Otter has no notion of sprint/cycle, phase, dependency, or backlog priority, so an Otter action item cannot be planned against; it can only be checked off. Users end up double-entering into their real tracker, or the Otter inbox rots. Confirmed indirectly by competitors positioning on "action item capture **and ticket filing**" as the differentiator vs Otter `[claim]` — https://www.spinach.ai/blog/otter-ai-pricing.

**Otter Meeting Agent.** Voice-activated in-meeting agent that answers questions from the org's meeting corpus and performs tasks (schedule follow-ups, draft emails) via speech. Rolling out incrementally, **Zoom-only first** `[claim]` — https://otter.ai/blog/otter-meeting-agent-your-new-collaborative-teammate.

**Pricing** `[claim]`: Free/Basic — **300 min/mo, capped at 30 min per conversation**, and only **3 lifetime** file imports. Pro **$16.99/mo** monthly, **$8.33/user/mo** annual ($99.96/yr). https://tldv.io/blog/otter-pricing/, https://www.usecarly.com/blog/otter-ai-pricing/.

`[reasoning]` The 30-min-per-conversation cap on free is the harshest limit in the category and is the thing to *not* copy — it fails exactly on the hour-long meetings that matter most, which reads as a bait-and-switch rather than a fair sample.

**Steal list:**
1. **Cross-meeting action-item inbox as a first-class destination** — the aggregation idea is right; only the terminal store is wrong.
2. **Reassign in the review surface.** Extraction gets the assignee wrong often enough that one-click reassignment must live where you triage, not in a separate edit screen.
3. **@-mention the assistant inside a threaded channel** scoped to a meeting or project — keeps Q&A over the corpus in the collaboration surface instead of a separate chat page.

---

### 1.4 Fathom

**Capture model.** Bot joins Zoom / Google Meet / Microsoft Teams `[claim]` — https://www.fathom.ai/overview.

**Core UX loop.** Recording + transcript + AI summary, with post-meeting sync out to other tools. The notable pricing/product decision: **capture is free and unlimited; intelligence is metered.**

**Action items.** Extracted, and synced natively to **HubSpot and Salesforce** (Business tier), plus Slack, Notion, Asana `[claim]` — https://www.fathom.ai/overview.

**Weakness.** `[reasoning]` Fathom is CRM-shaped, not board-shaped: it is optimized for pushing meeting context onto a *Contact/Deal* record for sales teams. It has no first-class model of engineering/product work, so an action item becomes an activity log entry or a note on a deal rather than a plannable unit of work. Second, hard weakness: the free tier caps **AI summaries at the first 5 calls per month** while recording stays unlimited `[claim]` — https://get-alfred.ai/blog/fathom-pricing. That means a free user's 6th meeting produces a recording they have to *watch*, which is worse than no product.

**Pricing** `[claim]` — https://tldv.io/blog/fathom-cost/, https://www.claap.io/blog/fathom-pricing:
- Free: unlimited recording/transcripts/storage; **AI summaries capped at 5 calls/mo**.
- Premium **$20/mo** ($16 annual) — unlimited summaries.
- Team **$19/user/mo** ($15 annual, 2-user minimum) — admin controls.
- Business **$34/user/mo** ($25 annual) — Salesforce + HubSpot sync.
- 90-day money-back guarantee on paid tiers `[claim]`.

**Steal list:**
1. **Free = unlimited capture, metered intelligence.** `[reasoning]` This is the right free-tier axis for us and it's cheap: capture costs us storage + ~$0.03/hr STT (Part 2.3), while summarization is the LLM spend. Users perceive "never lose a meeting" as generous, and the paywall lands on the thing that actually costs money. Strictly better than Otter's minute cap. But do **not** copy the 5-summary cliff — meter the *depth* (e.g. basic summary always, chapters/insights/promote-loop paid) rather than cutting summaries off entirely.
2. **90-day money-back** as a trust device for a product whose value is only provable after weeks of accumulated meetings.

---

### 1.5 Circleback

**Capture model.** Bot joins Zoom, Google Meet, Teams `[claim]`. 100+ languages `[claim]` — https://circleback.ai/.

**Core UX loop.** Structured notes (key points, decisions, action items) + search across meetings, and **automations** as the headline feature.

**Action items — the best competitor on this axis, and the closest thing to a threat.** Circleback's automations are conditional and destination-aware: e.g. "identify feature requests raised in product demo calls and **create a Linear task for each**," or "update the CRM with customer details after a sales call" `[claim]` — https://dynamicbusiness.com/ai-tools/circleback-ai-powered-meeting-notes-and-action-items.html. Integrations: Zapier, Slack, Notion, HubSpot, Salesforce, email `[claim]`.

**Weakness.** `[reasoning]` It's still **fire-and-forget outbound writes into someone else's system**. Once the Linear issue is created, Circleback has no view of it — no round-trip. It cannot tell you which meeting-born tasks actually shipped, cannot dedupe against an existing open issue for the same request, cannot show the item's current status next to the decision that created it, and cannot reconcile when a human edits or closes the task. Every automation is a one-way push with no reconciliation, so precision errors become somebody's manual cleanup in a tracker Circleback can't see. Also: no free tier at all, so there is no zero-cost on-ramp `[claim]`.

**Pricing** `[claim]`: Individual **$20.83/user/mo**, Team **$25/user/mo**, 7-day trial, **no free/freemium tier** — https://circleback.ai/pricing, https://www.trustradius.com/products/circleback-ai/pricing.

**Steal list:**
1. **Conditional, rule-based automations** ("when a feature request appears in a call tagged X → create work item in Y") rather than a single global "send action items to Z" toggle.
2. **Automation authored in natural language**, evaluated against the transcript — the extraction target is user-defined, not a fixed schema.
3. **Search across the whole meeting corpus** as a top-level surface, not a per-meeting find.

---

### 1.6 Limitless

**Status first — this materially changes how to read it.** In **December 2025** Limitless stopped selling the Pendant, and the service became unavailable in the EU, UK, and Brazil, following **Meta's acquisition** of Limitless; existing users continue to be supported `[claim]` — https://agent-finder.co/reviews/limitless, https://www.omi.me/blogs/ai-note-takers/limitless-pendant-alternatives. `[reasoning]` Treat Limitless as a **UX reference and a cautionary tale, not a competitor.** The regional shutdowns are the tell: always-on ambient capture collides with EU/UK consent law, and that is the *same* legal surface our in-person device-mic capture sits on.

**Capture model.** Wearable pendant, always-on ambient capture of the user's whole day — in-person meetings, hallway conversations, personal thoughts `[claim]`. Consent handling: users are required to notify participants, and there's a **visible LED indicator** when recording `[claim]` — https://www.smartaiwearables.com/privacy-focused-conversation-capture-limitless-ai-pendant/.

**Core UX loop.** Not meeting-centric at all — a continuous searchable personal memory you query on demand ("what did X say about the deadline?") rather than a per-meeting artifact `[claim]`.

**Action items.** `[reasoning]` Effectively nowhere. Ambient capture with no meeting boundary means no natural moment to produce and review a commitment list, and no way to know which utterances were decisions vs speculation. This is the category's clearest demonstration that **capture without a review-and-commit moment produces zero downstream work.**

**Pricing** `[claim]`: hardware **$99** with a free tier; Pro **$19/mo**; Pendant + Unlimited bundle **$299** (from $399) — https://www.limitless.ai/, https://moelueker.com/blog/limitless-ai-pendant-review-5-use-cases-worth-199.

**Steal list:**
1. **Visible, unmistakable recording indicator** — for in-person capture this is a legal and social requirement, not a nicety. Ours must be visible on the *device screen in the room*.
2. **Ask-across-everything retrieval** rather than only per-meeting summaries.
3. **The negative lesson:** always-on capture is a legal liability *and* produces less actionable output than bounded sessions. Keep our in-person capture explicitly session-bounded with a clear start/stop.

---

### 1.7 "Metlky"/"Meetly" — identification

No product named **"Metlky"** exists in this space `[verified — searched, no results]`. The closest matches, and almost certainly what was meant:

**Meetily (branded "Meetly AI")** — https://meetily.ai/, https://github.com/Zackriya-Solutions/meetily. Open-source, privacy-first, self-hosted AI meeting assistant built in **Rust**. Local **Parakeet/Whisper** live transcription (claims 4x faster), **speaker diarization**, and **Ollama** summarization — **100% local, no cloud required** `[claim]`. Community Edition free and open-source forever; **Pro from $10/user/mo** billed annually `[claim]`. Positions itself explicitly as the Otter/Granola alternative.

**Meetly (separate iOS app)** — https://apps.apple.com/us/app/meetly-private-ai-voice-notes/id6747639933. On-device record/transcribe/summarize for meetings, lectures, interviews; audio never leaves the iPhone; and notably you can **connect Claude, ChatGPT, or any MCP-compatible agent to your meeting notes** to query them `[claim]`.

`[reasoning]` Two things worth noting. First, Meetily proves fully-local capture + diarization + summarization is achievable on consumer hardware — which caps how much we can charge for the *transcription* layer and confirms the durable value is in what happens to the output, not the ASR. Second, Meetly's **MCP endpoint over meeting notes** is a genuinely differentiated interaction we should consider: exposing the meeting corpus to the user's own agent, rather than only to our in-app assistant.

---

### 1.8 Competitor weakness summary — where the board-native promote loop wins

| Product | Where action items end up | Structural weakness we exploit |
|---|---|---|
| Granola | Stay in Granola; manual copy or Zapier | **No task integration at all.** Notes are a dead-end artifact. |
| Otter | "My Action Items" inbox inside Otter | **Parallel task system** with no cycle/phase/dependency — checkable, not plannable. |
| Fathom | CRM (HubSpot/Salesforce), Slack, Notion, Asana | **CRM-shaped**: an activity on a Deal, not a unit of work. Free tier dies at 5 summaries. |
| Circleback | Auto-created Linear/CRM records | **One-way push, no reconciliation.** No round-trip status, no dedupe, no visibility after write. |
| Limitless | Nowhere | **No bounded session → no review-and-commit moment.** |
| Meetily | Local notes | Self-host burden; no work-management layer at all. |

**The exploit** `[reasoning]`: every competitor treats the task tracker as an *external* system it writes into and then loses sight of. We own the board. That makes three things possible that none of them can copy without building a work-management product:

1. **Review-and-promote, not auto-push.** Extracted candidates land in a review surface; the user promotes them into real work items with assignee, phase, and cycle in one gesture. This converts extraction *precision* from a liability (their problem: a wrong auto-created Linear issue is somebody's cleanup) into a non-issue (ours: an unpromoted candidate costs nothing).
2. **Round-trip provenance.** The work item retains a link to the meeting, the chapter, and the transcript span that produced it — so "why does this task exist" is answerable, and the meeting page can show live status of everything it spawned. Nobody in this list can render that view.
3. **Dedupe and reconcile against the existing backlog.** Because the board is local, an extracted item can be matched against open work before it's created — surfacing "this is already issue #412" instead of creating the duplicate.

---

## Part 2 — Hosted-calls transport

### 2.1 LiveKit today

**Cloud plans** `[verified]` — https://livekit.io/pricing, https://livekit.io/pricing.md:

| | Build | Ship | Scale | Enterprise |
|---|---|---|---|---|
| Price | $0 | from **$50/mo** | from **$500/mo** | custom |
| WebRTC minutes | 5,000 incl. | 150,000 incl., then **$0.0005/min** | 1.5M incl., then **$0.0004/min** | custom |
| Concurrent connections | 100 | 1,000 | 5,000 | custom |
| Downstream data transfer | 50 GB incl. | 250 GB, then **$0.12/GB** | 3 TB, then **$0.10/GB** | custom |
| Agent session minutes | 1,000 incl. | 5,000, then **$0.01/min** | 50,000, then $0.01/min | custom |
| Concurrent agent sessions | 5 | 20 | up to 600 | custom |
| Agent session recordings | 1,000 min | 5,000, then **$0.005/min** | 50,000 | custom |

Billing is **per-participant-minute** ("time an end user spends connected to our network via WebRTC"), not per-room `[verified]`. Important gotcha: **"Self-hosted agents count against WebRTC participant minutes"** `[verified]` — running your own agent process does not exempt you from LiveKit Cloud connection billing.

**Egress costs** `[verified]`:
- **Transcode minutes** (RoomComposite + Participant egress): 60 incl. (Build) / 600 then **$0.02/min video, $0.005/min audio-only** (Ship) / 8,000 then $0.015 video, $0.004 audio-only (Scale).
- **Track egress** (raw single-stream, no transcoding): 60 / 600 then **$0.001/min** / 8,000 then $0.001/min.

**Egress types** `[verified]` — https://docs.livekit.io/home/egress/overview/: RoomComposite (whole room via a **Chrome-rendered web layout**), Web (any page), Participant, TrackComposite, and **Track egress** — whose documented use case is explicitly *"streaming audio tracks to captioning services via WebSocket."* Egress is zero-config on Cloud; **self-hosting requires deploying egress separately** `[verified]`.

`[reasoning]` For our audio-only transcript pipeline, **Track egress at $0.001/min is the right primitive** — 20x cheaper than audio-only RoomComposite transcode, and it avoids spinning up a headless Chrome per meeting. RoomComposite exists for human-watchable recordings, which we don't need for transcription.

**Agents framework** `[verified]` — https://docs.livekit.io/agents/: Python and Node.js SDKs let any program join a room as a full realtime participant. Ships an **STT–LLM–TTS pipeline**, **state-of-the-art turn detection** (their own model), interruption handling, tool use with frontend tool-call forwarding, multi-agent handoff, voice/video/text modalities, and built-in server orchestration + load balancing + Kubernetes compatibility. Fully open source. There's also a no-code Agent Builder.

**STT plugin coverage via LiveKit Inference** `[verified]`, Build/Ship per-minute: Deepgram Nova-3 mono **$0.0048**, Nova-3 multilingual $0.0058, Deepgram Flux $0.0065, AssemblyAI Universal-Streaming **$0.0025**, Cartesia Ink Whisper **$0.0030**, Speechmatics Standard $0.0050, xAI $0.0033, ElevenLabs Scribe v2 Realtime $0.0105. (Scale tier is ~10-15% cheaper.)

**Reference full-agent cost** `[verified]` from their own calculator: **$0.0672/min** total for a phone-connected voice agent = agent session $0.01 + telephony $0.01 + LLM $0.0014 + STT $0.0058 + TTS $0.03 + observability $0.01. `[reasoning]` TTS dominates. A *listening-only* transcription agent with no TTS and no LLM is ~$0.0158/min ≈ **$0.95/hr** — which is 30x the raw STT cost, i.e. the agent-session and observability line items are the real expense, not the transcription.

**Self-host reality** `[claim]`, multiple secondary ops guides — https://fazliev.com/blog/livekit-production-guide, https://prodinit.com/blog/self-hosted-livekit-production-guide, https://celloip.com/blog/self-hosted-livekit-deployment-guide/:
- Single node needs no external dependencies; **Redis is required for any multi-node deployment**, holding room/participant/node state so joiners land on the node hosting the room.
- **TURN is not optional**: 20–40% of real-world network conditions sit behind symmetric NAT or restrictive firewalls; ~10–20% of enterprise sessions actually relay. Needs TURN/TLS on 5349 with real certificates.
- Most common production failure: **UDP port range not exposed** in security groups.
- Estimated ongoing burden: **~20% of one engineer** ≈ $16k–$30k/yr in personnel cost.

`[reasoning]` For an org-calls feature that is not our core product, self-hosting an SFU is clearly the wrong trade — the personnel cost alone exceeds any plausible managed-transport bill at our scale.

### 2.2 Integration fit with our stack

**LiveKit Agents cannot run on Cloudflare Workers.** `[verified]` Two independent confirmations: (a) the agents deployment docs state agents "are ready to deploy to any container orchestration system such as Kubernetes," using a worker-pool model where "agent servers themselves spawn a new sub-process for each job" — a container/process model Workers does not provide (https://docs.livekit.io/deploy/custom/deployments/); (b) LiveKit's own tracked issue **livekit/node-sdks#273, "@livekit/rtc-node is not compatible with Cloudflare Workers"** — Workers doesn't support the native binary extensions the WebRTC client needs (https://github.com/livekit/node-sdks/issues/273).

**Minimal extra runtime if we choose LiveKit** `[reasoning]`: a container platform for the agent pool. One mitigating detail from the docs `[verified]`: "agent servers do not need to expose any inbound hosts or ports to the public internet" — they dial out over a WebSocket to register and receive jobs. That means a plain outbound-only container (Fly.io / Cloud Run / Railway / ECS) suffices; no load balancer, no ingress, no public IP. Optional health endpoint on `:8081`.

**But we may not need an agent at all in v1** `[reasoning]`: if we only want a transcript, **Track egress → our storage → batch STT** avoids the agent runtime entirely and is callable from Workers (start egress = a REST call; completion = a webhook). The agent process is only required for *in-meeting realtime* behavior. This is the key architectural fork.

**Clerk → room tokens.** `[reasoning]` This works on Workers for both candidates and is not a differentiator. LiveKit access tokens are HS256 JWTs; signing one needs Web Crypto (via `jose` or `cloudflare-worker-jwt`) — the *server* SDK's token path is pure crypto, and only `@livekit/rtc-node` (the WebRTC client) carries the incompatible binary deps `[verified for rtc-node; reasoning for the token path]`. RealtimeKit is simpler still: meetings and participant auth tokens are created over its **REST API** (https://developers.cloudflare.com/realtime/realtimekit/), so a Worker needs nothing but `fetch`. Either way the pattern is: Clerk session → verify org membership server-side → mint a room token scoped to that meeting → never let the client name its own room.

**Audio → STT pipeline.** Confirmed cheap on our chosen path `[verified]` — https://developers.cloudflare.com/workers-ai/platform/pricing/:
- `@cf/openai/whisper-large-v3-turbo` — **$0.0005 per audio minute** (46.63 neurons/audio-min) = **$0.03/hr**. Confirms the assumed figure exactly.
- `@cf/openai/whisper` — $0.0005/audio-min.
- `@cf/deepgram/nova-3` — $0.0052/audio-min batch; **$0.0092/audio-min over WebSocket**.
- `@cf/deepgram/flux` (WebSocket) — $0.0077/audio-min.
- `@cf/pipecat-ai/smart-turn-v2` — $0.00034/audio-min (turn detection, if we ever build our own realtime loop).
- Workers AI: **$0.011 per 1,000 Neurons**, 10,000 Neurons/day free on both Free and Paid plans.

`[reasoning]` Whisper-turbo at $0.03/hr is **10x cheaper than Deepgram Nova-3 batch on the same platform** and ~17x cheaper than Nova-3 over WebSocket. Since our existing pipeline is batch (`transcript_segments` → `chapter_summaries` → `action_items` — entities confirmed present in `infra/supabase/migrations/20260606093937_create_meeting_schema.sql`), keeping hosted calls on the *batch* path preserves that cost advantage. The moment we go realtime-streaming we lose it, because whisper-turbo isn't a streaming model — that's the hidden cost of realtime, not the agent runtime.

### 2.3 Alternatives — and Cloudflare is the surprise winner

**Cloudflare RealtimeKit** `[verified]` — https://developers.cloudflare.com/realtime/realtimekit/pricing/. **Currently in Beta and free.** Published GA pricing:

| Feature | Price |
|---|---|
| Audio/Video participant | $0.002/min |
| **Audio-only participant** | **$0.0005/min** |
| Export (recording, RTMP, HLS) | $0.010/min |
| Export, audio-only | $0.003/min |
| **Export (Raw RTP) into R2** | **$0.0005/min** |
| Real-time transcription | standard Workers AI model pricing |

Audio-only vs A/V is determined by the **`Meeting Type` of the participant's preset** `[verified]`. Product surface: UI Kit (pre-built components) + Core SDK, on top of Realtime SFU, with **REST APIs for meetings/participants/recordings and server-side webhooks** `[verified]`. Explicitly lists **audio-only calls** as a first-class use case.

**Cloudflare Realtime SFU / TURN (low-level)** `[verified]` — https://developers.cloudflare.com/realtime/sfu/pricing/: **$0.05/GB** egress, **1,000 GB free tier shared between SFU and TURN**. Only Cloudflare→client traffic is billed; **pushing to Cloudflare is free**, and SFU↔TURN traffic isn't double-charged. But: "**High** effort to get started — requires deep WebRTC knowledge, **no SDK provided**, you manage sessions, tracks, and presence protocol" `[verified]`. `[reasoning]` Not a candidate for us; RealtimeKit is the same network with the hard parts done.

**Daily** `[verified]` — https://www.daily.co/pricing/video-sdk/: **10,000 free min/mo**. Video+audio **$0.0015–$0.004** per participant-min (volume-banded); **audio-only $0.00036–$0.00099** per participant-min. Cloud video recording **$0.01349**/recorded min + **$0.003**/min storage; **audio-only recording $0.005**/min; RTMP $0.015/min; HLS $0.03/min. Critical gotcha `[verified]`: the audio-only rate is "applied automatically when a session has no video tracks. **If any video track (camera or screenshare) is sent even once, the session bills at the video rate.**" `[reasoning]` That's a 4x cliff triggered by one accidental screenshare — a real budgeting hazard for a product where screensharing is a natural thing to want.

**100ms** `[claim]`, secondary only — audio-only **$0.001**/participant-min, video **$0.004**; 10,000 free conferencing min/mo + 10,000 streaming + 1,000 encoding min (https://www.100ms.live/blog/video-call-api-pricing, https://www.buildmvpfast.com/alternatives/livekit). Roughly 2x RealtimeKit on audio, no CF-native advantage. Not compelling for us.

**Head-to-head: 5 participants, 60-minute audio-only call, transcript produced** `[reasoning]`, computed from the verified rates above:

| | Participant cost | Egress→STT path | Egress cost | STT (whisper-turbo) | **Total/call** | Platform floor |
|---|---|---|---|---|---|---|
| **CF RealtimeKit** | 5×60×$0.0005 = $0.15 | Raw RTP → **R2** | 60×$0.0005 = $0.03 | $0.03 | **$0.21** | $0 (free in beta) |
| LiveKit (Ship, past allotment) | 5×60×$0.0005 = $0.15 | Track egress → our storage | 60×$0.001 = $0.06 | $0.03 | **$0.24** | **$50/mo** |
| LiveKit (audio RoomComposite) | $0.15 | Transcode egress | 60×$0.005 = $0.30 | $0.03 | $0.48 | $50/mo |
| Daily (low volume) | 5×60×$0.00099 = $0.297 | Audio-only recording | 60×$0.005 = $0.30 | $0.03 | **$0.63** | $0 (10k free min) |
| 100ms `[claim]` | 5×60×$0.001 = $0.30 | recording | n/a | $0.03 | ~$0.33+ | $0 (10k free min) |

Three conclusions `[reasoning]`:
1. **STT is a rounding error** ($0.03/hr). Transport and egress dominate by 10x. Optimizing the STT provider further is wasted effort; optimizing the egress *type* is where the money is.
2. **RealtimeKit wins on price, and wins bigger on architecture**: Raw-RTP-into-R2 lands audio **directly in our own object store on the same platform as our Workers backend**, so the pickup is an R2 event → Worker → Workers AI, with no cross-cloud transfer, no second runtime, and no egress bandwidth bill. LiveKit's Track egress is comparably cheap but terminates in *our* configured storage from *their* network, and carries the $50/mo Ship floor to get usable allotments.
3. **Daily is the most expensive** and carries the screenshare-cliff hazard; its only edge is a genuinely generous 10k free minutes for early testing.

**The RealtimeKit risk, stated plainly** `[verified + reasoning]`: it is **in Beta** (docs page last updated 2026-07-22). GA pricing is published, which is a strong signal of intent, but beta means no SLA, possible API churn, and no guarantee the published rates survive to GA. `[reasoning]` The mitigation is structural rather than contractual: our **v1 doesn't need hosted calls at all** (Part 3 in-person capture + the existing bridge covers it), so RealtimeKit can mature during exactly the window when we're not depending on it. If it's still beta when we need hosted calls, LiveKit Ship at ~$0.24/call + $50/mo is a fine fallback — and both are reachable behind one interface (see rec #8).

### 2.4 Realtime assistant later (v2)

**What LiveKit Agents buys us** `[verified]`: a production STT–LLM–TTS pipeline with their own turn-detection model, interruption handling, multi-agent handoff, tool calls forwardable to the frontend, and built-in load balancing — plus a large plugin ecosystem so the STT/LLM/TTS choices stay swappable. `[reasoning]` This is genuinely a year of work to reproduce. If in-meeting live AI becomes a headline feature, LiveKit Agents is the credible path and RealtimeKit is not — CF gives you the *ingredients* (real-time transcription at Workers AI rates, `smart-turn-v2` at $0.00034/audio-min) but you assemble the conversation loop yourself.

**Cost of keeping the option open in v1** `[reasoning]` — low, if we spend it deliberately:
1. **Put the room provider behind an interface** with four operations: `createRoom`, `mintParticipantToken`, `startAudioExport`, `onExportComplete`. Both providers satisfy it.
2. **Normalize the ingest boundary.** Provider webhooks land in a thin adapter that emits *our* canonical audio-ready event; nothing downstream of `transcript_segments` learns the provider's payload shape. This is the one place where skipping the abstraction would be genuinely expensive later.
3. **Keep the transcript write path idempotent and append-friendly**, keyed on (meeting, segment start). Batch STT writes segments in one pass; a realtime agent writes them incrementally. If the schema tolerates both, v2 is additive rather than a migration.
4. **Do not** build a container platform, adopt Python service infra, or pre-integrate the Agents SDK now. Deferring that costs nothing given the interface above.

`[reasoning]` Cost of *not* doing 1–3 and coupling the pipeline to RealtimeKit's webhook shape: a v2 provider swap becomes a rewrite of the ingest layer. Cost of doing them: roughly one adapter module.

---

## Part 3 — In-person capture UX hardening

### 3.1 Long-recording web/mobile capture

Concrete failure modes, from primary/vendor bug trackers `[claim]` where they're forum reports:

**MediaRecorder chunk explosions.** If the machine sleeps mid-recording and wakes, you get two extra `ondataavailable` calls, one carrying an enormous chunk — which will blow past server message-size limits (the cited case: socket.io's 1 MB default `maxHttpBufferSize`) `[claim]` — https://blog.addpipe.com/dealing-with-huge-mediarecorder-slices/. WebKit has a tracked bug for huge chunks on pause/resume on macOS **and iOS**: https://bugs.webkit.org/show_bug.cgi?id=279432 `[verified as a filed WebKit bug]`.

**iOS Safari long-recording instability.** Recordings of a minute or more have been reported to make the page reload with a generic error, attributed to iOS resource pressure; `onstop` is reported as unreliable on iOS `[claim]` — https://developer.apple.com/forums/thread/694867, https://developer.apple.com/forums/thread/662277, https://developer.apple.com/forums/thread/694207.

**Background-tab behavior — the one piece of good news.** `setInterval` is throttled/stopped when Safari is backgrounded on iOS, **but MediaRecorder callbacks continue to fire**, letting a page keep uploading for roughly 1–2 hours while backgrounded `[claim]` — https://www.buildwithmatija.com/blog/iphone-safari-mediarecorder-audio-recording-transcription. `[reasoning]` This is the load-bearing design constraint: **never drive the upload loop from a timer.** Drive it from the `ondataavailable` event itself, which survives backgrounding. A timer-driven uploader will silently stall the moment the user switches apps — and switching apps mid-meeting is the norm, not the exception.

**Wake Lock.** `navigator.wakeLock.request('screen')` requires a **visible** page — a background tab is always rejected. Supported from **iOS Safari 16.4+**, with a long-standing bug that broke it in installed PWAs until **iOS 18.4** `[claim]` — https://progressier.com/pwa-capabilities/screen-wake-lock, https://www.telerik.com/blogs/optimizing-web-applications-using-screen-wake-lock-api. The lock auto-releases on minimize/navigate-away, so the correct pattern is: feature-detect → request from a visible page → hold the sentinel → listen for `release` → **re-acquire on `visibilitychange` back to visible** — all wrapped in try/catch, since denial is normal `[claim]`.

**Chunked upload with resume.** Resume requires server-side **range request** support (serve/accept from byte N rather than restarting at 0). On iOS/iPadOS, resumption is possible but *not guaranteed*, particularly for large files on flaky networks `[claim]` — https://www.positioniseverything.net/how-to-resume-an-interrupted-download-in-any-browser/, plus Apple's own guidance on resumable transfers (https://developer.apple.com/videos/play/wwdc2023/10006/, https://developer.apple.com/documentation/foundation/pausing-and-resuming-uploads).

`[reasoning]` **The design that follows from all of the above** — and it maps unusually well onto R2:
- Record in **short timeslices** (`start(timeslice)` at ~5–15s), never one long blob. Short slices bound the sleep/wake chunk-explosion damage, keep each upload under any body limit, and give per-slice retry granularity.
- **Upload per slice, keyed by (session, sequence)**, into R2. Idempotent by key, so a retry after an ambiguous failure is free and resume is just "which sequence numbers are missing" — no range requests, no resumable-upload protocol, no reliance on iOS honoring one.
- **Persist unsent slices to IndexedDB** before attempting upload; drain the queue on reconnect and on `visibilitychange`. This is the offline buffer, and it's also the crash-recovery story for the iOS page-reload bug — a reload finds its unsent slices still queued.
- **Never treat `onstop` as the commit signal.** Finalize server-side: the session is complete when the client posts an explicit finalize (with expected sequence count), or after an inactivity timeout. Then stitch and transcribe.
- **Wake Lock while visible**, re-acquired on focus, and a visible in-room recording indicator (per Limitless's consent lesson) that doubles as the "still recording" reassurance.
- `[reasoning]` Prefer a **thin native/PWA path on mobile** for meetings expected to run over ~30 minutes; the accumulated iOS Safari MediaRecorder reports make long web recordings on iPhone the least reliable configuration in the whole design.

**What Granola/Otter mobile do** — I could not verify their client implementations from public sources `[verified: no primary source found]`. What's documented: Granola is on Mac, Windows, and iPhone, captures **system audio** rather than only mic (which is how it covers both in-person and any calling app), and phone-call transcription is iPhone-only `[claim]`. Otter markets in-person capture via mobile recording explicitly `[claim]`. `[reasoning]` Both being native apps rather than web is itself the signal: the constraints in this section are precisely why. Do not read their reliability as achievable from a browser tab.

### 3.2 Diarization for single-mic room audio

**Open-source state** `[claim]`, secondary benchmark aggregation — https://novascribe.ai/what-is-speaker-diarization, https://novascribe.ai/whisper-diarization, https://vexascribe.com/pyannote-audio:
- **pyannote.audio 3.1** (MIT, Nov 2023): ~**11% DER** on the AMI meeting benchmark.
- **WhisperX** = faster-whisper + pyannote 3.1, adds word-level timestamps (sub-100ms); inherits **11–19% DER** across standard benchmarks.
- **Commercial APIs** (Deepgram, AssemblyAI, Rev): **8–14% DER** on comparable meeting audio.

**The structural limitation, and it matters for us** `[claim → reasoning]`: Whisper transcribes only the **dominant voice** in overlapping speech, and while pyannote can *flag* overlap regions, the word→speaker assignment step can only assign **one speaker per word**. So crosstalk isn't merely degraded — it's silently lost, with the interjection either dropped or misattributed to whoever was louder. `[reasoning]` In-person meetings have far more overlap than remote ones (no push-to-talk discipline, no network-induced turn-taking), so **in-person single-mic is the hardest diarization case there is**, not the easiest.

**Hosted alternative — Deepgram** `[claim]`, secondary; Deepgram's own pricing page confirms Speaker Diarization is listed as a **Speech-to-Text add-on** rather than included `[verified from https://deepgram.com/pricing]`:
- Nova-3 **batch $0.0043/min**, **streaming $0.0077/min**.
- **Diarization is a separate add-on at ~$0.0020/min** → ~**$0.0063/min** batch with diarization ≈ **$0.38/hr**.
- $200 free credit, no minimums, PAYG. Sources: https://convertaudiototext.com/blog/deepgram-nova-3-explained, https://brasstranscripts.com/blog/deepgram-pricing-per-minute-2025-real-time-vs-batch.
- Note: Cloudflare resells `@cf/deepgram/nova-3` at **$0.0052/audio-min** on Workers AI `[verified]` — but I found **no confirmation that CF's resold endpoint exposes the diarization add-on**. Treat diarized-Deepgram-via-Workers-AI as unverified and check before designing around it.

`[reasoning]` **Realistic expectations to set with the architect** — and the cost delta is the whole argument:
- 2–3 speakers, quiet room, decent mic: usable. Names mostly right, some boundary errors at turn transitions.
- 4+ speakers, or any crosstalk/panel dynamic: **do not promise reliable attribution.** 11% DER means roughly one word in nine carries the wrong speaker label, and errors cluster exactly at the interesting moments (disagreement, rapid exchange).
- Granola — a well-funded team on this exact problem — is publicly criticized for unreliable speaker ID `[claim]`. That's the calibration point: this is not a gap we out-engineer, it's a constraint we design around.
- **The cost picture makes the decision easy**: whisper-turbo with no diarization is **$0.03/hr**; Deepgram batch + diarization is **~$0.38/hr** — a **12x** increase for a feature that still fails on hard audio. `[reasoning]` So: ship v1 **without** diarization on in-person audio, make speaker labels a per-meeting opt-in that visibly costs something, and design the UI so attribution is *decorative* — an unlabeled or wrongly-labeled quote must never break the summary, the chapters, or an action item. Correspondingly, **do not use ASR speaker labels to set action-item assignees**; use them only as a *suggestion* in the review surface, where the promote loop already has a human confirming (see rec #1). That single decision makes 11% DER survivable.

---

## Part 4 — Ranked recommendations

Ranked by user-visible value ÷ build cost. **v1** = works with the current batch pipeline (`transcript_segments` → `chapter_summaries` → `action_items`) + existing bridge; **v2** = hosted calls / realtime.

### v1

**1. Board-native review-and-promote loop for action items.** *(highest value, moderate cost — build this first)*
Extracted action items land in a review surface as *candidates*; one gesture promotes a candidate into a real work item with assignee, phase, and cycle, retaining a link back to the meeting/chapter/transcript span. Evidence: this is the only axis where every competitor is structurally weak — Granola has **no** task integration at all `[claim]`, Otter's inbox is a parallel non-plannable system, Fathom writes to CRM records, and Circleback's auto-created Linear issues are **one-way pushes with no reconciliation** `[claim]`. Review-before-promote also converts extraction precision from a liability into a non-issue, which is what makes it shippable on top of imperfect transcripts.

**2. Granola's notes-as-relevance-prior, applied to in-person capture.** *(high value, low cost)*
During capture, show a **notepad**, not a transcript. Feed the user's typed/spoken breadcrumbs into summarization as both the section skeleton and the importance weighting. Evidence: it is the pattern Granola's entire launch positioning rests on ("enhances, not replaces, your thinking") `[claim]` and the reason its output feels personalized rather than generic. Cost is a prompt-shape change plus one editor surface — we already have the transcript and the summarizer.

**3. Slice-and-queue capture pipeline (5–15s slices → R2 → IndexedDB backlog, event-driven not timer-driven).** *(high value, low-moderate cost — and it's a correctness fix, not a feature)*
Evidence: `setInterval` stops when iOS Safari backgrounds but **MediaRecorder callbacks keep firing** `[claim]`, so a timer-driven uploader silently stalls whenever the user switches apps; sleep/wake produces oversized chunks (WebKit bug 279432) `[verified as filed`]; iOS long recordings can reload the page and `onstop` is unreliable `[claim]`. Short idempotent slices keyed by (session, sequence) make retry, resume, and crash-recovery all the same mechanism, and sidestep iOS's unreliable resumable-upload behavior entirely. Skipping this means losing whole meetings — the one failure users never forgive.

**4. Free = unlimited capture, metered intelligence.** *(high value, near-zero cost)*
Evidence: Fathom's free tier is unlimited recording with AI capped at 5 calls/mo `[claim]`; Otter's free tier caps **300 min/mo at 30 min per conversation** `[claim]`, which fails precisely on hour-long meetings. Capture costs us storage + **$0.03/hr** STT `[verified]`, so "never lose a meeting" is a nearly free generosity signal while the paywall sits on actual LLM spend. Meter *depth* (chapters, insights, promote loop) rather than cutting summaries off at a cliff.

**5. Server-authoritative session finalize + visible recording indicator.** *(moderate value, low cost)*
Never trust client `onstop` `[claim]`; finalize on explicit client post (with expected slice count) or inactivity timeout, then stitch and transcribe. Pair with an unmistakable in-room recording indicator — Limitless shipped a hardware LED and *still* required participant notification, then had its service withdrawn from the EU/UK `[claim]`. For in-person capture this is the consent surface, not decoration.

**6. Ship v1 without diarization; speaker labels as opt-in decoration, never as assignee source.** *(high value as a *scoping* decision, negative cost)*
Evidence: pyannote 3.1 ≈ **11% DER** on AMI, WhisperX 11–19%, commercial 8–14% `[claim]`; word→speaker assignment can only pick **one speaker per word**, so in-person crosstalk is silently lost `[claim]`; and whisper-turbo at **$0.03/hr** vs Deepgram batch + diarization add-on at **~$0.38/hr** is a **12x** cost step `[verified rates]` for something Granola still gets criticized for `[claim]`. Design so a wrong or missing speaker label degrades nothing — and let the promote loop's human confirmation absorb attribution error instead of a model.

**7. Natural-language automation rules over the meeting corpus + corpus-wide search.** *(moderate-high value, moderate cost)*
Circleback's differentiator is conditional rules like "identify feature requests in demo calls → create a Linear task each" `[claim]`. Ours composes with rec #1: the same rules target *our* board, so they can dedupe against open work and show round-trip status — the reconciliation Circleback structurally cannot do. Sequence after #1.

**8. Room-provider interface + normalized ingest boundary, built now, unused until v2.** *(moderate value, low cost — cheap insurance)*
Four operations (`createRoom`, `mintParticipantToken`, `startAudioExport`, `onExportComplete`) plus a thin webhook adapter emitting our canonical audio-ready event, and an idempotent append-friendly transcript write keyed on (meeting, segment start). Evidence: RealtimeKit is **in Beta** `[verified]` and LiveKit Agents **cannot run on Workers** (livekit/node-sdks#273; container/subprocess worker-pool model) `[verified]` — so the provider decision will get revisited. Coupling ingest to one provider's webhook shape turns a later swap into a rewrite; this interface makes it additive.

**9. Push-to-talk voice breadcrumbs + select-then-command editing on the summary.** *(moderate value, low-moderate cost)*
Wispr Flow's hold-hotkey → transcribe → LLM-cleanup → insert loop `[claim]`, retargeted at the meeting note: in a room, speaking a breadcrumb beats typing one, and it feeds rec #2 directly. The select-then-command half makes the generated summary editable by instruction ("turn these into tasks") rather than static.

### v2

**10. Hosted org calls on Cloudflare RealtimeKit, audio-only, Raw-RTP export → R2 → Workers AI batch STT.** *(high value, moderate cost — but only once RealtimeKit's beta status is acceptable)*
Evidence `[verified]`: audio-only participant **$0.0005/min**, **Raw RTP export into R2 $0.0005/min**, free during beta, REST + webhooks callable straight from Workers, and audio-only calls are a documented first-class use case. Computed all-in for a 5-person 60-min call with transcript: **~$0.21** vs LiveKit Ship **~$0.24 + $50/mo floor** vs Daily **~$0.63** `[reasoning, from verified rates]`. The decisive factor isn't the price though — it's that **no second runtime is required**, whereas LiveKit's listening agent needs a container platform. Audio lands in our own R2 on the same platform as our Workers and existing batch pipeline. Risks to hold: Beta means no SLA and possible GA-price change; Daily's audio-only rate flips **4x on a single screenshare** `[verified]`, so if we ever evaluate Daily, price it at the video rate.

**11. Realtime in-meeting assistant on LiveKit Agents — defer, and only if it becomes a headline feature.** *(uncertain value, high cost)*
Evidence `[verified]`: LiveKit Agents ships an STT–LLM–TTS pipeline, their own turn-detection model, interruption handling, multi-agent handoff, and K8s-ready orchestration — roughly a year to reproduce. But it needs containers (outbound-only, so no ingress — Fly/Cloud Run/Railway suffices), self-hosted agents **still bill against LiveKit WebRTC participant minutes** `[verified]`, a listening-only agent costs ~**$0.0158/min ≈ $0.95/hr** in agent-session + observability line items — **~30x the raw STT cost** — and streaming STT abandons whisper-turbo's $0.03/hr `[verified rates, reasoning on the composition]`. Rec #8 keeps this reachable at essentially no cost today; nothing else should be spent on it now.

---

### v1.5 — external meetings (added with the Part 5 scope expansion; evidence in Part 5)

**1.5a. Calendar recognition layer (read-only watch + syncToken, both providers).** *(very high value, low-moderate cost — the highest-leverage item in the whole document after rec #1)*
Push-watch on `events` + incremental `syncToken` sync, filtered to `eventTypes=default`, extracting `conferenceData.entryPoints[].uri` and `attendees[]`. Evidence: `calendar.events.readonly` is sufficient for `events/watch` `[verified]`; quotas (10,000/min project, 600/min/user) are nowhere near binding `[verified]`. This one layer produces the pre-created note page, the auto-title, the attendee list, the meeting-type template selection, and the retroactive-association key — every other external-meeting feature is downstream of it. Ranks above the capture client because **calendar awareness without capture still delivers value** (a meeting-shaped note page with attendees and an agenda), while capture without calendar is an unlabeled audio blob.

**1.5b. Calendar-triggered nudge + pre-created note page, never silent auto-start.** *(high value, low cost)*
Granola creates the note page before the meeting and sends a reminder ~1 minute before any scheduled call with 2+ attendees, and deliberately **does not auto-join or auto-start** `[claim]`. Copy this exactly. `[reasoning]` Auto-starting a recording without a human in the loop is what generates consent violations and unwanted recordings — the nudge keeps a person in the loop at near-zero UX cost, and the pre-created page is what makes rec #2's breadcrumb loop possible (there is something to type into when the meeting begins).

**1.5c. Retroactive association by time-window overlap.** *(high value, very low cost)*
Bind any capture session to a calendar event by start/end overlap against the synced event window, with a one-click override in the UI. Evidence: Granola does not auto-start `[claim]`, so users routinely begin capture late or from the app rather than the nudge; without overlap-matching those sessions become orphaned blobs. Key on `iCalUID` (stable across calendars) rather than the per-calendar event `id` `[verified field semantics]`. Cheapest item on this list and it rescues the majority of real-world capture sessions.

**1.5d. Electron capture-only companion app (macOS + Windows).** *(high value, high cost — but the only complete answer for external meetings)*
Evidence: Electron gives `setDisplayMediaRequestHandler` with `audio: 'loopback'` across macOS/Windows/Linux, and as of **v39.0.0-beta.4 Chromium made Apple's Core Audio Tap API the default** for desktop audio capture `[claim]` — so we inherit Chromium's implementation of the exact thing Recall documents as hard to get right in production `[verified]`. Tauri's 5–10 MB vs Electron's 80–150 MB `[claim]` is real but is the *least* important axis here; Tauri means hand-writing the platform audio layer plus echo cancellation with no turnkey answer `[verified]`. Signing is cheap: Apple $99/yr including unlimited notarization, Azure Trusted Signing $9.99/mo `[claim]` — **verify Trusted Signing eligibility for a non-US/Canada entity before planning on it.** Ship Electron; revisit Tauri only if bundle size proves a measured adoption blocker.

**1.5e. Chrome/Edge extension as the zero-install wedge.** *(moderate value, low-moderate cost — ship before 1.5d, not instead of it)*
`chrome.tabCapture` + a non-`AUDIO_PLAYBACK` offscreen document POSTing slices to our API needs no native code and no download. Evidence `[verified]`: stream ids obtained in a service worker are explicitly usable in an offscreen document (Chrome 116+), and only `AUDIO_PLAYBACK` imposes the 30-second lifetime. Hard limits `[verified/claim]`: **Chromium-only** (Safari returns no audio track; Firefox ignores the audio constraint), **browser-tab meetings only** (no Zoom desktop client), requires an explicit user invocation, and **mutes the tab unless you re-route through an `AudioContext`** — get that wrong and it ships as a bug that breaks the meeting. Request `tabCapture` + `offscreen` and **no host permissions** to keep Web Store review tractable `[reasoning]`.

**1.5f. The minimal v1.5 that makes an external Zoom meeting "just tracked."** *(this is the shippable increment)*
Composition of 1.5a + 1.5b + 1.5c + one capture client: **calendar recognition → pre-created note page with title/attendees/template → nudge 1 minute before → one click starts capture → slices upload → transcript + summary → candidates into the promote loop → auto-associated back to the calendar event.** `[reasoning]` Note what is deliberately absent: no bot, no auto-start, no Zoom/Teams API integration, no per-platform SDK. The only per-platform work is the audio tap, and the calendar layer is provider-agnostic. If the extension ships first, v1.5 covers browser-based Meet/Teams-web/Zoom-web on Chromium; 1.5d then extends it to the Zoom desktop client and to Safari/Firefox users, and is also what unlocks the in-person case on desktop.

**Competitive urgency note** `[claim]`: **Fathom launched botless recording in October 2025**, and Circleback publishes a page on in-person-meeting *workarounds* for Granola. `[reasoning]` The incumbents are converging on Granola's capture model, which means capture is commoditizing and the durable differentiator is downstream — the board-native promote loop (rec #1), not the tap. Sequence accordingly: rec #1 before any capture client.

---

## Part 5 — Integration mechanics for external meetings (Granola pattern)

### 5.1 Calendar layer

#### Google Calendar

**Watch vs poll.** The Calendar API supports push notification channels on `Acl`, `CalendarList`, `Events`, and `Settings` `[verified]` — https://developers.google.com/workspace/calendar/api/guides/push. You register an HTTPS webhook receiver and create one channel per watched resource; on change, Google POSTs to your `address`.

Mechanics that matter `[verified]`:
- **Notifications are essentially "something changed" pings** — you then call `events.list` with a **`syncToken`** for the incremental delta. Cancelled events are only returned on incremental sync (`syncToken` or `updatedMin`) or with `showDeleted=true`, and deleted events are only guaranteed to have `id` populated, so your reconciler must tolerate skeleton records.
- **There is no automatic channel renewal.** "When a channel is close to its expiration, you must replace it with a new one by calling the `watch` method… you must use a unique value for the `id` property… there's likely to be an *overlap* period when the two notification channels for the same resource are active." Expiry arrives as `X-Goog-Channel-Expiration` on every notification, and as a Unix-ms `expiration` in the `watch` response.
- You may *request* an `expiration`, but the effective value is the more restrictive of your request and "any Google Calendar API internal limits or defaults."
- **`token`** (≤256 chars, returned as `X-Goog-Channel-Token`) is the anti-spoofing and routing hook. Docs recommend an extensible encoding like URL query params and explicitly warn **not** to put OAuth tokens or sensitive data in it.
- **`events/watch` accepts an `eventTypes` filter**: `birthday`, `default`, `focusTime`, `fromGmail`, `outOfOffice`, `workingLocation` — https://developers.google.com/workspace/calendar/api/v3/reference/events/watch.

`[reasoning]` Three design consequences. Filter to `eventTypes=default` at watch time so birthdays, focus blocks, and working-location entries never reach our pipeline. Build the renewal as a **cron that re-watches before expiry and tolerates duplicate notifications during the documented overlap**, which means the ingest path must be idempotent on (calendar, event id, `updated`) — an assumption worth encoding as a uniqueness constraint rather than a comment. And because expiry is server-capped and undocumented in the guide, treat the returned `expiration` as the only source of truth; never hardcode a renewal interval.

**Join-link extraction.** `[verified]` from the Events resource — https://developers.google.com/workspace/calendar/api/v3/reference/events:
- `conferenceData.entryPoints[]` — each with `entryPointType`, **`uri`**, and the subset of `{meetingCode, accessCode, passcode, password, pin}` that matches the provider's terminology.
- `conferenceData.conferenceSolution.key.type` — `"hangoutsMeet"` for Google Meet, **`"addOn"` for third-party conference providers** (this is where Zoom and Teams land), plus deprecated `"eventHangout"` / `"eventNamedHangout"`.
- `hangoutLink` — legacy top-level Meet link.
- Critically: **"If a client encounters an unfamiliar or empty type, it should still be able to display the entry points."**

`[reasoning]` So **do not allowlist `conferenceSolution.key.type`** — read `entryPoints[].uri` and pattern-match the host to classify the platform, falling back to "unknown conferencing" rather than "not a meeting." An allowlist silently drops every provider we didn't enumerate, which for a mass-market product is a long tail of Webex/Whereby/internal tools. Also expect meeting links pasted only into `description` or `location` with no `conferenceData` at all — a URL scan of those fields is a cheap, high-yield fallback.

**Attendee metadata.** `[verified]` `attendees[]` carries `email`, `displayName`, `organizer`, `self`, `resource`, `optional`, `responseStatus`, `comment`, `additionalGuests`. Also available: `organizer`/`creator`, `start`/`end` with `timeZone`, `recurringEventId` + `originalStartTime`, **`iCalUID`**, `sequence`, `status` (`confirmed`/`tentative`/`cancelled`), `visibility`, `transparency`, and `extendedProperties.private`/`shared`.

Two traps `[verified]`: **`attendeesOmitted`** signals the attendee list may be truncated (e.g. by `maxAttendee`) — never treat the array as complete without checking it; and `resource: true` marks room resources, which must be excluded from any "who was in this meeting" or assignee-suggestion logic or you get action items assigned to "Conference Room B."

`[reasoning]` Two more: use **`iCalUID`** as the association key, not `id` — `id` is per-calendar, so the same meeting on the organizer's and attendee's calendars has different `id`s but the same `iCalUID`, which is exactly what dedupe across an org needs. And `extendedProperties.private` would be the elegant way to stamp our meeting id onto the event itself, but writing it needs a write scope — so v1 should keep the mapping in our own DB keyed on `iCalUID` and stay read-only.

**OAuth scopes and the verification burden.** `[verified]` `events/watch` accepts any of: `calendar.readonly`, `calendar`, `calendar.events.readonly`, `calendar.events`, `calendar.app.created`, `calendar.events.freebusy`, `calendar.events.owned`, `calendar.events.owned.readonly`, `calendar.events.public.readonly`.

`[reasoning]` **`calendar.events.readonly` is the narrowest scope that supports watch and gives us everything in Part 5.1** — events, conferenceData, attendees. `calendar.app.created` is a tempting-looking minimal scope but only covers events *our app created*, which is useless for reading the user's existing meetings. Do not request `calendar` or `calendar.events` (write) in v1: it buys only `extendedProperties` stamping and materially worsens both the consent dialog and the review posture.

Verification `[verified]`: "If your public application uses scopes that permit access to certain user data, it must complete a verification process" — https://developers.google.com/workspace/calendar/api/auth.

The CASA picture `[claim]`, secondary and **internally inconsistent across sources**: CASA (run by the App Defense Alliance, built on OWASP ASVS) has Tier 1 self-assessment, Tier 2 third-party DAST scan by an authorized lab, Tier 3 full manual penetration test; restricted scopes require an **annual** re-assessment within 12 months of the assessor's Letter of Assessment. 2026 self-serve Tier 2 lab fees are reported at **~$540–$1,000**, with the full range **$500–$4,500** across tiers — https://deepstrike.io/blog/google-casa-security-assessment-2025, https://singhamandeep.com/google-oauth-verification-guide/. **But the sources disagree on whether Calendar scopes are "sensitive" or "restricted"**: one states `calendar.events` triggers CASA Tier 2, another lumps Calendar in with Gmail/Drive as restricted.

`[reasoning]` This is a real budget and timeline line item, not a footnote — verification can take weeks and gates public launch. **Confirm the classification of `calendar.events.readonly` directly against Google's current scope-classification page before committing to a launch date**, and start the verification submission in parallel with the build rather than after it. Until verified, the app shows an "unverified app" screen `[verified]`, which is survivable for design-partner usage and fatal for mass market.

**Rate limits.** `[verified]` — https://developers.google.com/workspace/calendar/api/guides/quota: **10,000 requests/min per project** and **600 requests/min per user per project**, sliding-window, with a burst over the limit causing throttling in the next window. Exceeding returns 403 or 429 `usageLimits` `[claim]`. Two dated notes `[verified]`: **as of May 1, 2026 the usage limits were updated** — projects that used the API between November 2025 and April 2026 keep their prior quotas, while **projects created on or after May 1, 2026 are subject to the new quotas**, under Google's "standardized model for agent tools and APIs." And with domain-wide delegation the *service account* is charged against the per-user quota unless you pass **`quotaUser`** / `x-goog-quota-user`.

`[reasoning]` Quotas are not a constraint for this workload — watch + syncToken means a handful of calls per user per day, so we're orders of magnitude under 600/min/user. Two real risks instead: **our Cloud project's creation date determines which quota regime we get** (a project created now lands on the new, unquantified-here limits — check the actual dashboard values rather than assuming), and if we ever add Workspace-wide domain delegation for org-level install, forgetting `quotaUser` will throttle the whole tenant through one service-account bucket.

#### Microsoft Graph

**Change notifications** `[verified]` — https://learn.microsoft.com/en-us/graph/change-notifications-overview. Three types: **basic** (id only — you re-query), **rich** (includes resource data), and **lifecycle** (warns you're at risk of missing notifications). Delivered via webhooks among other channels.

For calendar: subscribe to Outlook **`event`** at `/users/{id}/events` or `/me/events`, with **a maximum of 1,000 active subscriptions per mailbox across all applications** `[verified]`.

**Subscription lifetime is the binding constraint.** `[verified]` Graph publishes per-resource maximum expirations — Teams `onlineMeeting`, `callRecording`, `callTranscript`, `channel`, `chat`, `chatMessage` at 4,320 minutes (3 days); `callRecord` at 4,230 minutes. `[claim]` Outlook `message`/`event` are commonly reported at **~4,230 minutes (~3 days)**, with requests above the ceiling rejected as `BadRequest`, and any `expirationDateTime` under 45 minutes silently raised to 45 minutes — https://learn.microsoft.com/en-us/graph/api/resources/subscription. **Confirm the exact `event` ceiling from that resource table before setting the renewal interval.**

`[reasoning]` Graph's ~3-day ceiling is stricter than Google's, so **the renewal cron is designed to Graph's clock** and Google renewal rides along on the same job. Equally important: **lifecycle notifications (`reauthorizationRequired`) must be handled** — they are the documented mechanism for "the user's token went stale," and ignoring them means notifications stop silently. Combined with the 1,000-subscriptions-per-mailbox ceiling, the invariant is one subscription per mailbox per app, cleaned up on disconnect — leaking subscriptions across re-installs would eventually wall a heavy user out.

`[reasoning]` **Reconciliation sweep, both providers.** Because push channels expire, renewals can fail, and lifecycle events can be missed, webhooks alone will drop meetings — and a *silently missed meeting* is the worst failure this feature has. Run a cheap periodic `syncToken` / delta sweep as a floor regardless of webhook health. Quotas make this nearly free (see above), and it converts "notification lost" from data loss into bounded latency.

#### How the incumbents use calendar triggers

`[claim]` — https://www.sybill.ai/blogs/granola-vs-fathom, https://www.granola.ai/blog/granola-google-meet-integration-recording-transcription, https://circleback.ai/compare/fathom-vs-granola:
- Granola uses calendar metadata to **auto-title transcripts**, **create the note page before the meeting starts**, and **send a reminder ~1 minute before any scheduled call with 2+ attendees**.
- Granola **does not auto-join or auto-start** — the user manually starts it; calendar integration exists so notes "line up with events."
- Granola **generates a transcript from device audio output and does not save any audio or video files** — a deliberate privacy posture.
- Fathom **launched botless recording in October 2025**, converging on the same capture model.
- Circleback publishes a page on **in-person-meeting workarounds for Granola**, i.e. in-person is a known soft spot even for the on-device leader.

`[reasoning]` The "2+ attendees" heuristic is worth stealing verbatim — it suppresses the solo focus-blocks and personal appointments that would otherwise make the nudge noisy enough to be muted, and a muted nudge is a dead feature. The "no auto-start" choice is the important one and it is not laziness: a product that silently begins recording on a calendar trigger will record the wrong things, and one bad incident in a mass-market product is unrecoverable. Granola's "we never persist audio" stance is also a cheap, strong trust claim we could match — our pipeline needs audio only until transcription completes, so **delete-audio-after-transcription can be a default with a retention opt-in**, not a limitation.

### 5.2 Desktop system-audio capture

Primary reference for this subsection: Recall.ai's engineering deep dive, published 2026-05-13 / updated 2026-07-03 — https://www.recall.ai/blog/how-to-get-access-to-system-audio. Recall sells a competing Desktop Recording SDK, so the *conclusions* are self-interested, but the enumerated API limitations are concrete and checkable, and I mark them `[verified]` where they describe API behavior.

#### macOS

**ScreenCaptureKit** (macOS 12.3+). Records screen, system audio, and mic; relatively easy to use. Limitations `[verified]`:
- **System audio access is tied to a window or capture session** — "even if you only want to record audio, a screen capture target such as display, window, or app that records the screen as part of the capture pipeline still needs to be configured." Which means requesting the broader **"Screen & System Audio Recording"** permission for an audio-only product.
- **Audio is not isolated**: notifications, music, or other media playing during the session are captured into the recording, producing "polluted audio" unless you add handling logic.
- Mic audio arrives "through a media capture stream rather than an audio-focused pipeline like AVAudioEngine," so you manage stream state, buffers, and formatting yourself; mishandling causes **dropped audio and synchronization issues**. AVAudioEngine is the better mic path but **does not support system audio**, so you end up combining two APIs.

**Core Audio Taps** (macOS 14.2+). `[verified]` Historically only captured audio generated *within* your own app; Apple expanded it to capture system audio from all applications with user permission. Requires only the narrower **"System Audio Recording"** permission — no screen access `[claim]` — which is a materially better consent dialog for an audio-only product. Shape `[claim]`: build a `CATapDescription`, call `AudioHardwareCreateProcessTap`, then create an aggregate device carrying the tap UID in `kAudioAggregateDeviceTapListKey`; the TCC prompt comes from `NSAudioCaptureUsageDescription` and **only fires on a properly signed binary** — https://github.com/insidegui/AudioCap, https://developer.apple.com/documentation/CoreAudio/capturing-system-audio-with-core-audio-taps.

But `[verified]`: "the ecosystem around Core Audio Taps is still nascent. Apple's documentation for this functionality is limited, making it hard to implement. Many developers especially struggle to reliably implement Core Audio Taps in production environments."

`[reasoning]` Taps are clearly the right *destination* — narrower permission, no phantom screen-capture session, per-process targeting. But "hard to implement reliably in production" plus signing-gated TCC prompts is exactly the class of problem where we want somebody else's tested implementation, not our own first attempt. That points at Electron (below), which now defaults to this API.

**Echo cancellation — the underrated risk.** `[verified]` "Echo occurs when a microphone input picks up audio that is also being played through the speakers, resulting in duplicated speech getting recorded. This is a challenge every developer building a meeting recorder needs to solve." And: "there is no one size fits all solution to eliminate echo. Different AEC libraries are optimized for different environments… The effectiveness of an AEC library depends heavily on your audio pipeline: how audio is captured, synchronized, and processed. To choose the right AEC library, you need to test it with your actual pipeline." Not a problem with headphones, but you cannot assume headphones, so you need detection logic. **If unhandled, "transcripts may contain repeated speech, reducing their accuracy."**

`[reasoning]` This is the sleeper item in the whole external-meetings plan. It compounds the diarization problem from §3.2 rather than being independent of it: duplicated speech is a *worse* transcript defect than a missing speaker label, because a summarizer reading doubled sentences will over-weight them. It also can't be fixed after the fact from a mixed recording. Mitigations in cost order: (1) prefer **system audio only, no mic**, whenever the meeting is fully remote — every remote participant including the local user is already in the system output if the meeting app plays their own voice back, and where it doesn't, mic is needed only for the local speaker; (2) detect headphones and skip AEC when present; (3) capture mic and system as **separate tracks** so AEC (or a later re-run of it) has clean references instead of an unrecoverable mix. Point (3) is a storage-cheap decision that must be made in v1 — a single pre-mixed file forecloses every later fix.

#### Windows

`[verified]` — https://learn.microsoft.com/en-us/windows/win32/api/mmdeviceapi/nf-mmdeviceapi-activateaudiointerfaceasync, https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/:
- **WASAPI loopback** captures whole-system output.
- **Per-process loopback**: `ActivateAudioInterfaceAsync` with `VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK` plus `AUDIOCLIENT_ACTIVATION_PARAMS` restricts capture to a specified PID **and its child processes**, with a flag to invert (capture all system audio *except* that process).
- **`GetMixFormat()` is `E_NOTIMPL`** on the process-loopback client; Microsoft's own sample hard-codes 2-channel/16-bit/44.1 kHz.
- Minimum build: sources disagree — **Windows 10 Build 20348** vs **20438** for the activation params `[claim]`. Flagged; check before setting a minimum supported OS.
- **WASAPI provides no built-in echo cancellation** — must be handled separately in your pipeline `[verified, Recall FAQ]`.

`[reasoning]` Per-process loopback is strictly better than whole-system for our case: target the meeting app's PID and Spotify, Slack pings, and YouTube never enter the recording — which solves on Windows the "polluted audio" problem that ScreenCaptureKit has on macOS. The `E_NOTIMPL` format quirk is a real footgun: code that queries the mix format works on whole-system loopback and fails only on the per-process path, so it will pass a naive test and break in the configuration we actually ship.

#### Tauri vs Electron for a thin capture-only companion

`[claim]`, secondary — https://www.pkgpulse.com/guides/electron-vs-tauri-2026, https://tech-insider.org/tauri-vs-electron-2026/:
- **Bundle:** Tauri hello-world 3.2 MB vs Electron 85 MB; a six-window app 8.6 MB vs 244 MB; typical installed size 5–10 MB vs 80–150 MB.
- **Auto-update:** Tauri ships a built-in updater with differential updates and signature verification; Electron's `electron-updater` is the mature standard with differential updates, staged rollouts, GitHub Releases integration, and it **handles the macOS notarization and Windows signing workflow**.
- Conventional guidance: Electron when you need mature signing/auto-update tooling now or the team is all-JavaScript; Tauri when you need sub-20 MB bundles.

**Code-signing cost** `[claim]`:
- **Apple:** Developer Program **$99/yr**; signing certificates and **unlimited notarizations included at no additional fee**.
- **Windows:** **Azure Trusted Signing $9.99/mo** Basic (up to 5,000 signatures) / $99.99/mo Premium (100,000), overage $0.005/signature — described as the lowest-cost path to full SmartScreen trust, **for US and Canadian developers** — https://techcommunity.microsoft.com/blog/microsoft-security-blog/trusted-signing-is-now-open-for-individual-developers-to-sign-up-in-public-previ/4273554, https://melatonin.dev/blog/code-signing-on-windows-with-azure-trusted-signing/.

`[reasoning]` **Flag for the architect: the US/Canada eligibility restriction on Trusted Signing may exclude an India-registered entity**, which would push Windows signing to a conventional OV/EV certificate at a materially higher cost and with an HSM requirement. Verify eligibility before budgeting — and note that on Windows, *unsigned* is not a soft failure: SmartScreen warnings on a first-run installer kill mass-market conversion, and the TCC prompt on macOS doesn't even appear for an improperly signed binary `[claim]`.

**Recommendation — Electron, despite the bundle size.** `[verified]` on the capability: Electron exposes `setDisplayMediaRequestHandler` with `audio: 'loopback'`, and **as of Electron v39.0.0-beta.4 Chromium made Apple's Core Audio Tap API the default for desktop audio capture**, with a feature flag to fall back to the older Screen & System Audio Recording path on macOS 14.2+ — https://github.com/electron/electron/issues/47490, https://github.com/electron/electron/pull/47493. The `electron-audio-loopback` package covers macOS 12.3+, Windows 10+, and Linux with no third-party drivers `[claim]` — https://github.com/alectrocute/electron-audio-loopback. Recall's SDK supports Tauri as well as Electron `[claim]`, which tells you Tauri is *possible* — via a third-party native SDK, i.e. exactly the work we'd be avoiding.

`[reasoning]` The trade is explicit: ~100 MB of bundle in exchange for inheriting Chromium's tested Core Audio Taps + WASAPI implementations, the `electron-updater` notarization/signing pipeline, and an all-JS codebase shared with our web capture path. Given that Recall documents Core Audio Taps as hard to get right in production and echo cancellation as having no turnkey answer, hand-writing that layer to save 100 MB is the wrong trade for a capture-only companion whose entire value is that it *works*. Ship Electron; revisit Tauri only if bundle size shows up as a measured adoption blocker, not preemptively.

### 5.3 Browser extension

**What's actually capturable.** `[verified]` — https://developer.chrome.com/docs/extensions/reference/api/tabCapture:
- `chrome.tabCapture` yields a `MediaStream` with audio and video **of the current tab**, and "can only be called after the user invokes an extension, such as by clicking the extension's action button. This is similar to the behavior of the `activeTab` permission." **No silent or calendar-triggered auto-capture is possible.**
- **Capturing mutes the tab for the user.** "When a MediaStream is obtained for a tab, audio in that tab will no longer be played to the user." The documented fix is to re-route: `new AudioContext()` → `createMediaStreamSource(stream)` → `connect(output.destination)`.
- `getMediaStreamId()` returns an **opaque, single-use** id that "expires after a few seconds if it is not used." Since **Chrome 116**, without `consumerTabId` it may be used "in any frame with the same security origin in the same render process as the caller. **This means that a stream ID obtained in a service worker can be used in an offscreen document.**"

`[reasoning]` The mute behavior is the highest-risk detail in this subsection: get it wrong and the extension ships as "your meeting audio disappears when you start recording," which is indistinguishable from breaking the meeting. It needs an explicit test, not a code comment.

**MV3 long-recording constraints.** `[verified]` — https://developer.chrome.com/docs/extensions/reference/api/offscreen:
- `chrome.offscreen` (Chrome 109+, MV3) creates a hidden DOM document — the only MV3 surface with DOM APIs, since service workers have none.
- **"The `AUDIO_PLAYBACK` reason sets the document to close after 30 seconds without audio playing. All other reasons don't set lifetime limits."**
- Inside an offscreen document, **`chrome.runtime` is the only extensions API available**; the URL must be a static bundled HTML file; **only one offscreen document can be open at a time** per extension (plus one for an incognito profile in split mode).

`[reasoning]` So the architecture is forced and clean: user clicks the action → service worker calls `getMediaStreamId()` → creates an offscreen document with a **non-`AUDIO_PLAYBACK` reason** (`USER_MEDIA`) → the offscreen document calls `getUserMedia({audio:{mandatory:{chromeMediaSource:"tab", chromeMediaSourceId: id}}})`, runs `MediaRecorder` with the §3.1 slice-and-queue loop, re-routes audio through an `AudioContext` so the tab isn't muted, and `fetch()`es slices straight to our API. **Picking the wrong offscreen reason is the difference between a working recorder and a 30-second one** — and it would pass a short manual test. Two more consequences: **native messaging is unnecessary** (the offscreen document can POST directly, and avoiding a native host is most of the point of shipping an extension), and the one-offscreen-document-at-a-time limit means the extension can record **one meeting at a time**, which is fine for meetings but must be enforced rather than discovered.

**Browser reality — Chromium only.** `[claim]` `getDisplayMedia` audio capture: **Safari accepts the call but returns no audio track, and system audio is unsupported; Firefox ignores the audio constraint when sharing a tab and has no native system audio** (the workaround being a virtual device like BlackHole or VB-Cable). Mozilla's tracker is bug 1541425. Chrome, Edge, and Arc deliver reliable tab audio — https://caniuse.com/mdn-api_mediadevices_getdisplaymedia_audio_capture_support, https://bugzilla.mozilla.org/show_bug.cgi?id=1541425.

`[reasoning]` Two hard scope limits to state plainly: the extension covers **Chromium browsers only** and **browser-tab meetings only** — a user on the Zoom *desktop client* (very common) gets nothing from it. So the extension is a wedge, not the answer; §1.5d's desktop app is what closes both gaps. But the wedge is worth shipping first because it requires zero download, zero code signing, and no native code.

**Web Store policy risk.** `[claim]` — https://developer.chrome.com/docs/webstore/troubleshooting, https://www.extensionradar.com/blog/chrome-extension-rejected: requesting permissions you don't demonstrably use is the top rejection cause; a permissions-justification form in the Developer Dashboard is commonly required; capture permissions get extra scrutiny because captured content can expose user data; rejections are appealable with a detailed necessity argument.

`[reasoning]` The risk is manageable and the mitigations are structural rather than rhetorical: request **only `tabCapture` and `offscreen`, with no host permissions and no `<all_urls>`** — which is what separates us from the "all sites access" audio extensions that attract scrutiny; don't inject content scripts into meeting pages at all; rely on `tabCapture`'s built-in requirement of an explicit user invocation as the consent story in the justification; and keep the listing single-purpose ("record and transcribe the meeting in this tab"). Note the review risk is not symmetric with the desktop app: a Web Store rejection is a launch-blocking dependency on a third party, whereas a signed desktop app ships on our own schedule — an argument for not making the extension the *only* external-meetings path.

---

## Source index

**Primary (fetched directly, `[verified]`):**
- LiveKit pricing — https://livekit.io/pricing and https://livekit.io/pricing.md
- LiveKit Egress overview — https://docs.livekit.io/home/egress/overview/
- LiveKit Agents — https://docs.livekit.io/agents/
- LiveKit self-hosted agent deployment — https://docs.livekit.io/deploy/custom/deployments/
- LiveKit Workers incompatibility — https://github.com/livekit/node-sdks/issues/273
- Cloudflare Realtime overview — https://developers.cloudflare.com/realtime/
- Cloudflare RealtimeKit — https://developers.cloudflare.com/realtime/realtimekit/
- Cloudflare RealtimeKit pricing — https://developers.cloudflare.com/realtime/realtimekit/pricing/
- Cloudflare Realtime SFU/TURN pricing — https://developers.cloudflare.com/realtime/sfu/pricing/
- Cloudflare Workers AI pricing — https://developers.cloudflare.com/workers-ai/platform/pricing/
- Daily Video SDK pricing — https://www.daily.co/pricing/video-sdk/
- Deepgram pricing — https://deepgram.com/pricing
- WebKit MediaRecorder chunk bug — https://bugs.webkit.org/show_bug.cgi?id=279432
- Repo confirmation of pipeline entities — `infra/supabase/migrations/20260606093937_create_meeting_schema.sql`

**Primary added for Part 5 (`[verified]`):**
- Google Calendar push notifications — https://developers.google.com/workspace/calendar/api/guides/push
- Google Calendar Events resource — https://developers.google.com/workspace/calendar/api/v3/reference/events
- Google Calendar events.watch — https://developers.google.com/workspace/calendar/api/v3/reference/events/watch
- Google Calendar scopes — https://developers.google.com/workspace/calendar/api/auth
- Google Calendar usage limits — https://developers.google.com/workspace/calendar/api/guides/quota
- Microsoft Graph change notifications — https://learn.microsoft.com/en-us/graph/change-notifications-overview
- Microsoft Graph subscription resource — https://learn.microsoft.com/en-us/graph/api/resources/subscription
- WASAPI process loopback — https://learn.microsoft.com/en-us/windows/win32/api/mmdeviceapi/nf-mmdeviceapi-activateaudiointerfaceasync and https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/
- chrome.tabCapture — https://developer.chrome.com/docs/extensions/reference/api/tabCapture
- chrome.offscreen — https://developer.chrome.com/docs/extensions/reference/api/offscreen
- Apple Core Audio taps — https://developer.apple.com/documentation/CoreAudio/capturing-system-audio-with-core-audio-taps
- Recall.ai macOS system-audio deep dive (API limitations; vendor sells a competing SDK) — https://www.recall.ai/blog/how-to-get-access-to-system-audio
- Electron loopback/Core Audio Tap default — https://github.com/electron/electron/issues/47490, https://github.com/electron/electron/pull/47493

**Vendor/secondary (`[claim]`):** granola.ai (+ blog), zapier.com/blog/granola-ai, techcrunch.com/2024/05/22, businesswire launch release, get-alfred.ai, usecarly.com, bluedothq.com, thebusinessdive.com, summarizemeeting.com, wisprflow.ai, bossai.tech, weesperneonflow.ai, otter.ai (blog: My Action Items, Meeting Agent, in-person notetaker, best-ai-meeting-assistant), tldv.io, spinach.ai, fathom.ai (+ /overview, /pricing), claap.io, circleback.ai (+ /pricing), dynamicbusiness.com, trustradius.com, limitless.ai, agent-finder.co, omi.me, smartaiwearables.com, meetily.ai, github.com/Zackriya-Solutions/meetily, Meetly iOS App Store listing, 100ms.live, buildmvpfast.com, fazliev.com, prodinit.com, celloip.com, novascribe.ai, vexascribe.com, brasstranscripts.com, convertaudiototext.com, blog.addpipe.com, buildwithmatija.com, progressier.com, telerik.com, Apple Developer Forums threads 694867 / 662277 / 694207, developer.apple.com WWDC23-10006

**Unverified / conflicting — flagged for the architect:**
- Granola free-tier limits: "25 lifetime meetings + 14-day history" vs "unlimited meetings + rolling 30-day access." Shape is consistent; number is not.
- Granola Android availability: reviews say none; a Google Play listing exists.
- Whether Cloudflare's resold `@cf/deepgram/nova-3` exposes Deepgram's diarization add-on. **Check before designing around it.**
- 100ms and Deepgram per-minute rates are secondary-sourced only; confirm from their own pricing pages before any commitment.
- Granola/Otter mobile client implementations — no primary source found; both are native, which is itself the signal.

**Part 5 additions to the unverified list — all four are decision-gating:**
- **Whether `calendar.events.readonly` is a "sensitive" or "restricted" scope.** Sources contradict each other. Determines CASA Tier 2 (~$540–$1,000 lab fees) vs Tier 3 (manual pentest, $000s) plus annual re-assessment, and it gates public launch. Confirm against Google's current scope-classification page.
- **Microsoft Graph's exact max expiration for Outlook `event` subscriptions.** ~4,230 min (~3 days) is secondary-sourced; the authoritative per-resource table is on the subscription resource page. Sets the renewal-cron interval.
- **Windows minimum build for per-process loopback** — sources say 20348 vs 20438 for the activation params. Sets our minimum supported Windows version.
- **Azure Trusted Signing eligibility for a non-US/Canada entity.** If ineligible, Windows signing moves from ~$10/mo to a conventional OV/EV certificate with an HSM requirement — a real budget delta, and unsigned is not a viable fallback on Windows.
