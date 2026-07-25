# Meeting product roadmap — consolidated decisions (2026-07-25)

**Status:** record of decisions, not a re-decision. Every item below is traceable to a
Forge kernel issue (cited inline) or to the evidence in
[`docs/research/2026-07-25-meeting-experience-and-livekit.md`](../research/2026-07-25-meeting-experience-and-livekit.md)
(cited as *research §N*). Where the kernel is silent, this document says so rather than
filling the gap.

Kernel records consolidated here:

| Issue | Role |
|---|---|
| `meeting-capture-experience-roadmap-c9348c5e` (epic, P1) | Capture & experience ranking |
| `end-to-end-meeting-0c1a2ac1` (P1, in flight) | The promote loop |
| `agentic-chat-across-the-7de23759` (P1) | Unified chat + meeting context |
| `memory-meeting-access-authority-bdd55b7e` (P1) | Retrieval authority gate |
| `conversational-companion-agent-voice-566525dc` (epic, P2) | Voice/realtime depth |
| `calendar-recognition-layer-google-4acd95bd` (P1) | External-meeting recognition |
| `desktop-capture-companion-tauri-1ff834c9` (P2) | Desktop collector |
| `chrome-extension-capture-wedge-c1d7a77f` (P2) | Browser wedge |

---

## 1. Product direction

**First-party capture + calendar awareness, no bots** (epic `c9348c5e`). We capture audio
ourselves and recognise meetings from the calendar; we do not send a participant bot into
anyone's call. The Granola pattern — a notepad that is present before the meeting starts,
system-audio capture, no meeting-room intruder — is the model. Nudge before a recognised
meeting; **never silent auto-start** (`4acd95bd`).

**The moat is the promote loop, not capture.** Capture is commoditising — Fathom shipped
botless in Oct 2025 (epic `c9348c5e`). Research §1.8 makes the exploit explicit: every
competitor writes action items into an *external* tracker and then loses sight of them
(Granola: no task integration at all; Otter: a parallel checkable-not-plannable inbox;
Fathom: CRM-shaped activity records; Circleback: one-way push, no reconciliation;
Limitless: no bounded session). We own the board, which buys three things they cannot copy
without building a work-management product: review-and-promote instead of auto-push,
round-trip provenance from work item back to the transcript span, and dedupe against the
existing backlog before creation.

Consequence for extraction quality: precision stops being a liability. An unpromoted
candidate costs nothing, whereas a wrong auto-created Linear issue is somebody's cleanup
(research §1.8).

**Shipping without diarization** (epic `c9348c5e`, research §3.2): 12x cost and
one-speaker-per-word loss. Speaker labels are decoration only until that changes.

---

## 2. The capture matrix

| Context | Mechanism | Status / kernel record |
|---|---|---|
| In-person | Browser mic + slice-and-queue upload; thin native/PWA path preferred for sessions over ~30 min | v1 pipeline item, epic `c9348c5e`; constraints research §3.1 |
| Browser meetings (Meet, Teams-web, Zoom-web) | Chrome extension wedge: `chrome.tabCapture` stream id minted in the service worker, consumed in a non-`AUDIO_PLAYBACK` offscreen document, 5–15s slices POSTed to our API. Only `tabCapture`+`offscreen` permissions, no host perms, for tractable store review | `c1d7a77f` (v1.5e). Chromium only; explicit user invocation. **Known trap:** the tab mutes unless audio is re-routed through an `AudioContext` |
| Desktop (Zoom client, Safari/Firefox users, desktop in-person) | **Tauri** thin collector — Windows + macOS + **Linux**, system webview (~30–80 MB RAM), target bundle 5–15 MB | `1ff834c9` (v1.5d). **Electron rejected on RAM** (idle footprint), not merely bundle size (80–150 MB) |
| Hosted org calls | Cloudflare RealtimeKit, Raw-RTP → R2 | v2, epic `c9348c5e`; see §5 |
| Mobile | See note below — **not yet a kernel decision** | — |

**Consequence of rejecting Electron** (`1ff834c9`): we write the audio layer ourselves. The
research's Electron shortcut — `setDisplayMediaRequestHandler` with `audio: 'loopback'`,
inheriting Chromium's Apple Core Audio Tap default (research §5.2) — is off the table. The
audio-tap matrix we now own, ordered by difficulty:

- **Linux** — PipeWire/PulseAudio monitor sources; easiest, no permission prompt.
- **Windows** — WASAPI loopback; mature Rust crates (`cpal`, `wasapi`).
- **macOS** — Core Audio Process Tap (14.4+); hardest, and the **first spike**. Granola
  precedent: it is a native Swift app.

Scoped as its own workstream. Tauri still provides shell, auto-update and signing; the
Linux caveat to verify at build time is WebKitGTK webview quirks. Signing: Apple $99/yr,
Windows Azure Trusted Signing $9.99/mo (**verify non-US-entity eligibility**), Linux none
(AppImage/deb/flatpak).

**Mobile — recorded honestly.** The kernel holds no mobile-capture decision as of
2026-07-25, and no issue exists for it. What the research establishes (§3.1) is the
platform wall, not a plan: on iOS Safari, `setInterval` is throttled when backgrounded
while **MediaRecorder callbacks keep firing** — so the upload loop must be driven by
`ondataavailable`, never a timer, or it silently stalls the moment the user switches apps;
sleep/wake produces oversized chunks (WebKit bug 279432, verified filed); minute-plus
recordings can reload the page and `onstop` is unreliable; Wake Lock needs a *visible*
page (iOS Safari 16.4+, broken in installed PWAs until 18.4). The research's conclusion is
a thin native/PWA path on mobile for long meetings, and it notes Granola and Otter are
both native — which is itself the signal. **A mobile row for this matrix (mic-based
capture now, any bot-join-by-join-link path later) needs to be filed and decided before it
belongs here.** Calendar `conferenceData` join links are already extracted by `4acd95bd`,
so the raw material exists; the direction does not.

---

## 3. Unified chat — one agent, context follows the page

**ONE chat, one brain** (`7de23759`, decision 2026-07-25). There is no separately-named
"Ask-the-meeting" feature. The single shell-mounted chat panel, opened on a meeting page,
knows that meeting's transcript, chapters and action items and can propose from them into
the Inbox — same runtime, same provenance. Meeting context is the **first** concrete
context this omnipresent-chat work should ship, because the extraction + bridge pipeline
(`0c1a2ac1`) lands now.

**Meeting-corpus retrieval** (`7de23759`, 2026-07-25): when a discussion touches something
covered in past meetings, the agent searches transcripts/chapters/decisions and replies
with cited meeting context, and can propose follow-ups. The P3a knowledge layer already
reserves an authority tier for meeting content (unexercised), and brief I4 reserves a
`searchMeetings(tenantId, query)` seam.

**HARD DEPENDENCY — the access-authority P1 gates this** (`bdd55b7e`). Meeting retrieval
without per-user visibility enforcement is a privacy incident waiting to happen. Today
everything is tenant-scoped only: one org means full visibility, which becomes a real gap
the moment transcripts enter retrieval. The four design principles:

1. **The agent acts with the caller's permissions.** Every retrieval — `search_memory`,
   KB, the future `searchMeetings`, and the injection legs in `runtime.ts` — is filtered by
   the *requesting user's* visibility, never the agent's reach.
2. **Meeting artifacts inherit meeting visibility** (participants + explicit shares), and
   *all* derivatives — chapters, action items, extracted memories, proposal rationale —
   carry that inheritance via provenance.
3. **Injection and rules lanes respect the same filter.** Restricted-born memory never
   auto-injects into a non-participant's run.
4. **Classify at ingestion, enforce at query, both fail-closed.**

No privilege laundering: a private meeting must not become an extracted memory that gets
injected everywhere. Senior-team content stays invisible to a junior member's chat.
Touches `memory-retrieval.ts`, `knowledge-retrieval.ts`, the `searchMeetings` seam, the
`memories` schema (visibility column/table) and the meetings participants model.
Calibration precondition: `authority-rrf-calibration-golden-c3060f33` (golden set before
meetings/docs ingest).

---

## 4. The companion ladder — depth, not a second surface

Scope reframed 2026-07-25 (`566525dc`): the companion is **not a separate named surface**.
It is *depth* of the unified chat. Rung 1 moved into `7de23759`. One chat, one brain,
context follows the page — never a parallel experience.

| Rung | Capability | Where it lives |
|---|---|---|
| 1 | Ask the meeting in chat — text Q&A over transcript/summary, propose into Inbox (the companion's brain, no voice) | `7de23759` (moved out of the companion epic) |
| 2 | Voice replies — TTS on responses + push-to-talk questions, no realtime pipeline | `566525dc`, v2 |
| 3 | Solo thinking partner — full-duplex voice while background worker agents fan out (research/draft/verify) and stream results back; voice as the interface to the agent plane | `566525dc`, v2.5 |
| 4 | Live in-meeting buddy — a voice participant people talk to mid-meeting; answers aloud, holds discussion context, collects votes/polls | `566525dc`, v3 |

Timing was deliberately left unplaced by the user; the ladder is the recommended on-ramp.

**Key composition** (`566525dc`): the companion's *hands* are the existing propose-only
runtime. A voice head on the same proposals/Inbox/provenance machinery — which is why
competitors would have to build a work-management product to copy it.

**Realtime engineering facts** (research §2.4, cited in `566525dc`): the realtime layer is
LiveKit Agents territory — turn detection, barge-in, STT-LLM-TTS, ~1 year to reproduce
(verified). Listening-only is ~$0.95/hr, roughly **30x batch STT**, and it requires
containers, so it cannot run on CF Workers. A realtime assistant on LiveKit Agents is
therefore **deferred**. Alternatives to re-research at build time: Pipecat, OpenAI
Realtime. Cheap insurance bought now: the 4-op room-provider interface, and designing the
meeting page with the chat panel present from day one.

---

## 5. Transport verdict — hosted calls (v2)

Head-to-head, 5 participants, 60-minute audio-only call, transcript produced
(research §2.3):

| Provider | Total / call | Platform floor | Note |
|---|---|---|---|
| **CF RealtimeKit** (chosen) | **$0.21** | $0 (free in beta) | Audio-only participant $0.0005/min; Raw-RTP export → R2 $0.0005/min |
| LiveKit Ship (Track egress) | $0.24 | **$50/mo** | Fallback |
| LiveKit (audio RoomComposite) | $0.48 | $50/mo | Headless Chrome per meeting; not our shape |
| Daily (low volume) | $0.63 | $0 (10k free min) | Screenshare cliff: one video track bills the whole session at 4x |
| 100ms `[claim]` | ~$0.33+ | $0 (10k free min) | ~2x RealtimeKit on audio, no CF-native edge |

**Why RealtimeKit, beyond price:** Raw-RTP into R2 lands audio in our own object store on
the same platform as our Workers backend. Pickup is R2 event → Worker → Workers AI: no
cross-cloud transfer, **no second runtime**, no egress bandwidth bill. LiveKit's Track
egress is comparably cheap but terminates in our storage from *their* network and carries
the Ship floor. Also worth knowing: STT is a rounding error (~$0.03/hr) — transport and
egress dominate by 10x, so optimising the *egress type* is where the money is, not the STT
provider.

**Beta caveat, stated plainly** (research §2.3): RealtimeKit is in Beta (docs updated
2026-07-22). GA pricing is published — a strong signal of intent — but beta means no SLA,
possible API churn, and no guarantee the rates survive to GA. The mitigation is structural,
not contractual: **v1 does not need hosted calls at all**, so RealtimeKit matures during
exactly the window when we do not depend on it. If it is still beta when we need hosted
calls, LiveKit Ship is a fine fallback.

**The 4-op provider interface** (research §2.4, ranked #8 in epic `c9348c5e` as "cheap
insurance") — `createRoom`, `mintParticipantToken`, `startAudioExport`,
`onExportComplete`. Both providers satisfy it. Two companions to it: normalise the ingest
boundary so provider webhooks land in a thin adapter emitting *our* canonical
audio-ready event (the one place where skipping the abstraction is genuinely expensive
later), and keep the transcript write path idempotent and append-friendly keyed on
(meeting, segment start) so batch STT and a future realtime agent both fit. Explicitly do
**not** build container infra or pre-integrate the Agents SDK now.

---

## 6. Sequencing

**In flight — the promote loop** (`0c1a2ac1`). Meeting → extract → proposals → board, on
`feat/meeting-e2e-loop`. Reality check from Task 0 (2026-07-24): the meeting tables
**already live in Neon's `public` schema** and PR20's Supabase cutover never completed, so
Slice A had nothing to move (A.1 cancelled, A.4/A.5 moot). Related cleanup:
`retire-dead-supabase-meeting-822bb4ee`.

**v1** (ranked, epic `c9348c5e`):

1. Board-native promote loop — *in flight*.
2. Granola-style notepad, notes as a relevance prior.
3. Slice-and-queue capture pipeline — 5–15s slices → R2, event-driven. This is a
   *correctness* fix for iOS and backgrounding, not an optimisation: slices keyed by
   (session, sequence) are idempotent, so retry, resume and crash-recovery become one
   mechanism, and unsent slices persist to IndexedDB (research §3.1, §4).
4. Pricing: free = unlimited capture, metered intelligence.
5. Server-authoritative finalize + recording indicator.
6. Ship **without** diarization.
7. Natural-language automation rules over the corpus.
8. 4-op room-provider interface (cheap insurance).
9. Push-to-talk breadcrumbs.

**v1.5 — the external-meetings wedge:**

- **Calendar recognition layer** (`4acd95bd`) — read-only events watch + `syncToken`
  incremental sync on both Google and MS Graph; extract `conferenceData` join links and
  attendees; pre-create the meeting note page; nudge ~1 min before, never silent
  auto-start; retro-associate session → event by time-window overlap keyed on `iCalUID`.
  `calendar.events.readonly` suffices for watch; quotas non-binding. **Highest-leverage
  external item — valuable even before any capture client ships.**
- Chrome extension wedge (`c1d7a77f`), depends on the slice pipeline + calendar layer.
- Tauri desktop collector (`1ff834c9`), macOS Core Audio Tap spike first.
- Unified chat's meeting context (`7de23759`) — **gated on `bdd55b7e`.**

**v2:** hosted org calls on RealtimeKit (§5); companion rungs 2–3 (§4). Realtime assistant
on LiveKit Agents deferred.

**v3:** live in-meeting buddy.

---

## Open items

- **Mobile capture** has no kernel issue and no recorded decision (see §2). File before building.
- **Azure Trusted Signing** non-US-entity eligibility unverified (`1ff834c9`).
- **Tauri on Linux**: WebKitGTK webview quirks to verify at build time (`1ff834c9`).
- **RealtimeKit GA**: beta rates unconfirmed for GA; re-check before v2 commits (research §2.3).
- **Diarization** stays out until the 12x cost / accuracy tradeoff changes (research §3.2).
