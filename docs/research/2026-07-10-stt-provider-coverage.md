# STT provider coverage (verified 2026-07-10)

Every figure below is from the vendor's own pricing page or docs. Anything not sourced is in **Could Not Verify**.

## AssemblyAI

**Pricing** — [assemblyai.com/pricing](https://www.assemblyai.com/pricing)
- Batch: Universal-3.5 Pro **$0.21/hr** (18 languages, native code switching); Universal-2 **$0.15/hr** (99 languages).
- Streaming: Universal-3.5 Pro Realtime **$0.45/hr** (18 languages, self-correcting speaker labels, keyterms included); Universal-Streaming **$0.15/hr** (English only); Universal-Streaming Multilingual **$0.15/hr** (en, es, de, fr, pt, it).
- Speaker Diarization add-on: **$0.02/hr** on both batch models.
- Free tier: 185 hrs batch, 333 hrs streaming.

**Languages** — [supported-languages](https://www.assemblyai.com/docs/speech-to-text/pre-recorded-audio/supported-languages): Universal-3.5 Pro = 18 languages, Hindi is the only Indic one. Universal-2 = 99 languages and explicitly lists Hindi, Tamil, Telugu, Bengali, Marathi, Gujarati, Kannada, Malayalam, Punjabi. **So: all 9 Indic languages → Universal-2 only.**

**Diarization** — [speaker-diarization](https://www.assemblyai.com/docs/speech-to-text/speaker-diarization): `speaker_labels: true`; needs ≥30s continuous speech per speaker. The page states **no language restriction** (see Could Not Verify).

**Streaming diarization**: yes, but only on Universal-3.5 Pro Realtime ("self-correcting speaker labels", 18 languages) per the pricing page. The $0.15/hr streaming tiers do not list it.

**Code-switching**: Universal-3.5 Pro claims "native code switching"; the languages page documents Spanglish (English-Spanish code-mixing). No Hinglish claim.

**Data / training** — [data-retention-and-model-training](https://www.assemblyai.com/docs/data-retention-and-model-training): files *are* used for model training (after PII redaction) unless you are under a BAA, use EU servers, or opt out. [Data Controls](https://www.assemblyai.com/docs/data-controls): opt-out, TTL, and BAA are self-serve **at no additional cost — but paid plan only. Free users cannot opt out.**

**Self-hosting** — [self-hosted-streaming](https://www.assemblyai.com/docs/streaming/self-hosted-streaming): streaming can run in your own VPC (audio never leaves your network), gated on a **$20,000 upfront commercial commitment**. Batch self-hosting is not documented.

## Deepgram

**Pricing** — the pricing page renders prices in JS, but the same numbers are in the page's JSON-LD `Offer` objects at [deepgram.com/pricing](https://deepgram.com/pricing). Pay-as-you-go, $/min (hourly = ×60):

| Item | $/min | $/hr |
|---|---|---|
| Pre-recorded Nova-3 monolingual | 0.0043 | **0.258** |
| Pre-recorded Nova-3 multilingual | 0.0052 | 0.312 |
| Pre-recorded Whisper Large | 0.0048 | 0.288 |
| Streaming Nova-3 monolingual | 0.0048 | **0.288** |
| Streaming Nova-3 multilingual | 0.0058 | 0.348 |
| Streaming Flux English / multilingual | 0.0065 / 0.0078 | 0.39 / 0.468 |
| Streaming Speaker Diarization add-on | 0.0020 | 0.12 |

Growth (prepaid, $4K+/yr) is ~15-20% cheaper. Free $200 credit.

**Languages** — [models-languages-overview](https://developers.deepgram.com/docs/models-languages-overview): Nova-3 monolingual covers ~50 languages including **Bengali, Gujarati, Hindi, Kannada, Marathi, Tamil, Telugu, Urdu — but not Malayalam and not Punjabi.** `language=multi` (code-switching) is 10 languages: en, es, fr, de, **hi**, ru, pt, ja, it, nl.

**Diarization** — [diarization](https://developers.deepgram.com/docs/diarization): tagged "Pre-recorded, Streaming:Nova, Streaming:Flux, **All available languages**". Works on all Nova batch models plus enhanced/base; **Whisper is not supported**. Streaming resolves to the v1 diarizer; `diarize_model=v2` is batch-only and returns a validation error on streaming.

**Code-switching** — [multilingual-code-switching](https://developers.deepgram.com/docs/multilingual-code-switching): `language=multi` on Nova-2/Nova-3, works **both pre-recorded and streaming** (recommends `endpointing=100`). Hindi+English in one utterance is covered.

**Data / training** — [Model Improvement Partnership](https://developers.deepgram.com/docs/the-deepgram-model-improvement-partnership-program): opt out per-request with `mip_opt_out=true`; opted-out request data "is retained only for the duration necessary to process the request." Free, no plan gate.

**Self-hosting** — [self-hosted-introduction](https://developers.deepgram.com/docs/self-hosted-introduction): fully documented (Docker/Podman, Kubernetes, SageMaker) with [self-service licensing](https://developers.deepgram.com/docs/self-hosted-self-service-tutorial).

## Comparison providers

**Cloudflare Workers AI** — `@cf/openai/whisper-large-v3-turbo` is **$0.00051 per audio minute = $0.0306/hr**, batch only ([model page](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/), [pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)). No diarization. [Data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/): "Cloudflare does not use your Customer Content to train any AI models."

**Groq** — [groq.com/pricing](https://groq.com/pricing): whisper-large-v3 **$0.111/hr**, whisper-large-v3-turbo **$0.04/hr** (billed at ≥10s/request). [Speech to Text docs](https://console.groq.com/docs/speech-to-text) list only the two Whisper models, multilingual, transcription/translation — no diarization, no streaming endpoint. [Your Data](https://console.groq.com/docs/your-data): "By default, Groq does not retain customer data for inference requests"; up to 30 days for reliability/abuse; Zero Data Retention is self-serve for all customers.

**Sarvam** — [pricing](https://docs.sarvam.ai/api-reference-docs/pricing): STT **₹30/hr**, STT **with diarization ₹45/hr**, billed per second. [Transcribe API](https://docs.sarvam.ai/api-reference-docs/speech-to-text/transcribe): language codes hi, bn, kn, **ml**, mr, od, **pa**, ta, te, gu, en-IN (plus `unknown` auto-detect); a `codemix` mode returns "मेरा phone number है 9840950950" — English words in Latin, Indic words in native script. **Diarization is available only in the Batch API**, with separate pricing. A WebSocket streaming endpoint exists (`/speech-to-text/transcribe/ws`).

## NVIDIA NeMo family (the self-hosted play)

Gating status below is from the HuggingFace model API (`/api/models/<id>` → `gated`), not from the card prose. **All NVIDIA models checked are `gated: false`** — no token, no terms acceptance, no account. For contrast, `pyannote/speaker-diarization-3.1` returns `gated: "auto"`, which is exactly why it's disqualified.

**Code vs weights are licensed separately.** The NeMo toolkit itself is **Apache-2.0** ([github.com/NVIDIA/NeMo](https://github.com/NVIDIA/NeMo)). The weights carry their own licenses, and they are **not uniform**:

| Model | Weights license | Gated | Languages | Quality | Streaming |
|---|---|---|---|---|---|
| [parakeet-tdt-0.6b-v2](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2) | CC-BY-4.0 | no | **English only** | mean WER **6.05%** (8 Open-ASR sets), RTFx **3380** @ batch 128 | via NeMo chunked script |
| [parakeet-tdt-0.6b-v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) | CC-BY-4.0 | no | 25 European (**no Indic**) | model-index WERs 1.9–18.4 by set | cache-aware streaming script |
| [canary-1b-v2](https://huggingface.co/nvidia/canary-1b-v2) | CC-BY-4.0 | no | 25 European | Open-ASR mean **7.15**, RTFx **749** | not documented |
| [canary-qwen-2.5b](https://huggingface.co/nvidia/canary-qwen-2.5b) | CC-BY-4.0 | no | English | mean WER **5.63%**, RTFx **418** | not documented |
| [diar_streaming_sortformer_4spk-v2](https://huggingface.co/nvidia/diar_streaming_sortformer_4spk-v2) | **CC-BY-4.0** | no | see below | 117M params | **yes, native** |
| [diar_sortformer_4spk-v1](https://huggingface.co/nvidia/diar_sortformer_4spk-v1) | **CC-BY-NC-4.0** | no | — | — | offline |

**Parakeet** v2 handles up to 24 minutes of audio in one pass. v3's card adds a [cache-aware streaming inference script](https://github.com/NVIDIA/NeMo/blob/main/examples/asr/asr_chunked_inference/rnnt/speech_to_text_streaming_infer_rnnt.py) — streaming is a NeMo runtime mode, not a separate checkpoint. Neither model supports any Indic language.

**Canary** is transcription **plus translation**: canary-1b-v2 does ASR in 25 languages and AST English→24 and 24→English. canary-qwen-2.5b is English-only, runs in two modes (ASR, and LLM-over-the-transcript), and posts the best English WER of the family. Neither card documents a streaming mode.

**Sortformer streaming v2** is the genuine unlock: CC-BY-4.0, ungated, native streaming, and its card publishes a latency/RTF table (RTF measured batch-1 on an RTX 6000 Ada): very-high 30.4s @ RTF 0.002 · high 10.0s @ 0.005 · **low 1.04s @ 0.093** · **ultra-low 0.32s @ 0.180**. Limits are explicit: **max 4 speakers** ("performance degrades on recordings with 5 and more"). On language independence, the card is the opposite of a claim — the multilingual badge is **commented out** in the card source, and Technical Limitations reads: *"trained on publicly available speech datasets, primarily in English. As a result: performance may degrade on non-English speech."* **Treat Sortformer as English-first, not language-independent.** Note also that the older **v1 checkpoint is CC-BY-NC-4.0 — non-commercial, unusable for us.**

**Nemotron — both answers are true, so state it precisely.** "Nemotron" is primarily NVIDIA's **LLM** family (Nemotron-3 Nano/Super, `text-generation`; the Omni variants are `any-to-any`). **But speech-ASR Nemotron checkpoints do exist and are distinct from Parakeet/Canary:**
- [nvidia/nemotron-3.5-asr-streaming-0.6b](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b) — 600M cache-aware streaming ASR, **35 languages including Hindi (`hi`)**, ungated, but licensed **OpenMDW-1.1**, not CC-BY. FLEURS English WER 7.91 @ 1.12s frame.
- [nvidia/nemotron-speech-streaming-en-0.6b](https://huggingface.co/nvidia/nemotron-speech-streaming-en-0.6b) — English, ungated, **NVIDIA Open Model License**.

Neither is CC-BY-4.0, so both need a license read before shipping. The 3.5 model is the only NVIDIA ASR checkpoint that covers Hindi.

**Deployment reality.** The [NeMo README](https://github.com/NVIDIA/NeMo) states requirements as Python 3.12+, PyTorch 2.7+ ("CPU, CUDA, etc. — your choice"), and **"NVIDIA GPU + CUDA (required for training; recommended for inference)."** Install is `pip install 'nemo-toolkit[asr]'`. So CPU inference is *permitted*, not *blocked* — but every model card repeats "designed and/or optimized to run on NVIDIA GPU-accelerated systems," no card publishes a CPU number, and there is no vendor int8/CPU path. Triton/NIM/Riva are the *hosted* serving route (the Parakeet card links a NIM API), which reintroduces the third-party account we're trying to remove.

**Is GPU a dealbreaker?** For our stated persona — "runs with no third-party account," i.e. on the user's own laptop or a small VPS — **yes.** RTFx 3380 is a batch-128 datacenter-GPU number and does not survive translation to a CPU box. faster-whisper ([MIT](https://github.com/SYSTRAN/faster-whisper), ungated, [Systran/faster-whisper-large-v3](https://huggingface.co/Systran/faster-whisper-large-v3) `gated: false`) explicitly supports "8-bit quantization on both CPU and GPU" and publishes int8 numbers (13-min audio, 59s, 2926MB). CC-BY-4.0 vs MIT is a non-issue — both are permissive; CC-BY just needs an attribution line. **The GPU dependency, not the license, is what decides this.**

## Synthesis

| Provider | $/hr batch | $/hr streaming | # languages | Indic? | Diarization langs | Streaming diarization? | Trains on your data by default? |
|---|---|---|---|---|---|---|---|
| AssemblyAI | 0.15 (U-2) + 0.02 diar | 0.15 EN / 0.45 Pro-RT | 99 (U-2), 18 (U-3.5 Pro) | all 9, on U-2 | not documented | Yes, U-3.5 Pro RT only | **Yes** (opt-out is paid-plan-only) |
| Deepgram | 0.258 | 0.288 + 0.12 diar | ~50 (Nova-3) | 8 of 9 (no ml, pa) | **all** | Yes (v1 diarizer) | Not documented (opt-out via `mip_opt_out=true`) |
| Workers AI | 0.0306 | — | Whisper's 99 | yes (Whisper) | none | No | No |
| Groq | 0.04 (turbo) | — | Whisper's 99 | yes (Whisper) | none | No training; temp logging by default, ZDR opt-in |
| Sarvam | ₹30 (≈$0.34) | WS endpoint, price n/v | 11 codes | all 9 + Odia | not documented | **No — batch only** | Not documented |

### Recommended default routing

- **English + major EU, batch with speakers** → **AssemblyAI Universal-2** ($0.17/hr all-in). Cheapest hosted option that returns utterances.
- **English + EU, real-time with speakers** → **Deepgram Nova-3 streaming + diarize** ($0.408/hr). If you need Hindi in the same real-time stream, **AssemblyAI Universal-3.5 Pro Realtime** ($0.45/hr) instead.
- **Indic batch with speakers** → **Deepgram Nova-3** ($0.258/hr transcription; **+ diarization add-on** — the batch add-on price is not listed on the pricing page, so budget the $0.12/hr streaming rate as an upper bound until confirmed): the only vendor that documents diarization across *all* its languages. Falls over on **Malayalam and Punjabi → route those to Sarvam batch** (₹45/hr, diarization included).
- **Hinglish / code-mixed** → **Deepgram `language=multi`** (batch *and* streaming, Hindi included), or **Sarvam `codemix` mode** when you want native-script output.
- **No-account / privacy-max** → **faster-whisper (MIT, int8 on CPU)** stays the default; see below. **Workers AI whisper-large-v3-turbo** at $0.0306/hr is the cheap hosted fallback when speakers don't matter and the contract says "we don't train on you."

### Self-host default: faster-whisper, with Parakeet as an opt-in GPU profile

**Ship faster-whisper as the default.** It is the only option that satisfies the actual constraint — *no third-party account, runs on the hardware the user already has*. MIT, ungated, int8 on CPU, 99 languages including all the Indic ones. Parakeet is faster and (in English) more accurate, but its speed is a GPU claim, and a self-hosting user who must first buy a CUDA card has not self-hosted anything.

**Add Parakeet-v2 as a detected GPU profile**, not a default: if CUDA is present, English batch transcription gets meaningfully better (6.05% mean WER, RTFx 3380) at zero licensing cost (CC-BY-4.0, attribution line only). Reach for **canary-qwen-2.5b** if English accuracy is the whole game (5.63%), **canary-1b-v2** if you need speech translation, and **nemotron-3.5-asr-streaming-0.6b** if you need streaming ASR that includes Hindi — but read OpenMDW-1.1 first.

**Replace pyannote with Sortformer-v2 for self-hosted diarization.** pyannote is `gated: "auto"` on HF — an account and a terms click, which is the exact thing we forbid. Sortformer-v2 is CC-BY-4.0, ungated, streams natively down to 0.32s buffer latency, and caps at 4 speakers. The catch: it is English-first by its own card, so **self-hosted Indic diarization remains unsolved** — that workload still routes to Deepgram or Sarvam.

### The traps

1. **AssemblyAI streaming bills wall-clock, not audio.** Per the [streaming docs](https://www.assemblyai.com/docs/speech-to-text/universal-streaming), you are billed for how long the WebSocket stays open, and un-terminated sessions auto-close after **3 hours and bill the full duration**. A leaked socket costs $1.35 on Pro Realtime. Batch has no such failure mode.
2. **"Diarization" is three different products.** Deepgram's streaming diarizer is v1-only (v2 is batch-only and hard-errors on streaming) *and* is a metered add-on; AssemblyAI's cheap $0.15/hr streaming tiers have **no** speaker labels — only the 3× pricier Pro Realtime does; Sarvam's diarization is batch-only. "Streaming + speakers + Indic" is the one corner where no cheap option exists. Related: an AssemblyAI **free-tier** BYO key *cannot* opt out of model training — the opt-out toggle is paid-plan-gated.

3. **Same-family NVIDIA weights, incompatible licenses.** `diar_sortformer_4spk-v1` is **CC-BY-NC-4.0** (non-commercial) while `diar_streaming_sortformer_4spk-v2` is CC-BY-4.0; the two Nemotron ASR checkpoints are OpenMDW-1.1 and NVIDIA Open Model License respectively. Pinning "the Sortformer model" or "the Nemotron ASR model" by family name rather than by exact repo id can silently pull non-commercial weights into a commercial product. Pin exact ids, and re-check `gated` and `license` at pin time.

## Could Not Verify

- **Which languages AssemblyAI diarization supports.** The diarization page states no language restriction and the docs never enumerate one. Universal-3.5 Pro (18 langs) is marketed as having "our most accurate speaker diarization," and the $0.02/hr add-on is priced for both models — but no AssemblyAI page says "diarization works on all 99 Universal-2 languages." Do not assume Indic diarization works; test it.
- **Deepgram pre-recorded diarization price.** The JSON-LD offers list a *streaming* Speaker Diarization add-on ($0.0020/min) and pre-recorded Redaction/Entity Detection, but no pre-recorded diarization line item. Absence is not proof it's free.
- **Whether Deepgram MIP is on by default.** The docs only document the opt-out (`mip_opt_out=true`) and never state the default enrollment in words.
- **Deepgram / AssemblyAI published streaming latency numbers.** Neither pricing page nor the docs pages I read give a p50/p95 figure. AssemblyAI says "ultra-low latency"; Deepgram cites WER reductions, not milliseconds.
- **Sarvam data retention and training policy** — no privacy/retention page exists under `docs.sarvam.ai`.
- **Sarvam streaming price** — the pricing page quotes ₹30/₹45 per hour for STT without separating REST from WebSocket.
- **Sarvam's exact language count.** The transcribe API lists 11 codes; the "Building for Indian Languages" guide says the *stack* covers 23 (22 Indian + English). These are not the same number and the docs don't reconcile them.
- ₹→$ conversions above are mine, not Sarvam's.
- **Whether Sortformer works language-independently.** The card never claims it does and warns non-English degradation; its training set does include Mandarin corpora (AISHELL-4, AliMeeting). NVIDIA publishes no per-language DER. Unknown until we test it on Hindi audio ourselves.
- **Parakeet/Canary VRAM requirements.** No card states a minimum VRAM or GPU-memory figure. "Ampere / Hopper / Blackwell" microarchitecture compatibility is listed; a GB number is not.
- **Any CPU throughput figure for NeMo models.** NeMo permits a CPU PyTorch build and calls GPU "recommended for inference," but no vendor benchmark for CPU inference exists. Do not assume Parakeet is usable on CPU without measuring it.
- **parakeet-tdt-0.6b-v3's headline WER.** Its model-index spans 51 datasets (mostly FLEURS per-language); there is no single published mean comparable to v2's 6.05%. The "mean of listed values" would mix English and multilingual sets and would be meaningless.
- **Whether the two Nemotron ASR licenses permit our use.** OpenMDW-1.1 and the NVIDIA Open Model License were not read — only identified. Both need a legal read before shipping.
