# Meetily fit assessment — can it power our meeting module?

Date: 2026-07-05 · Source: [Zackriya-Solutions/meetily](https://github.com/Zackriya-Solutions/meetily)
(16k★, 1.7k forks, MIT). Facts below are verified against the repo README +
`docs/architecture.md`, not marketing copy.

## ⚠️ Correction (Fable review, 2026-07-05) — narrows this assessment

A read-only Fable pass against the actual meeting code corrected two things below:

- **The platform ALREADY has a working web transcription+summary pipeline** —
  `apps/meeting-api/backend/server.py` (`OpenAIWhisperSpeechProvider`, browser
  capture → chunked upload → GPT-4o-Transcribe) + real summarization. So Meetly is
  **NOT** a transcription-pipeline source, and there is no need to "re-implement
  capture/STT using Meetly as a blueprint" (struck below) — that already exists.
- **Meetly's speaker diarization is PRO/paid, not MIT.** Do not count it as free IP.

**Net harvest from Meetly shrinks to two things:** (a) its **tuned summary prompts**
→ `apps/meeting-api/backend/services/chapter_summary.py` (hours of work, survives
Phase-2 cutover); (b) its **transcript/summary schema** as a cross-check when
authoring the Neon meeting tables. Reject porting its Next.js UI (meeting-web is
deleted at Phase 2) and its multi-provider abstraction (we've standardized on
OpenAI now / AI-SDK + OpenRouter later). Meetly therefore **reinforces**, not
changes, the roadmap's "invest backend, go light on meeting-web."

**Open blind spot it surfaces:** browser `getUserMedia` cannot capture desktop
Zoom/Meet system audio — the one thing Meetly's native engine solves. Decide later:
meeting bot vs. a desktop companion post-Phase-2 (a Meetly fork could be that
companion, feeding `proposals`). Not now.

## TL;DR

Meetily is excellent and MIT-licensed, **but it is a desktop-first, local-only
app** (Tauri + Rust core + local SQLite), not a web service. It is **not a drop-in**
for our web meeting module (`apps/meeting-web` + `apps/meeting-api`). Use it as a
**reference implementation + component/IP source**, not a base to fork into the
module. The genuinely reusable parts (UI, summarization prompts, provider
abstraction, data model) are real and worth harvesting; the hard desktop engine
(native audio capture + local GPU Whisper) does not transfer to a browser/cloud
module and must be re-implemented.

## What Meetily actually is (verified)

- **License: MIT** — "Feel free to use this project for your own purposes." Full
  legal freedom to fork, adapt, integrate.
- **Shape: self-contained desktop app** built with **Tauri**. Architecture
  (`docs/architecture.md`): Next.js frontend ⇄ *Tauri commands* ⇄ **Rust core**.
  The Rust core holds ALL logic:
  - **Audio Engine** — captures mic + system audio via native OS APIs.
  - **Transcription Engine** — local Whisper/Parakeet (whisper.cpp, C++), GPU-accelerated.
  - **Database** — local **SQLite** (meeting metadata, transcripts, summaries).
  - **Summary Engine** — LLM summaries via Ollama (local) / Claude / Groq / OpenRouter / OpenAI-compatible.
- **Deployment model: 100% local.** "All data stays on your machine." No server,
  no cloud. That is its whole value proposition (privacy/compliance).
- Languages: Rust 46%, TypeScript 30%, C++ 10%, Python 3%. Community edition is
  MIT; PRO/Enterprise (paid) add accuracy, diarization, templates, team self-host.

## Why it is NOT a drop-in for our meeting module

Our module is `meeting-web` (web UI) + `meeting-api` (server) inside a multi-user
web platform. Meetily's core is the opposite deployment model:

| Meetily (desktop/local) | Our meeting module (web/cloud) |
|---|---|
| Tauri native shell (desktop) | Browser web app |
| Rust core does audio + STT + storage on-device | Server API + browser client |
| Native OS audio capture | Browser capture (WebRTC/MediaRecorder) |
| Local GPU whisper.cpp | Server-side or cloud STT |
| Local SQLite, single user | Multi-tenant platform DB + `packages/contracts` |
| Privacy = data never leaves the machine | Shared/collaborative by design |

You cannot run the Rust audio/transcription engine in a browser or as-is on a
server without substantial re-architecture. "End-to-end working" is true — for a
**desktop local-first product**, which is a different shape than a web module.

## What IS worth harvesting (MIT — all legal)

Ranked by leverage:

1. **Summarization prompts + multi-provider LLM abstraction** (highest IP value).
   They've tuned meeting-summary prompts and a clean Ollama/Claude/Groq/OpenRouter
   switch. Lift the approach into `apps/meeting-api`; do not reinvent.
2. **The Next.js meeting UI** — live-transcript view, summary editor, meeting list.
   Already TS/React, so the most directly portable into `packages/ui-meeting` /
   `meeting-web` (adapt, don't copy the Tauri IPC glue).
3. **Data model** — meeting / transcript / summary schema (their SQLite tables) is
   a proven starting point for our `packages/contracts` meeting models.
4. **Reference for correctness** — a stable 16k★ implementation to validate our own
   transcription→summary pipeline design against.

Does NOT transfer: the Rust/Tauri audio-capture + local-Whisper engine, local
SQLite storage, and the local-first privacy model (unless our module is also
local-first).

## Recommendation

- **Posture: reference + component source, not fork-to-become-the-module.**
- Concrete: (a) port/adapt Meetily's Next.js meeting UI into `ui-meeting`;
  (b) lift its summarization prompts + provider abstraction into `meeting-api`;
  (c) adopt its transcript/summary data model into `contracts`; (d) re-implement
  capture + transcription for the web (browser capture + a server STT — your own
  Whisper service or a cloud STT), using Meetily's engine as the blueprint.

## The one question that changes this answer

**Is our meeting module meant to be cloud/web multi-user (what `meeting-web` +
`meeting-api` implies), or could it be desktop / local-first?**

- **Web/cloud (assumed):** Meetily = reference + components, per above.
- **Desktop / local-first (or a Tauri/Electron companion):** then Meetily could be
  **forked much more directly** as the base — a fundamentally cheaper path. If a
  privacy-first desktop meeting capture companion is acceptable, that reframes the
  whole meeting stream.

This assessment feeds the meeting stream of
`docs/plans/2026-07-05-module-parallelization-roadmap.md`.
