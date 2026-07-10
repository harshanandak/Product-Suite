# Web-First Meeting Capture & STT — Research

**Date:** 2026-07-10. All prices/licenses fetched on this date. Claims labelled `[claim]` (vendor self-reported), `[verified]` (primary doc/spec/license text), `[reasoning]` (inference). Unsourced items are quarantined in **Could Not Verify**.

> **Provenance note (2026-07-10):** this file was lost to a cross-session `git clean` and restored from the research agent's original output. Content unchanged. See also the companion [bot economics](2026-07-10-meeting-bot-economics-and-alternatives.md), which **reverses** this file's Tier-2 recommendation on cost grounds.

---

## 1. The Capture Problem

### 1.1 What `getDisplayMedia({audio:true})` actually captures

This is the single most important finding, and it is worse than it looks. From MDN's browser-compat-data (`api/MediaDevices.json`) `[verified]`:

| Browser | Audio capture via getDisplayMedia |
|---|---|
| Chrome | **74+**, with the note: *"On Windows and ChromeOS, the entire system audio can be captured when sharing an entire screen. On Linux and macOS, only the audio of a tab can be captured."* |
| Edge | mirrors Chrome |
| **Firefox** | **NO** (`version_added: false`) |
| **Safari** | **NO** (`version_added: false`) |
| Chrome Android / Firefox Android / Safari iOS | **NO** |

Source: https://github.com/mdn/browser-compat-data/blob/main/api/MediaDevices.json · rendered at https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia#browser_compatibility

Corroborating facts:
- `getDisplayMedia()` itself: Chrome 72+, Firefox 66+, Safari 13+, **Safari iOS: NO**, **Chrome Android: NO** `[verified, same BCD file]`.
- MDN: audio is captured only *"if audio is supported and available for the display surface chosen by the user"*. https://developer.mozilla.org/en-US/docs/Web/API/Screen_Capture_API/Using_Screen_Capture#capturing_shared_audio `[verified]`
- `video: false` **rejects with TypeError** — you cannot request audio-only. You must take a video track you don't want. https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia `[verified]`
- `systemAudio` option: Chrome 105+ only; Firefox/Safari absent `[verified, BCD]`. Chrome's own doc confirms the picker asymmetry: *"Sharing tab audio is offered in 'Chrome Tab' pane, but not in 'Entire Screen' pane"* and warns *"System audio… includes remote participants' own audio, and should not be transmitted back to them."* https://developer.chrome.com/docs/web-platform/screen-sharing-controls `[verified]`

**Verdict on the browser API.** A pure web app can hear other participants **only** on Chrome/Edge desktop. On **macOS — the notetaker market's dominant platform — you cannot get system audio at all**; you can only capture *one tab's* audio, so it works only if the meeting is a browser tab (Meet, Zoom Web, Teams web) and the user picks exactly that tab. On Windows/ChromeOS you can get full system audio, but only if the user shares an *entire screen*. Firefox, Safari, and **all mobile browsers give you nothing**. `[verified + reasoning]`

### 1.2 What real notetakers do (nobody relies on the browser)

| Product | Mechanism | Source |
|---|---|---|
| Otter (OtterPilot) | **Bot joins as participant**, calendar-driven | https://help.otter.ai/hc/en-us/articles/26010355877911 |
| Fireflies | **Bot** (fred@fireflies.ai); also Google Meet **SDK** integration + **desktop app** | https://guide.fireflies.ai/articles/9554534786 |
| Fathom | **Bot** + **desktop app or browser extension** | https://help.fathom.video/en/articles/449088 |
| Granola | **Desktop only, no bot.** *"There is no meeting bot — Granola runs only on your computer and uses your system audio and microphone."* *"The web interface at notes.granola.ai is for viewing and editing existing notes only — it cannot capture or transcribe."* | https://docs.granola.ai/help-center/taking-notes/transcription |
| tl;dv | **Bot** or bot-free **desktop app** | https://intercom.help/tldv/en/articles/14433337-bot-free-recording |
| Read.ai | **Bot** + bot-free **desktop app** + Meet add-on | https://www.read.ai/articles/why-is-read-ai-in-my-meeting-what-to-know |

**None of the six capture from a plain web page with no extension, no bot, and no desktop app.** `[verified]`

### 1.3 The bot-joins-the-meeting layer

- **Recall.ai** — universal Meeting Bot API (Zoom/Meet/Teams) + Desktop Recording SDK + Calendar API. **$0.50 / recording-hour**; transcription **+$0.15/hr**; no platform fee. https://www.recall.ai/pricing `[verified]`
- **Vexa** (`Vexa-ai/vexa`) — **Apache-2.0**, self-hosted Docker/K8s. Bot joins Meet/Teams/Zoom, streams speaker-attributed transcripts. Whisper unit self-hostable for air-gapped use. https://github.com/Vexa-ai/vexa `[verified]`
- **Attendee** (`attendee-labs/attendee`) — "open source API for managing meeting bots." Django + Postgres + Redis. Notably: *"Google Meet doesn't provide any support at all, so you need to run a full instance of Google Meet in Chrome."* https://github.com/attendee-labs/attendee `[verified; license text unconfirmed]`
- **Zoom RTMS** is the sanctioned no-bot path: *"Instead of having participant bots or automated clients in meetings, use RTMS apps to collect the media data."* https://developers.zoom.us/docs/rtms/ `[verified]`

| Option | Hears all participants? | Friction |
|---|---|---|
| `getDisplayMedia` tab audio | Yes, if meeting is a tab | Chrome/Edge desktop only; picker every session; **no macOS system audio**; no Safari/Firefox/mobile |
| Bot joins call | Yes, all platforms | Visible participant; consent/ToS burden; ~$0.50/hr (Recall) or you operate headless Chrome |
| Desktop app | Yes | An install, per-OS audio drivers |
| Browser extension | Meet/Teams web only | Store review; per-platform DOM coupling |
| Platform APIs (Zoom RTMS, Meet SDK) | Yes | Per-platform integration, app review, admin install |

---

## 2. STT Options

### 2.1 Self-hostable (no account)

| Engine | License (code / weights) | Streaming | Speed | Diarization | CPU-only |
|---|---|---|---|---|---|
| [openai/whisper](https://github.com/openai/whisper) | MIT / MIT | No (30s chunks) | reference, slowest | No | slow |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) | MIT / MIT | Yes (`whisper-stream`) | large-v2 65s w/ FlashAttn `[claim]` | `tinydiarize` (turn-only) | **Yes — its design**; WASM build |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) | MIT / MIT | No (chunked) | large-v2 int8 59s vs 2m23s ref `[claim]` | No | **Yes, strong (int8)** |
| [WhisperX](https://github.com/m-bain/whisperX) | BSD-2 / (wraps others) | No (batched) | 60–70× RT batched `[claim]` | **Yes** (pyannote) | Yes |
| [Parakeet-tdt-0.6b-v2](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2) | CC-BY-4.0 / CC-BY-4.0 | Not by default | **WER 6.05 / RTFx 3386** `[claim, self-reported]` | No | GPU-first |
| [Moonshine](https://github.com/moonshine-ai/moonshine) | MIT / **EN MIT; other langs non-commercial** | **Yes** | 107ms MacBook / 802ms Pi5 `[claim]` | No | **Yes, excellent** |
| [Vosk](https://github.com/alphacep/vosk-api) | Apache-2.0 / Apache-2.0 | **Yes, zero-latency** | 50MB models | speaker ID, not diarization | **Yes, primary target** |
| [Kyutai STT](https://github.com/kyutai-labs/delayed-streams-modeling) | MIT+Apache / **CC-BY-4.0** | **Yes, native** (0.5s delay) | H100 = 400 streams RT `[claim]` | No | GPU-oriented |
| [WhisperLive](https://github.com/collabora/WhisperLive) | MIT | Yes | backend-dependent | **Yes** (pyannote online) | Yes |

### 2.2 Hosted APIs (all REST/WS + bearer token ⇒ **BYO-key is trivial** `[reasoning]`)

| Provider | Streaming | Diarization | ~USD/hr |
|---|---|---|---|
| [Groq whisper-large-v3-turbo](https://groq.com/pricing) | **No — batch only** | No | **$0.04** |
| [Speechmatics](https://www.speechmatics.com/pricing) | Yes | Yes | from $0.129 |
| [AssemblyAI Universal-Streaming](https://www.assemblyai.com/pricing) | Yes | Yes (self-correcting labels) | **$0.15** |
| [Deepgram Nova-3](https://deepgram.com/pricing) | Yes, WS | Yes | ~$0.26 batch / ~$0.46 stream (see CNV) |
| [Sarvam saarika/saaras](https://www.sarvam.ai/api-pricing) | Yes | Add-on | ₹30/hr ≈ $0.35 |
| [Gladia Solaria](https://www.gladia.io/pricing) | Yes, "sub-300ms" | Yes, all tiers | $0.61 async / $0.75 RT |
| [OpenAI](https://platform.openai.com/docs/pricing) | Realtime API (WS) | Historically none | gpt-realtime-whisper $1.02 |
| [**Cloudflare Workers AI** `@cf/openai/whisper-large-v3-turbo`](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/) | Batch: Yes (no streaming API documented) | No | **$0.00051/audio-min = $0.0306/hr** |

Workers AI is the cheapest hosted option on this table — ~**9.4×** below Deepgram Nova-3 monolingual streaming ($0.288/hr) and ~**15×** below Flux multilingual ($0.468/hr) — and it's already inside the stack. (It has no diarization, so the comparison is transcription-only.) `[verified pricing; comparison is reasoning]`

### 2.3 In-browser (no server)

- **Moonshine Web** — React+Vite, `moonshine-base` ONNX, *"runs locally in the browser using Transformers.js and WebGPU-acceleration (or WASM as a fallback)"*, Apache-2.0. https://github.com/huggingface/transformers.js-examples/tree/main/moonshine-web `[verified]`
- **whisper-web** (xenova) — Whisper via Transformers.js. https://github.com/xenova/whisper-web `[verified]`
- **whisper.cpp** ships `whisper.wasm` / `stream.wasm` browser targets. `[verified]`

**Honest read:** these exist and demo well on small models with WebGPU. **No independent 2026 benchmark of sustained hour-long meeting transcription in-browser was found** (see CNV). Treat in-browser STT as a *privacy/offline demo tier and a self-host fallback*, not the default quality path: it competes for the same GPU as the user's video call. `[reasoning]`

---

## 3. Diarization

| System | Code | Weights | Gated? | Streaming |
|---|---|---|---|---|
| [pyannote.audio](https://github.com/pyannote/pyannote-audio) | **MIT** | seg-3.0 / diar-3.1 = MIT; **community-1 = CC-BY-4.0** | **Yes — HF accept-conditions wall + marketing opt-in** | Offline |
| [NVIDIA streaming Sortformer 4spk-v2](https://huggingface.co/nvidia/diar_streaming_sortformer_4spk-v2) | — | **CC-BY-4.0** | **No wall** | **Yes** (0.32s / 1.04s configs); ≤4 speakers |
| [3D-Speaker](https://github.com/modelscope/3D-Speaker) | Apache-2.0 | Apache-2.0 | **No** | Offline |
| [ReDimNet](https://github.com/IDRnD/redimnet) / [SpeechBrain ECAPA](https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb) | MIT / Apache-2.0 | ungated | No | embeddings **only** |

**The open, license-clean answer is NVIDIA streaming Sortformer** (CC-BY-4.0, no gate, genuinely streaming) with **3D-Speaker (Apache-2.0)** as the offline pipeline. pyannote is the most turnkey but its HF gate is a hard blocker for the "no proprietary account" promise — **WhisperX inherits that gate** (it wraps pyannote and needs `--hf_token`). `[verified]`

---

## 4. Transport / Architecture on Cloudflare

From https://developers.cloudflare.com/workers/platform/limits/ `[verified]`:
- **Memory: 128 MB. Worker size: 10 MB. CPU time: max 5 min (default 30s).**
- **Duration (wall clock): HTTP request = *no limit* while the client stays connected.** Durable Objects = **unlimited** while the caller stays connected.
- Cron/Queue/DO-alarm handlers = 15 min.

⇒ **A Worker can hold a long-lived WebSocket for a whole meeting.** `[verified]`
⇒ **In-Worker Whisper inference is impossible**: a 10 MB bundle cap and 128 MB memory cannot hold Whisper weights, and 5 min CPU won't cover an hour of audio. Inference must go to Workers AI or an external provider. `[reasoning, grounded in the limits above]`

**Durable Objects + WebSocket Hibernation** is the right primitive: *"Clients remain connected while the Durable Object is not in memory"*, and *"Billable Duration (GB-s) charges do not accrue during hibernation"*. https://developers.cloudflare.com/durable-objects/best-practices/websockets/ `[verified]` One DO per meeting = the natural session/coordination object.

**Cloudflare Realtime** ships **RealtimeKit** (high-level SDK), the **Realtime SFU** (low-level, *"Requires deep WebRTC knowledge. No SDK provided"*), and **TURN**. https://developers.cloudflare.com/realtime/ `[verified]`
**LiveKit server is Apache-2.0** and self-hostable. https://github.com/livekit/livekit `[verified]`

**Recommendation:** you do not need an SFU. You are not routing media between participants — you are shipping one client's audio to one backend. **Raw WebSocket → Durable Object** is sufficient. Add LiveKit only if you later build a bot that must *join* WebRTC calls. `[reasoning]`

**Migration boundary (this is a future streaming path, not a rewrite of today's endpoint).** The current backend contract is `POST /meetings/{id}/transcribe` — multipart chunks, batch. That stays as the **upload/batch** path and is what Cloudflare Whisper drops into first. The Raw-WebSocket → Durable Object path is an **additional, live-streaming** transport added later behind the same `CaptureSource`/`SpeechProvider` seams, not a replacement — clients on the multipart endpoint keep working, and streaming is opt-in per capture tier. `[reasoning]`

**Rust/WASM:** useful in exactly two places — (a) **client-side**: resample/VAD/Opus-encode before upload, and the in-browser engine tier; (b) **self-host container**: whisper.cpp / faster-whisper. It is **not** useful inside a Worker (bundle + memory caps). `[reasoning]`

---

## 5. The No-Lock-In Design

The standard pattern is a **provider interface + adapters**, with three tiers — (1) a bundled default engine needing no account, (2) BYO-key adapters for every hosted API, (3) an optional hosted default.

- **Meetily** (`Zackriya-Solutions/meeting-minutes`) — **MIT**, Tauri (Rust + Next.js), captures **mic + system audio** at the OS layer, local Whisper/Parakeet + Ollama, fully offline. `[verified]`
- **Vexa** — Apache-2.0, bot-based, Whisper self-hostable, air-gap ready. README: *"Every meeting-AI tool… sends your conversations to their cloud and rents you access back. Vexa inverts that."* `[verified]`
- **Amurex** — **AGPL-3.0**, browser extension for Meet/Teams web, self-hostable backend. `[verified; capture mechanism not documented → CNV]`
- **Screenpipe** — **license flipped 2026-06-10 to a proprietary source-available license**: free only for personal/non-commercial/eval; hosting-as-a-service prohibited. https://github.com/mediar-ai/screenpipe/blob/main/LICENSE.md `[verified]`

**The lesson:** Screenpipe is the cautionary tale and the reason to pick permissive deps deliberately. Meetily (MIT) and Vexa (Apache-2.0) are the credible "no account" precedents — and **both abandoned the browser for capture**: Meetily is a desktop app, Vexa is a bot.

---

## 6. Synthesis

**Capture strategy.** Ship a **capture ladder** behind one `CaptureSource` seam:
1. **Tier 0 (web — TO BUILD, not yet present):** `getDisplayMedia({video:{displaySurface:"browser"}, audio:true, systemAudio:"exclude", selfBrowserSurface:"exclude"})` + `getUserMedia` mic, mixed via WebAudio. (The repo's only current `getDisplayMedia` call is screenshot-only, `audio:false`, in `packages/ui-chat/.../prompt-input.tsx` — no audio-capture path exists yet.) Would work on Chrome/Edge desktop for tab-based meetings. Detect and *tell the user* on Safari/Firefox/mobile rather than failing silently. Discard the forced video track.
2. **Tier 1 (self-host parity):** a **bot** (Vexa/Attendee-style headless Chrome).
3. **Tier 2 (hosted convenience):** Recall.ai at $0.50/hr, or a desktop helper.

> **SUPERSEDED by the bot-economics research.** Self-hosting a bot only pays back above ~8,700 meeting-hours/month; **start on Recall.ai** and add **Zoom RTMS** (bot-free, terminates in a Durable Object) as the efficient path. Also add **browser-mic capture for in-person meetings**, which works everywhere and was missed in this file's ladder.

Do not pretend Tier 0 is sufficient. It is a Chrome-desktop, tab-meeting feature — and on macOS it cannot hear system audio at all.

**Default self-hosted STT:** **faster-whisper** (MIT code + MIT weights, viable CPU int8) with **whisper.cpp** for the CPU/edge and WASM build. **Default hosted:** **Cloudflare Workers AI whisper-large-v3-turbo** at **$0.0306/hr** — same stack, no new vendor — with **Deepgram/AssemblyAI as BYO-key streaming adapters** when live captions matter. Keep the existing `SpeechProvider` seam; add `supportsStreaming` and `supportsDiarization` capability flags so the UI degrades honestly.

**Diarization default:** streaming **Sortformer** (CC-BY-4.0, ungated). Avoid pyannote in the default path — its HF gate breaks "no proprietary account."

### Top 5 decisions by impact/cost
1. **Accept that "web-first" ≠ "browser-captures-everything"** — ship the capture ladder, not one mechanism.
2. **One Durable Object per meeting, WebSocket Hibernation** — long-lived session, no idle billing.
3. **Workers AI as hosted default** ($0.0306/hr) — 25× cheaper than Deepgram streaming, no new vendor.
4. **faster-whisper as the bundled self-host engine** — MIT top-to-bottom, CPU-viable, no account.
5. **Sortformer over pyannote** for diarization — the only choice consistent with the no-account promise.

### Top 3 traps
1. **macOS has no system audio in the browser, ever.** Any roadmap assuming otherwise is dead on arrival for the majority of notetaker users.
2. **pyannote's HuggingFace gate** silently contaminates "fully open" — WhisperX inherits it.
3. **License drift in your dependencies.** Screenpipe went proprietary on 2026-06-10; Moonshine's non-English weights are non-commercial. Pin licenses and re-check at each bump.

---

## Could Not Verify

- **Deepgram Nova-3 exact per-minute price** (pricing table is JS/image-rendered); the $0.0043/min batch and $0.0077/min streaming figures come from a **secondary** source. Diarization add-on price unknown.
- **AssemblyAI Universal-Streaming latency in ms** — page says only "ultra-low latency."
- **Speechmatics** real-time-vs-batch price split; exact latency figure.
- **OpenAI gpt-4o-transcribe / mini per-minute** from the primary pricing page; whether gpt-4o-transcribe offers diarization at all.
- **Sarvam diarization surcharge** (~$0.53/hr) — secondary source.
- **Cloudflare Workers AI whisper: no streaming interface.** The model page documents a single base64 request and `Batch: Yes`; it does **not** explicitly state that streaming is unsupported. Absence of a documented WS API is inference.
- **Live HuggingFace Open ASR Leaderboard ordering** — the Space is JS-rendered and did not load. Only `parakeet-tdt-0.6b-v2` WER 6.05 / RTFx 3386 was read from its HF card (self-reported).
- **All self-hosted speed/WER numbers above are project self-reported**, not independently reproduced.
- **Independent benchmark of sustained in-browser (WASM/WebGPU) hour-long meeting transcription** — none found. The "usable in 2026?" question is therefore *unproven*, not *answered*.
- **`attendee` SPDX license** — README says "open source"; license file text unread.
- **`whisper_streaming` exact license** — LICENSE file not read.
- **Amurex capture mechanism** — README does not state it.
- **Zoom/Meet/Teams recording-consent policy pages** — not fetched verbatim. (Recording *availability* was separately verified: Meet and Teams gate recording behind paid tiers; Zoom's free tier allows local recording only.)
