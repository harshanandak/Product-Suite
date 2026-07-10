# Meeting-Capture Economics: Bot vs. No-Bot

**Date:** 2026-07-10 · **Context:** Cloudflare Workers + Neon stack
**Labels:** `[verified]` primary docs · `[claim]` vendor self-reported · `[reasoning]` our arithmetic

---

## 0. Answer first

**The founder's instinct is directionally right but the reason is wrong.** A headless-Chrome bot container is *not* expensive in raw compute — it is roughly **$0.03–0.16 per concurrent-meeting-hour** depending on host, versus Recall.ai's **$0.50/hr**. The compute is cheap. What is expensive is **maintenance** (browser automation breaks when Zoom/Meet/Teams change their UI) and **idle/packing waste**. Self-hosting only pays back above roughly **8,000–9,000 meeting-hours/month** `[reasoning]`.

**The genuinely cheaper, simpler path exists but only for Zoom.** Zoom RTMS eliminates the container entirely and can terminate directly in a Cloudflare Durable Object. Google Meet and Microsoft Teams have **no viable no-container path today**. So the right architecture is a **hybrid**: RTMS for Zoom, bot as fallback for Meet/Teams.

---

## 1. What a bot actually costs to self-host

### 1.1 Resource envelope per concurrent meeting

Hard primary figures are scarce. What is verifiable:

- Microsoft requires app-hosted media bots to run on a VM with **at least two CPU cores**, and recommends four vCPU minimum for non-Dv2 Azure VM types, on **Windows Server** `[verified]` ([MS Learn](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/calls-and-meetings/requirements-considerations-application-hosted-media-bots)).
- Vexa's README documents that transcription is a **separate GPU unit** and that the bot stack itself runs **GPU-free**; it publishes no per-bot CPU/RAM figure `[verified]` ([Vexa README](https://github.com/Vexa-ai/vexa)).
- Attendee runs as a **single Docker image (Django) + Postgres + Redis** `[verified]` ([Attendee self-hosting](https://attendee.dev/blog/self-hosting-attendee)). It publishes **no sizing or cost-per-hour numbers** — the "up to 10x cheaper" figure is unquantified vendor marketing `[claim]`.

**Working assumption for all arithmetic below: 2 vCPU + 4 GB RAM per concurrent meeting** `[reasoning]`, anchored on Microsoft's documented 2-core floor. Headless Chrome rendering a gallery view is the cost driver; audio-only decode is cheap.

### 1.2 Price per concurrent-meeting-hour (2 vCPU / 4 GB)

| Host | Rate source | $/concurrent-meeting-hour | Arithmetic |
|---|---|---|---|
| **Hetzner CPX31** (4 vCPU/8 GB) | $0.0321/hr `[claim]` ([Spare Cores](https://sparecores.com/server/hcloud/cpx31)) | **$0.016** | 2 bots packed per node → 0.0321 ÷ 2 `[reasoning]` |
| **Fly.io** `shared-cpu-2x`, 4 GB | $0.0297–$0.0343/hr `[verified]` ([Fly pricing](https://fly.io/docs/about/pricing/)) | **$0.030–0.034** | direct, region-dependent |
| **Fargate Spot** (x86) | up to −70% `[claim]` | **$0.030** | 0.09874 × 0.30 `[reasoning]` |
| **Fargate Graviton** | −20% vs x86 `[claim]` | **$0.079** | 0.09874 × 0.80 `[reasoning]` |
| **AWS Fargate** (x86, us-east-1) | $0.04048/vCPU-hr, $0.004445/GB-hr `[claim]` ([AWS](https://aws.amazon.com/fargate/pricing/)) | **$0.099** | (2×0.04048) + (4×0.004445) `[reasoning]` |
| **Railway** | $20/vCPU/mo, $10/GB/mo `[verified]` ([Railway](https://docs.railway.com/reference/pricing)) | **$0.111** | (2×0.000463 + 4×0.000231) × 60 `[reasoning]` |
| **Cloud Run** (instance-based, us-central1) | $0.000018/vCPU-s, $0.000002/GiB-s `[verified]` ([GCP](https://cloud.google.com/run/pricing)) | **$0.158** | (2×3600×0.000018) + (4×3600×0.000002) `[reasoning]` |

**Cloud Run is disqualified regardless of price.** Its request timeout maxes at **3600 seconds (60 minutes)**, and WebSocket streams are HTTP requests subject to that timeout `[verified]` ([Cloud Run WebSockets](https://docs.cloud.google.com/run/docs/triggering/websockets)). A 61-minute meeting gets cut off. Any open WebSocket also forces instance-based billing `[verified]`, so you lose the serverless discount anyway.

### 1.3 Versus Recall.ai

Recall.ai's Pay-As-You-Go rate is **$0.50/hr of recording** `[verified]` ([pricing page](https://www.recall.ai/pricing)), reduced from $0.70 in 2026, with built-in transcription at **$0.15/recording-hour**, **no monthly platform fee**, 7-day free storage, then $0.05/media-hour per 30 days `[verified]` ([2026 pricing post](https://www.recall.ai/blog/new-recall-ai-pricing-for-2026)). All-in: **$0.65/hr**.

### 1.4 Break-even `[reasoning]`

Compare Recall's **$0.50** recording line against self-hosted compute (transcription is a wash — you pay for STT either way).

Bots do **not** idle-free. Assume **60% packing efficiency** (lobby waits, meetings running over, scheduling gaps). Fly at $0.034/hr ÷ 0.6 = **$0.057 effective**. Savings = $0.50 − $0.057 = **$0.443/meeting-hour**.

Costs self-hosting adds, at a $150k/yr fully-loaded engineer ($12,500/mo):
- **Build:** 2–4 weeks `[claim]` ([meetingstack](https://meetingstack.io/insights/meetingbaas-pricing/)). Take 3 weeks ≈ $8,650, amortized over 12 months = **$721/mo**.
- **Maintenance:** browser-automation upkeep as platforms change UI. Assume **25% FTE = $3,125/mo**.

**Break-even = ($3,125 + $721) ÷ $0.443 ≈ 8,680 meeting-hours/month.**

At ~45 min average, that is **~11,600 meetings/month**. Below ~5,000 hours/month Recall wins outright and it isn't close. The compute saving is real but it is dwarfed by one engineer's partial attention.

### 1.5 Cold start

**No primary source found** for headless-Chrome-joins-a-call latency. Bots can be spun on demand — Fly Machines bill per second and Fargate per second — so idling between meetings is a *choice*, not a requirement. But the join sequence (boot container → launch Chrome → authenticate → clear the waiting room) is human-scale, and admission depends on a host clicking "Admit." See **Could Not Verify**.

---

## 2. Can we avoid the bot? Platform-native paths

### Zoom RTMS — **yes, genuinely bot-free**

RTMS "gives your app access to live audio, video, and transcript data … **Instead of having participant bots** or automated clients in meetings" `[verified]` ([Zoom docs](https://developers.zoom.us/docs/rtms/)).

- **Delivers raw audio.** Two-phase WebSocket: a signaling socket negotiates stream types, then a media socket streams **raw audio frames and speaker-separated audio channels** `[verified]` ([Zoom dev blog](https://developers.zoom.us/blog/realtime-mediastreams-websockets/)).
- **Open standard.** "You do not need the SDK or library … you can connect directly using any WebSocket client in any language" `[verified]` (ibid). Handshake is `HMACSHA256(client_id + "," + meeting_uuid + "," + rtms_stream_id, client_secret)`.
- **Not free.** "To use RTMS, you'll need **credits** on your account" `[verified]` ([Zoom docs](https://developers.zoom.us/docs/rtms/)). Volume discounts above 500 credits require contacting sales. **The dollar value of a credit could not be verified** — see below.
- **Access:** requires a General app with granular RTMS scopes, admin-managed if using admin scopes, plus `RTMS Started`/`RTMS Stopped` event subscriptions; **enablement is currently request-gated** per numerous forum threads `[claim]` ([Zoom devforum](https://devforum.zoom.us/t/request-to-enable-real-time-media-streams-rtms/143618)).

**Cloudflare fit: excellent.** Your client dials *out* to Zoom's WebSocket. A Durable Object can hold that connection, own the heartbeat/reconnect state machine, and fan audio to STT `[reasoning]`. Caveat, straight from Zoom: "any data that isn't captured during disconnects is **gone forever**" `[verified]`. A DO's single-threaded, hibernation-capable socket is a good match, but you must persist buffers.

### Google Meet Media API — **not usable in production**

- Status: **Developer Preview** `[verified]`.
- The blocker: "the Google Cloud project, OAuth principal, **and all participants in the conference** must be enrolled in the Developer Preview Program" `[verified]` ([overview](https://developers.google.com/workspace/meet/media-api/guides/overview)). You cannot ship a product that requires every attendee to enroll in a Google preview program.
- Cannot connect to encrypted or watermarked meetings; rejects connection when underage accounts are present; requires a consenter in the call `[verified]` (ibid).
- Audio is capped — Meet transmits the **three loudest participants** across three SSRCs `[claim]` ([Recall](https://www.recall.ai/blog/what-is-the-google-meet-media-api)); the docs corroborate a three-audio-stream negotiation shape `[verified]` (ibid).
- **Cloudflare fit: none.** It is WebRTC/SRTP over UDP with data channels, and the reference client is C++. Workers cannot terminate WebRTC `[reasoning]`.

### Google Meet Add-ons SDK — **no audio**

Embeds your app's UI inside Meet. Google explicitly directs media access to the Media API instead `[verified]` ([Add-ons overview](https://developers.google.com/workspace/meet/add-ons/guides/overview)). Dead end for capture.

### Microsoft Teams — **no no-container path**

- **App-hosted media bot:** must be written in **C# on .NET**, deployed to **Azure**, on a **Windows Server** guest OS, ≥2 cores, using `Microsoft.Graph.Communications.Calls.Media`, with the `Calls.AccessMedia.All` permission `[verified]` ([MS Learn](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/calls-and-meetings/requirements-considerations-application-hosted-media-bots)). This is *strictly worse* than a Linux bot container — it's a Windows VM you must run in Azure specifically.
- **Compliance recording:** policy-based, admin-enforced, but works **only through Microsoft-certified partner solutions running recording bots inside the tenant**, and requires E3/E5-class licensing `[verified]` ([MS Learn](https://learn.microsoft.com/en-us/microsoftteams/teams-recording-compliance)). Still a bot; also a certification program you'd have to enter.
- There is **no RTMS equivalent** for Teams.
- **Cloudflare fit: none.**

---

## 3. In-app calls — host the meeting ourselves

| Option | License | Cost | Server-side audio access |
|---|---|---|---|
| **Cloudflare Realtime SFU** | managed | **$0.05/GB egress**, first 1,000 GB free; only Cloudflare→client traffic is billed, push-to-Cloudflare is free `[verified]` ([CF](https://developers.cloudflare.com/realtime/pricing/)) | You pull tracks yourself |
| **Cloudflare RealtimeKit** | managed, **Beta, free during beta** | At GA: audio-only participant **$0.0005/min**; raw RTP export to R2 **$0.0005/min**; real-time transcription via Workers AI `[verified]` ([CF](https://developers.cloudflare.com/realtime/realtimekit/pricing/)) | Yes — raw RTP export to R2 |
| **LiveKit** (self-host) | **Apache-2.0** | compute only | **Yes.** Agents "subscribe to other participants' audio tracks and process them through a VAD-gated STT model" `[claim]` ([LiveKit](https://livekit.io/blog/voice-agent-architecture-stt-llm-tts-pipelines-explained)) |
| **LiveKit Cloud** | managed | Build $0; Ship from $50/mo; Scale from $500/mo `[verified]` ([pricing](https://livekit.io/pricing)) | Yes |
| **Daily.co** | managed | audio-only **$0.00036–$0.00099/participant-min**; audio-only recording **$0.005/recorded-min** `[verified]` ([Daily](https://www.daily.co/pricing/video-sdk)) | Via recording/raw tracks |
| **Jitsi** | Apache-2.0 | compute only | Yes (Jibri/JVB) |

**Worked example, 5-person audio meeting, one hour** `[reasoning]`:
- RealtimeKit at GA: 5 × 60 × $0.0005 = **$0.15**, plus raw-RTP export $0.03 = **$0.18/meeting-hour**.
- Daily at list audio-only: 5 × 60 × $0.00099 = **$0.297**; at volume rate = **$0.108**.
- Cloudflare SFU raw: egress-only. Assuming ~32 kbps Opus (≈14.4 MB/participant-hour, *our assumption, not a cited figure*), a 5-way mesh-through-SFU pulls ~288 MB → **~$0.014/meeting-hour**, and the first 1,000 GB/mo is free.

**Cloudflare Realtime SFU is the cheapest capture surface here** — because you're billed on bytes, not participant-minutes, and audio bytes are tiny. It is an order of magnitude below the *managed* options (Recall.ai $0.50/hr, RealtimeKit $0.18/hr); against self-hosted bot *compute* (Hetzner ~$0.016/hr) the gap is small (~12%). The saving is real but it only exists for calls you host yourself.

**Is in-app video a moat or a distraction?** The media plumbing is *not* the hard part — LiveKit, Daily, and RealtimeKit hand you echo cancellation (browser WebRTC APM), device selection, screen share, and reconnect. The hard part is **getting anyone to move their meeting out of Zoom/Teams/Meet and into your product**. That is a go-to-market problem, not an engineering one, and no amount of SFU work solves it. **Distraction — unless the meeting itself is the product.** Build it for the calls you already own (in-product demos, support calls), never as a Zoom-replacement play.

---

## 4. Synthesis

### Ranking: cost × engineering effort × coverage

| Rank | Mechanism | $/meeting-hr | Eng cost | Coverage |
|---|---|---|---|---|
| 1 | **Zoom RTMS** | credits (unverified) + ~$0 infra | Low — a WebSocket client in a Durable Object | Zoom only |
| 2 | **Recall.ai** | $0.65 all-in | Lowest — an HTTP call | Zoom + Meet + Teams |
| 3 | **In-app (CF Realtime SFU)** | ~$0.01–0.18 | High — you own the client | Only calls you host |
| 4 | **Self-hosted bot (Fly/Hetzner)** | $0.02–0.06 compute + ~$3.1k/mo upkeep | Highest ongoing | Zoom + Meet + Teams |
| 5 | **Teams app-hosted media bot** | Windows VM in Azure | Very high (C#/.NET/Windows) | Teams only |
| 6 | **Meet Media API** | n/a | n/a | **Unusable** (all participants must enroll) |

Note that **no** mechanism covers **in-person** meetings. That requires device-side capture (Recall's Desktop Recording SDK is priced the same $0.50/hr `[verified]`) — a separate problem.

### Is a self-hosted bot the efficient choice?

**No — not at your stage.** The founder is worried about the wrong line item. Container compute is $0.03/hr; Recall charges $0.50/hr. The 16x markup buys you an engineer you don't have to hire and a UI-breakage treadmill you don't have to run. **Start on Recall.ai.** Revisit self-hosting (Vexa is confirmed Apache-2.0; **Attendee's license is unverified** — pending a license read) only when you cross **~8,000 meeting-hours/month**, and revisit it as a *cost-reduction project with a named owner*, not as a founding architectural decision.

### The hybrid — yes, and it's the right answer

**Zoom RTMS where it exists, bot as fallback.** Zoom is typically the plurality of B2B meeting volume. RTMS removes the container, removes the visible bot participant (a real UX and trust win), and terminates natively in a Durable Object on your existing Cloudflare stack. Meet and Teams have no such path, so route those through Recall.ai (or, later, your own bots). Build the ingestion layer so that **RTMS frames and bot-captured frames land in the same audio pipeline** — then the capture mechanism becomes a swappable adapter rather than an architectural commitment.

### Top 3 cost traps at scale

1. **Packing and idle, not the hourly rate.** You pay for *machine*-minutes, not *meeting*-minutes. Bots sitting in lobbies, meetings running 20 minutes over, and 30-minute booking gaps between back-to-backs can push effective utilization to 50–60%, silently doubling your real per-hour cost `[reasoning]`.
2. **Egress and storage, billed on the platform's terms.** Railway and Cloudflare charge **$0.05/GB** egress `[verified]`; Fly charges **$0.02/GB** in NA/EU but **$0.04/GB** in APAC/South America `[verified]`. Recall's free storage expires at **7 days**, then $0.05/media-hour per 30 days `[verified]` — media retention is the line item that grows forever while everything else is a flow.
3. **The maintenance treadmill.** Bots scrape the DOM. Zoom, Meet, and Teams ship UI changes on their schedule, not yours, and each one is an incident. This is the *only* cost that doesn't shrink with scale, and it is what actually makes Recall's markup rational below ~8k hours/month. Add to this **Zoom RTMS credits**, whose price we could not establish — model it before committing.

---

## Could Not Verify

- **Dollar value of a Zoom RTMS credit.** [zoom.us/pricing/developer](https://zoom.us/pricing/developer) is JavaScript-rendered and returned no pricing table. Zoom's docs confirm credits are *required* but not what they cost. **Model this before choosing RTMS.**
- **Attendee's published sizing / cost-per-hour notes.** The self-hosting blog contains no CPU, RAM, or dollar figures. The "up to 10x cheaper" claim is unquantified.
- **Vexa's per-bot CPU/RAM requirements.** The README documents GPU-free bots + separate GPU STT unit, but no per-bot envelope. Third-party snippets citing "16 GB / 4-core" and "2-core/4 GB for 10 concurrent meetings" trace to marketing pages, not primary docs — **do not plan capacity on these.**
- **Cold-start latency** for a headless-Chrome bot booting and joining a call. No primary benchmark found from Vexa, Attendee, or any operator blog.
- **Hetzner rate** was taken from a third-party tracker, not Hetzner's own page — treat as `[claim]` and confirm before budgeting. (The **AWS Fargate** rate is from AWS's own pricing page, cited in the table above.)
- **Whether a Cloudflare Durable Object can sustain a multi-hour outbound WebSocket to Zoom RTMS under load.** Architecturally sound, but untested — no source confirms anyone has done it.
