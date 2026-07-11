# Work Ontology & Release Phasing — Design

**Date:** 2026-07-10
**Status:** PROPOSED — awaiting founder review.
**Branch:** `feat/work-ontology`
**Supersedes:** the "modes at the Project level" clause of
[2026-07-10-vision-and-architecture.md](../plans/2026-07-10-vision-and-architecture.md) §6. All other
clauses of that document stand.

**Evidence base.** Every contested claim below is URL-cited in one of:
- [`docs/research/2026-07-10-meeting-bot-economics-and-alternatives.md`](../research/2026-07-10-meeting-bot-economics-and-alternatives.md)
- the license audit in [Appendix A](#appendix-a-license-audit)
- three companion research files (nesting depth; Linear/Huly/Plane teardown; web capture + STT) that
  were lost to a cross-session branch switch and are being restored. Their findings are reproduced
  inline here.

---

## 1. The decision that started this

**Do we build on top of an open-source Linear alternative?** No. **Copy the ontology, not the code.**

Two independent reasons, either sufficient:

1. **Licensing.** Every actively-maintained candidate is copyleft. Plane, Vikunja, Kan and Leantime
   are AGPL-3.0 — §13's network clause obligates us to offer the **AGPL-covered work's** source
   (including our modifications to it) to users who interact with it over a network. That doesn't
   reach *anything* we serve over HTTP, but it does mean forking one of these into a network service
   pulls our changes to it under the same terms — a real constraint for a would-be-commercial product,
   though not the absolute go/no-go the stack mismatch (below) already is. Huly is EPL-2.0. OpenProject is GPL-3.0 *and* demands a CLA. Operately ships a non-standard "Other"
   license. Focalboard is AGPL-or-commercial and unmaintained; Tegon is AGPL and archived; Taiga is
   MPL but dead since Dec 2023. The only fully permissive candidate, Kaneo (MIT), is a plain kanban
   board weaker than what we already have.
2. **Stack.** Plane is Django, OpenProject is Rails, Huly is a custom Rust transactor, Focalboard is
   Go. We are Hono-on-Workers + Neon + Clerk + a React SPA. Forking means abandoning our stack, our
   design system and the shipped Workboard to maintain someone else's monolith. Embedding means two
   auth systems and split-brain data.

Concepts are not copyrightable. Code is. We take the object model and the architectural reasoning,
from docs and engineering write-ups — never source.

---

## 2. The ontology

### 2.1 What was wrong

`work_items` carried **two competing grouping axes**: `department TEXT NOT NULL` and
`project_id UUID NULL`. Every item was filed by department but only *maybe* by project. Neither axis
was authoritative, so "where does this go?" had no answer. That — not the absence of a hierarchy — is
the source of the confusion.

### 2.2 The shape

Linear's docs settle who owns what. Workflow states are configured **per team**, and two teams may
have different ones. Cycles belong to teams and toggle per team. Triage is a team inbox. Every issue
belongs to exactly one team; **project is optional** on an issue. A project may span multiple teams,
carries its own status/health/milestones, and owns no workflow. Initiatives group *projects*, not
issues.

```
Tenant (= Clerk Org = Workspace — one level, unchanged)
  └── Team ............ MANDATORY owner. Carries the mode. Owns statuses, cycles, triage, key.
        └── Item .......... the atom. status, assignee, priority, type.
              ├── Task ....... a FULL Item with a parent_id — owned work. Native create (§2.6.1).
              └── Check ...... a Checklist row. Frozen: title, status, due_date.

  └── Project ......... OPTIONAL, cross-team OUTCOME container.
                        status, lead, target date, milestones. Owns NO workflow.
        └── (Initiative — deferred — groups projects, not Items.)
```

### 2.3 Naming, and why not "connected tasks"

We already ship `work_item_dependencies` with `blocks` / `depends_on` / `complements`. Those *are*
connections: a DAG, many-to-many, no ownership. A parent/child edge is a different animal: a tree,
exactly one parent, cascading delete, progress rollup.

| | Dependency edge | Parent edge |
|---|---|---|
| Shape | DAG, many-to-many | Tree, **exactly one** parent |
| Meaning | A blocks B | B is *part of* A |
| Delete A | B survives | B cascades |
| Progress | none | A's progress computed from B |

Naming the tree "connected" hands one word to both and destroys the distinction users most need:
*this blocks that* versus *this is part of that*. It would also force the parent edge into the
dependency table, where the database can no longer enforce "one parent," every rollup query must
filter by kind, and the graph view sprouts edges with two incompatible meanings.

Vikunja is the cautionary case — it models parent/child as just another relation kind, so *"there is
no single-parent constraint to violate; the DB cannot stop a cycle."* OpenProject went the other way:
*"Can I set multiple parents for one work package? No, this is not possible."*

**Hierarchy renders as nesting. Dependencies render as arrows. Two grammars, two relationships.**

| Layer | Name | Definition |
|---|---|---|
| Partition | **Team** | Mandatory owner. Carries the mode. |
| Container | **Project** | Cross-team outcome. Owns milestones, not workflow. |
| Unit | **Item** | The atom: status, assignee, priority, type. |
| Child | **Task** | A full Item with a parent — owned work. Native create (§2.6.1). |
| Checklist | **Check** | A row in an Item's *Checklist*. Frozen, tickable, not owned. |

**The whole model is one rule:** *needs an owner → it's a **Task**; you just tick it off → it's a
**Check**.* Teaching sentence: "Teams own the work; a Project (optional) groups Items toward an
outcome; break an Item into Tasks when a piece needs its own owner; anything you just tick goes on its
Checklist as a Check." (Items need a Team, not a Project — `project_id` is nullable, per O3.)

Why these words, cross-vertical (software / procurement / logistics / ops):

- **Project** — the one universal container word; every vertical "runs projects." Initiative stays
  reserved above it, Milestone under it.
- **Item** — generic on purpose, so it never collides with a vertical's own nouns (procurement's "line
  item" reinforces it). `WorkItem` stays the contract type; "Item" is its natural shortening.
- **Task** — the word people already use for "a piece with an owner and a status." A distinct noun, not
  a `sub-` prefix: it says what it *is*, not what it's under.
- **Check** — defined by the only thing you do to it: tick it. It **cannot** be mistaken for ownable
  work, and reads natively everywhere (compliance / safety / QA / pre-launch checks). This is why
  **"Step" was wrong, not just clunky**: steps imply sequence and process *stages*, which are often
  owned — blurring the exact Task-vs-Check line the model needs sharp.

**This REVERSES the earlier "reject Task, labels-only" position, and does so deliberately.** The old
plan kept the schema's `tasks` table as the checklist and refused "Task" as a UI word to avoid the
collision. But that leaves a standing landmine: **today the contract's `Task` type IS the checkbox,
while every human and agent instinct says "task = owned work."** In an agent-first product the agent
would create checkboxes when asked for tasks. So we fix it at the source — rename, don't avoid:

| UI label | Backing (after rename) |
|---|---|
| Item | `work_items` |
| Task | `work_items` with `parent_id` (contract: `Task` = `WorkItem & { parentId }`) |
| Check | `checks` table (contract: `Check`) |
| Checklist | the `checks` collection under one Item |

**Rename required** (folded into the migration wave, §2.7): table `tasks` → `checks`; contract `Task`
→ `Check`; then re-mint `Task` as the owned-child type. After this, **UI, DB, and contract all agree**
— Task = owned work everywhere, Check = checkbox everywhere. `work_items` / `WorkItem`, `projects` /
`Project`, Team, statuses, dependencies are unchanged.

> **Forge coordination — verify before executing.** Renaming the `Task` contract type is a coordinated
> **major** bump; Forge consumes the contract. Fable judged the impact "one type, worth it," but
> Forge's actual usage of `Task` has **not** been verified from the Forge repo. Confirm usage and plan
> the dual-repo rollout before running the rename. The naming decision stands regardless; only the
> rollout care depends on it.

### 2.4 Decisions

| # | Decision | Rationale |
|---|---|---|
| O1 | `teams` table; `work_items.team_id NOT NULL` | `department` was Linear's Team, badly typed. Departments map 1:1 (founder-confirmed). |
| O2 | **Modes live on Team**, not Project | §3. |
| O3 | `project_id` stays NULLABLE | Unprojected Items are governed by their team. **No fake Inbox projects** — most Linear issues have no project; inventing one corrupts import semantics. A team backlog view surfaces them. |
| O4 | `work_items.parent_id UUID NULL`, self-FK | Reverses "keep it flat." Migration-target positioning changes the constraint set: a Linear sub-issue carries assignee, priority and dependencies, with no lossless landing in a checklist. |
| O5 | **Depth cap is a mode policy, not a schema constraint** | §2.5. |
| O6 | the checklist tier **survives**, frozen (table `tasks`→`checks`) | §2.6. |
| O7 | Single parent FK + cycle prevention on write | A single parent is what makes a recursive CTE terminate. |
| O8 | Rollups **always derived, never stored** | OpenProject sums children's progress and *ignores* work entered on parents. Stored rollups drift. |
| O9 | Status **categories** immutable, names customizable | §2.6.2. |
| O10 | Client-minted UUIDs on create | Trivial; enables optimistic UI. Linear's Object Pool is keyed by client-known UUID; the human ID is a projection. |

### 2.5 Depth: cap at 1, as policy

- **Schema:** `parent_id` unconstrained. Store `depth` and preserved imported-parent lineage.
- **Policy:** native creation depth defaults to **1**, a knob in mode config.
- **Imports** land at **true depth** with `source='import'`, bypassing the cap. The UI renders the real tree.

Why 1:

- **Jira held that line 20+ years, in writing.** JRASERVER-4446, closed *Won't Do* (2017): *"we should
  focus on making Jira simpler and easier to use rather then introduce additional complexity."*
  Premium adds levels only *above* epic. Jira stayed dominant.
- **Asana ships deep nesting and its own blog begs users not to** — *"we recommend not going more than
  a single 'layer' deep."* Subtasks are absent by default from Timeline, Calendar, List, Board,
  Workload and Rules. Users petition Asana to *add* a cap.
- **The asymmetry is decisive.** ClickUp's docs admit lowering the cap does not touch existing trees —
  *"any existing nested subtasks are not impacted."* Lowering is impossible. monday.com *raised* depth
  1→4 and could ship it only on **newly created boards**, because the storage *shape* changed. Raising
  is cheap **if the shape is already right**. So: ship the cap low, ship the shape deep.
- **We already have a second tier.** Item → Task → Check mirrors Jira's *effective* shape (Story →
  Sub-task → checklist). **The 1-level cap is on NATIVE creation only** — imports bypass it (§2.5) and
  land trees at true depth, so an imported Task may itself have a Task descendant. Rollup and
  tree-walk code must therefore not assume a hard one-tier depth; the cap is a creation policy, not a
  structural invariant.

Recorded honestly, the strongest argument against: we are a migration target and Linear is the marquee
source. It is defused twice — imports bypass the cap, and **Linear's issue depth is not documented
anywhere**, so we cannot be "lossy by N" against an unspecified N. (The widely-repeated "5 levels"
figure applies to Linear *initiatives*, not issues.)

### 2.6 Why the Checklist tier survives (as its own table)

The teardown recommends collapsing `work_items` + the checklist table into one table with a `type_id`
FK, since *no surveyed product ships a two-table split.* That conflates two different things.

Plane's and OpenProject's single-table lesson is about **work-item types** — bug, feature, epic,
milestone as *data* rather than an enum. We already honor that with `work_items.type`. It does **not**
argue for merging Checklists into Items. Every product cited has **both**: Linear has sub-issues *and*
markdown checklists; Jira has sub-tasks *and* checklists.

Once `parent_id` exists, the "two-table hierarchy tax" disappears: hierarchy, rollups and relations are
written once, against `work_items` only. The `checks` table joins nothing. Making a five-Check
checklist mint five full Items would pollute boards, counts and identifiers.

#### 2.6.1 Tasks have a native "Add" — the checklist is just primary

Fable's original ruling was "no create button; sub-items born only from import/promote." That is
**reversed** — **Tasks get a native "Add Task."** The anti-sprawl guard the old rule defended is now
*structural*: depth is hard-capped at this one tier (a Task cannot have a Task; below it is only the
Checklist), so the runaway nesting that rule feared **cannot happen**. And for procurement / marketing
/ ops, breaking an Item into owned pieces is the *first* motion, not an advanced one — hiding "Add
Task" behind a toggle reads as a missing feature, not discipline.

- **"Add Task" is present but secondary; the Checklist is visually primary** on the Item. The everyday
  motion is still to tick off Checks; promoting to a Task is the step up.
- **Promote-from-Check stays a first-class, celebrated flow:** a Check that grows an owner or a
  discussion becomes a Task. Without the valve, users file duplicate Items.
- The `checks` table stays frozen at `title / status / due_date` — the moment a Check needs an
  assignee, priority or dependency, the answer is *promote it to a Task*.
- Imports also land Tasks (a Jira sub-task / Linear sub-issue) directly, at true depth, via the cap
  bypass (§2.5).

#### 2.6.2 Status: categories and statuses replace `phase`

`phase` (`plan | execute | review | done`) carries several jobs and is missing two states. `plan` is
being used as a backlog; there is no way to say an Item died rather than shipped.

**Migration-target positioning forces the fix:** Linear's **Backlog** and **Canceled** have no lossless
home in our enum, so import breaks today.

- **Immutable categories** (global, never mode-editable): `backlog | unstarted | started | completed |
  canceled`, plus reserved `triage`.
- **Per-team `statuses` table** — `(team_id, name, category, position)`. `work_items` gains
  `status_id`. Teams customize *names* and order; categories are fixed. Every rollup, burndown and
  automation reads the **category**, never the name.

| Question | Ruling |
|---|---|
| Is "planning" the backlog? | Yes — and **Backlog and Unstarted are two separate categories**, not one with a flag. "Ideas nobody has committed to" ≠ "agreed, not begun." A flag corrupts the import mapping and the board columns. |
| Is **Review** a category? | **No — a status inside `started`.** Linear has no Review category; inventing one breaks import. |
| "Does this need review, or can it be pushed?" | A **mode policy**: the mode declares review-required-before-`completed`. It lives where workflow enforcement already lives. Jira-tight enforces; Notion-loose does not. |
| Is **Triage** a category or a view over `source`? | **A category** (reserved), so Linear triage imports losslessly; the inbox UI is a category filter. A mode toggle decides whether `source != 'manual'` Items land in `triage` or `backlog`. It is **not** merely a view over `source`: **source is provenance, triage is state.** An accepted agent-created Item leaves triage but keeps its source. |

**Guard rail:** categories are globally immutable. Modes own status *sets*, review policy, the triage
toggle and the depth cap — never category semantics. Otherwise import and cross-team reporting die.

### 2.7 Migration — one wave, before onboarding

Expand/contract, additive, zero-downtime — as discipline against live traffic, **not** as a driver
workaround (see §5.1).

`teams`, the status refactor and `parent_id` all touch `work_items`, and `statuses` depends on
`team_id`. Migrate **once**, and **before `phase` data accrues** — before Phase 1 onboarding, never
during.

1. `CREATE TABLE teams`
2. `INSERT INTO teams SELECT DISTINCT department …` (1:1, founder-confirmed)
3. `ALTER TABLE work_items ADD COLUMN team_id`; backfill via update-join; `SET NOT NULL`
4. `CREATE TABLE statuses (team_id, name, category, position)`; seed a default set per team
5. `ALTER TABLE work_items ADD COLUMN status_id`; backfill from `phase`:
   `plan→backlog`, `execute→started`, `review→started` + an "In Review" status, `done→completed`
6. `ADD COLUMN parent_id`, `ADD COLUMN depth`
7. `projects` enrichment: `status`, `lead_id`, `target_date`
8. **Rename `tasks` → `checks`** (and contract `Task` → `Check`; re-mint `Task` as the owned-child
   type). This is the one **non-additive** step — a coordinated Forge major bump — so it is gated on
   the Forge-usage verification (§2.3) and may land in its own beat rather than the same statement
   batch. Everything in 1–7 is additive and can ship first.

`department` and `phase` are retained, deprecated, for one contract cycle — **Forge depends on them.**
Dropping both is the future major. The additive changes (1–7) take a **minor** contract bump; the
`Task`/`Check` rename (8) is the **major** bump and carries its own rollout.

Cycle-safe reparenting is a single `UPDATE` guarded by a `NOT EXISTS` recursive CTE. For the residual
A→B / B→A race under read-committed, use `sql.transaction()` at Serializable.

### 2.8 Deferred

Cycles (team-scoped when built), initiatives (group projects), project milestones, per-team `ENG-123`
identifiers, the `/sync/delta` endpoint, the persisted offline transaction queue, Vikunja-style
auto-inverse relations.

---

## 3. Amendment to the canonical doc, §6

**Current text** puts the mode preset at the Project level.

**Why it is wrong.** Modes bundle required fields, workflow enforcement, cycles on-or-off, task
structure, who-can-edit-shape and agent autonomy. In Linear, *Team* owns exactly those. Putting them on
Project breaks twice:

1. A project may span multiple teams — a cross-team project would impose one team's workflow on another
   team's Items.
2. `project_id` is nullable, so Items with no project would be **ungoverned**. Making project mandatory
   to fix this requires fake per-team Inbox projects, which corrupt import semantics.

**Amended text.** *Modes are presets applied at the **TEAM** level, with an org default and an optional
ceiling. Project is a first-class cross-team outcome container — status, lead, target date, milestones —
and does not own workflow. Project-level overrides: deferred.*

This also makes migration-target positioning honest: Linear and Jira imports map team→team,
workflow-per-team, losslessly.

---

## 4. Meetings: capture, cost, and phasing

### 4.1 The capture problem

A browser cannot reliably hear the other participants.

- Per Chrome's browser-compat-data: `getDisplayMedia({audio:true})` captures entire-system audio **only
  on Windows/ChromeOS when sharing a whole screen**. On **Linux and macOS it captures tab audio only.**
  **Firefox: no audio capture. Safari: no. All mobile browsers: no.** `video:false` throws `TypeError` —
  you must carry a video track you discard.
- **None** of Otter, Fireflies, Fathom, Granola, tl;dv or Read.ai capture from a plain web page. Each
  uses a bot, a desktop app, or an extension. Granola: *"The web interface … is for viewing and editing
  existing notes only — it cannot capture or transcribe."*
- Both credible "no account" open-source precedents **abandoned the browser**: Meetily (MIT) is a Tauri
  desktop app; Vexa (Apache-2.0) is a self-hosted bot.

**"Just upload your recording" does not rescue it.** Verified against vendor docs:

| Platform | Free tier records? | Audio-only export |
|---|---|---|
| Google Meet | **No** — needs Business Standard+/Enterprise/Edu Plus, or Google One ≥2 TB | No (MP4 only) |
| Zoom | **Local yes**, cloud needs Pro+ | Yes (`audio_only.m4a`) |
| Microsoft Teams | **No** — free Teams cannot record at all | No (MP4; Personal-tier expires in 30 days) |

Two of three gate recording behind a paid seat. Upload is a fallback for a paid-tier minority, not an
onboarding path.

### 4.2 What it costs — and the reversal

**Container compute is not the problem.** A self-hosted headless-Chrome bot costs roughly
**$0.03–0.16 per concurrent-meeting-hour** (Hetzner ~$0.016, Fly ~$0.034, Fargate ~$0.099) versus
Recall.ai's **$0.50/hr** ($0.65 all-in with transcription). Compute wins 16×.

**Maintenance is the problem.** Bots drive a real browser. Zoom, Meet and Teams ship UI changes on their
schedule, and each is an incident. This is the one cost that does **not** shrink with scale.

Break-even, with 60% packing efficiency (lobby waits, meetings running over, gaps), a 3-week build, and
25% of an engineer on upkeep: **~8,700 meeting-hours/month** (~11,600 meetings). Below ~5,000 hours/month
Recall wins outright.

> **REVERSAL.** An earlier draft made a self-hosted Vexa bot the flagship. That was wrong on cost.
> **Start on Recall.ai.** Self-hosting (Vexa or Attendee, both Apache-2.0) becomes a *cost-reduction
> project with a named owner* once volume crosses the break-even — not a founding architectural decision.

### 4.3 The one bot-free path: Zoom RTMS

Zoom RTMS gives *"your app access to live audio, video, and transcript data … **Instead of having
participant bots** or automated clients in meetings."*

- Streams **raw audio frames and speaker-separated channels** over a plain WebSocket.
- *"You do not need the SDK or library … you can connect directly using any WebSocket client in any
  language."*
- **A Durable Object can hold that socket.** No container in the path. No visible bot participant — a
  real trust win.
- **Caveat:** requires Zoom "credits," and **the price of a credit could not be verified.** Model it
  before committing. Zoom also warns that data missed during a disconnect *"is gone forever"* — persist
  buffers.

The other platforms are dead ends. **Google Meet Media API** is Developer Preview and requires *every
participant* to enroll in Google's preview program; it is WebRTC/SRTP over UDP, which Workers cannot
terminate. **Teams** has no RTMS equivalent — its app-hosted media bot must be **C# on .NET, on Windows
Server, in Azure**, strictly worse than a Linux container.

### 4.4 The capture ladder

One `CaptureSource` seam. **RTMS frames and bot-captured frames land in the same audio pipeline**, so
capture is a swappable adapter, not an architectural commitment.

| Tier | Mechanism | Covers | Cost |
|---|---|---|---|
| 0 | **Browser mic** (`getUserMedia`) | **In-person meetings.** Every browser, every OS, desktop + mobile | free |
| 1 | **Chrome tab capture** | Meet-in-browser on desktop Chrome (macOS included — Meet runs in a *tab*) | free |
| 2 | **Zoom RTMS → Durable Object** | Zoom | credits (unverified) |
| 3 | **Recall.ai** | Zoom + Meet + Teams | $0.65/hr all-in |
| 4 | *(later)* self-hosted bot | Zoom + Meet + Teams | ~$0.06/hr + ~$3.1k/mo upkeep |

Degrade **honestly**: tell Safari/Firefox/mobile users tab capture cannot work, rather than failing
silently.

**Accepted architectural exception:** bots need containers. **"All-Cloudflare" governs the app plane**
(SPA, API, DB). A media-capture plane, if we ever self-host bots, lives in containers. Stated explicitly
rather than pretended away. Note that Tiers 0–3 need **no container at all**.

### 4.5 In-app calls — cheapest, and still a distraction

**Cloudflare Realtime SFU bills on egress** ($0.05/GB, first 1,000 GB free). Audio bytes are tiny: a
five-person hour-long call is ≈**$0.014**, an order of magnitude below any bot. RealtimeKit exports raw
RTP to R2 at GA. LiveKit's server is Apache-2.0; its agents subscribe to room audio server-side.

But the media plumbing is not the hard part — those SDKs hand you echo cancellation, device selection,
screen share and reconnect. **The hard part is getting anyone to move their meeting out of Zoom.** That
is go-to-market, not engineering, and no SFU work solves it.

**Build in-app calls for the calls we already own** (in-product demos, support calls). Never as a
Zoom-replacement play. A distraction *unless the meeting itself is the product.*

### 4.6 STT and diarization

Full evidence: [`2026-07-10-stt-provider-coverage.md`](../research/2026-07-10-stt-provider-coverage.md).

Keep the existing Python `SpeechProvider` seam — adding AssemblyAI/Deepgram is a new **adapter**, not an
architecture change. Add `supportsStreaming` and `supportsDiarization` capability flags so the UI degrades
honestly.

**Routing policy** (the seam picks by language + whether speakers are needed):

| Use case | Provider | Cost/hr |
|---|---|---|
| English/EU **batch** w/ speakers | AssemblyAI Universal-2 (+$0.02 diar add-on) | $0.17 |
| English/EU **streaming** w/ speakers | Deepgram Nova-3 + diarize | $0.408 |
| **Indic batch** w/ speakers | **Deepgram Nova-3** — the only vendor documenting diarization across *all* its languages | $0.258 + diar |
| **Malayalam / Punjabi** | Sarvam (Deepgram covers 8 of 9 Indic; these two are missing) | ₹45 |
| **Hinglish / code-mixed** | Deepgram `language=multi` (batch **and** streaming); or Sarvam `codemix` for native-script output | — |
| Speakers **not** needed | **Cloudflare Workers AI** `whisper-large-v3-turbo` — in-stack, and CF states it does **not** train on customer content | **$0.0306** |
| **No-account self-host** | **faster-whisper** (MIT code + MIT weights, int8 on CPU, ungated, 99 languages) | compute |

**The lock-in criterion beats price.** AssemblyAI **trains on your audio by default**, and the opt-out is
**paid-plan-gated — a BYO-key user on the free tier cannot opt out.** Deepgram's opt-out
(`mip_opt_out=true`) is free and per-request, and its self-hosting is self-service; AssemblyAI's
self-hosted streaming demands a **$20,000 upfront commitment.** For a product promising "your calls never
touch a third party," that decides it: **Deepgram is the safer BYO-key default; AssemblyAI is the cheap
English-batch option, with a warning shown to free-tier key holders.**

**Diarization.**
- **Do NOT adopt pyannote or WhisperX.** pyannote is `gated: "auto"` on HuggingFace — account + terms
  click — and **WhisperX inherits the gate**. That silently breaks the no-third-party-login promise.
- **Self-hosted diarization: `diar_streaming_sortformer_4spk-v2`** (CC-BY-4.0, ungated, native streaming
  to 0.32 s buffer, **max 4 speakers**).
  > **CORRECTION.** An earlier draft called Sortformer the license-clean answer *and implied it was
  > language-independent*. Its own card says it was *"trained on publicly available speech datasets,
  > primarily in English… performance may degrade on non-English speech"*, and the multilingual badge is
  > commented out in the card source. **Self-hosted Indic diarization is unsolved** — that workload routes
  > to Deepgram or Sarvam.
- **Pin exact repo ids, not families.** `diar_sortformer_4spk-v1` is **CC-BY-NC-4.0 (non-commercial)**
  while `v2` is CC-BY-4.0. Pinning by family name can silently pull non-commercial weights into a
  commercial product. Re-check `gated` and `license` at every pin.
- Sarvam's diarization is **batch-only**. "Streaming + speakers + Indic" is the one corner where no cheap
  option exists.

**NVIDIA NeMo / Nemotron — the self-host efficiency play.** NeMo toolkit is Apache-2.0; **weights are
licensed separately and non-uniformly.** All NVIDIA checkpoints checked are ungated.

- `parakeet-tdt-0.6b-v2` — CC-BY-4.0, **English only**, mean WER 6.05%, RTFx 3380.
- `parakeet-tdt-0.6b-v3` — CC-BY-4.0, 25 European languages, **no Indic**.
- `canary-qwen-2.5b` — CC-BY-4.0, English, best-in-family WER 5.63%.
- `canary-1b-v2` — CC-BY-4.0, 25 languages, ASR **+ translation**.
- `nemotron-3.5-asr-streaming-0.6b` — **the only NVIDIA ASR checkpoint covering Hindi** (35 languages,
  streaming), but licensed **OpenMDW-1.1** — *unread; needs a legal review before shipping.*

**Ship faster-whisper as the self-host default; add Parakeet as a detected GPU profile, never a default.**
Parakeet's RTFx 3380 is a batch-128 datacenter-GPU number, NeMo publishes **no CPU benchmark at all**, and
every card says "optimized for NVIDIA GPU-accelerated systems." faster-whisper documents int8 on CPU. *A
self-hosting user who must first buy a CUDA card has not self-hosted anything.* **The GPU dependency, not
the license, decides this** — CC-BY-4.0 vs MIT is a non-issue (an attribution line).

**Cost trap:** AssemblyAI streaming bills **wall-clock, not audio** — an un-terminated socket auto-closes
at 3 hours and bills the full duration. Batch has no such failure mode.

**Infrastructure.**
- **In-Worker inference is impossible**: 10 MB bundle cap, 128 MB memory, 5 min CPU.
- A Worker **can** hold a long-lived WebSocket for a whole meeting. **One Durable Object per meeting +
  WebSocket Hibernation** is the natural session object. We do **not** need an SFU for capture.

### 4.7 Where Rust helps, and where it does not

- **Not in the Worker.** The API is I/O-bound, waiting on Postgres; WASM only inflates the bundle.
- **Not in the SPA.**
- **Yes, client-side audio:** resample, VAD, Opus-encode before upload — real CPU work in a hot loop.
- **Yes, the in-browser engine tier:** whisper.cpp WASM, Moonshine Web (ONNX + WebGPU). Honest caveat:
  **no independent benchmark of sustained hour-long in-browser transcription was found.** Treat it as a
  privacy/offline tier, not the default quality path.
- **Not worth rewriting the self-host container** — faster-whisper is CTranslate2 (C++), whisper.cpp is
  C++. Both are already native speed.

### 4.8 Phases

The founder's argument for meeting-first, and it is the right one: *the meeting agent holds no value
without a surface for its decisions and action items to land on.* The Workboard is therefore not a
commodity prerequisite — it is **what makes the meeting agent differentiated.** Notes that become Items
on your board is the wedge; notes that go nowhere is Otter.

| Phase | Weeks | Ships | Onboards | The one thing that sinks it |
|---|---|---|---|---|
| **1** | 1–4 | Workboard GA in `platform-web`; **the one-wave ontology migration** | First users, on the Workboard | The migration destabilizing the live app — **migrate before onboarding, not during** |
| **2** | 3–8 (overlaps) | Meeting surfaces in `platform-web` against the existing Python API; Tier 0 + 1 capture; Recall.ai for Zoom/Meet/Teams | Meeting users | The **Clerk↔Python auth bridge**. One login, two backends |
| **3** | 8–16 | Zoom RTMS → Durable Object; proposals spine + first Workboard MCP toolset; transcription strangler (Cut 2) | — | The rebuild going big-bang |

**Two-stack backend, accepted for ~2 quarters.** `platform-web` talks to the Hono Worker (workboard) and
the Python service (meetings). The user sees one app, one login. Retired by strangler-pattern endpoint
migration, never big-bang. *"Get off Railway" is a direction, not a launch gate.*

The real cost of that choice is the **Clerk↔Python auth bridge** — teaching FastAPI to verify Clerk JWTs
and resolve them to the same tenant. It is throwaway work, and it is Phase 2's actual hard problem.
Start it day one.

**Strangler reorder: transcription moves FIRST, not last.**
- **Cut 1 (days):** add a `workers-ai` provider to the existing Python `SpeechProvider` registry, calling
  Workers AI over REST. $0.03/hr, no new vendor, no migration.
- **Cut 2:** move the transcription job (ingest → transcribe → persist) to a Worker + queue — the
  compute-heavy stateless piece.

### 4.9 The agent plane is a trap as scoped

AG-UI + CopilotKit + model router + memory, before any board has an agent, is a six-month hole. The
minimal increment that genuinely parallelizes:

**the `proposals` table + review UI + ONE MCP toolset over the workboard API.**

Proposals is the spine both boards' agents write through. Build the spine, not the plane. Note
`proposals` is currently **prose in `DESIGN.md` only** — no table, no code — yet the canonical doc makes
it the guard rail for agent-first setup.

### 4.10 `apps/meeting-web`

**Freeze it.** Bugfix-only reference implementation. Build meeting surfaces fresh in `platform-web`
(they need the design system anyway); delete `meeting-web` at parity. Folding it in now imports
Python-era UI debt; amending the "one app" decision reverses a FINAL decision for convenience.

### 4.11 The honest v1 pitch

> *The open-source meeting notetaker whose notes become action items on your team's board.*

Interim line until Zoom RTMS ships: *"works today for in-person meetings, Chrome-attended calls, and any
recording you have."*

---

## 5. Corrections to previously-held beliefs

### 5.1 "The Neon HTTP driver has no interactive transactions" — FALSE

Inherited from a comment in `apps/platform-api/src/routes/dependencies.ts` and repeated into design
reasoning. Neon's docs:

- Over **HTTP**: `sql.transaction(queries, {isolationLevel, readOnly, deferrable})` runs multiple
  statements in one atomic **non-interactive** transaction, with a selectable isolation level.
- Over **WebSockets**: `Pool`/`Client` give **full interactive transactions**, explicitly supported on
  Cloudflare Workers — the Pool must be created, used and closed inside a single request handler.
- Schema migrations run through drizzle-kit against a direct connection, where transactions were always
  available.

**Impact:** it invalidated the "migrations must be single idempotent statements" rationale, and it was
the decisive leg of the depth-cap argument. Neither conclusion changed; both rationales did. The comment
is corrected on this branch — the single-statement cycle guard is still correct, for the real reason
(atomic check-and-insert without a transaction).

### 5.2 "Linear caps sub-issues at 5 levels" — FALSE

The 5-level cap applies to **initiatives**. Linear's sub-issue depth is not documented anywhere.

### 5.3 "Zoom/Meet/Teams all hand hosts a recording" — FALSE

See §4.1. Two of three require a paid seat; free Teams cannot record at all.

### 5.4 "Self-hosted bots are the efficient choice" — FALSE at our scale

See §4.2. Break-even is ~8,700 meeting-hours/month.

### 5.5 "Sortformer gives us license-clean diarization" — TRUE on license, FALSE on languages

Sortformer-v2 is CC-BY-4.0 and ungated, so it clears the no-account bar. But its card warns it was trained
*"primarily in English"* and that *"performance may degrade on non-English speech."* It is **English-first,
not language-independent.** Self-hosted Indic diarization is unsolved; route it to Deepgram or Sarvam.
Additionally, `diar_sortformer_4spk-v1` is **CC-BY-NC-4.0 — non-commercial.** Pin exact repo ids.

---

## Appendix A: license audit

Verified 2026-07-10 by running `gh api repos/<owner>/<repo>/license --jq .license.spdx_id` against
each repo named in the table below (e.g. `makeplane/plane`, `hcengineering/platform`, `opf/openproject`,
`go-vikunja/vikunja`, `Leantime/leantime`). SPDX values are as returned that day; re-run before relying
on them, since licenses drift (Screenpipe went AGPL→proprietary on 2026-06-10). Adopted-dependency
licenses (Vexa, LiveKit, faster-whisper, etc.) are tracked in the STT and bot-economics research files,
several with **unverified** status called out there.

| Tool | Repo | SPDX | State |
|---|---|---|---|
| Plane | makeplane/plane | **AGPL-3.0** | active |
| Huly | hcengineering/platform | EPL-2.0 | active |
| Focalboard | mattermost-community/focalboard | AGPL-or-commercial | **unmaintained** |
| OpenProject | opf/openproject | GPL-3.0 | active, **CLA required** |
| Kaneo | usekaneo/kaneo | **MIT** | active |
| Vikunja | go-vikunja/vikunja | AGPL-3.0 | active |
| Tegon | RedPlanetHQ/tegon | AGPL-3.0 | **archived** |
| Kan | kanbn/kan | AGPL-3.0 | active |
| Operately | operately/operately | **"Other" (non-standard)** | active |
| Taiga | kaleidos-ventures/taiga | MPL-2.0 | **dead since Dec 2023** |
| Leantime | Leantime/leantime | AGPL-3.0 | active, **CLA required** |

Dependencies we *may* adopt: **Vexa** / **Attendee** (Apache-2.0, only past break-even), **LiveKit
server** (Apache-2.0), **faster-whisper** (MIT), **whisper.cpp** (MIT), **Sortformer** (CC-BY-4.0),
**CopilotKit** (MIT). Pin licenses; re-check at every bump — **Screenpipe relicensed AGPL →
proprietary on 2026-06-10.**

---

## Open questions

0. **Read OpenMDW-1.1 and the NVIDIA Open Model License.** `nemotron-3.5-asr-streaming-0.6b` is the only
   NVIDIA ASR checkpoint covering Hindi *and* streaming — the single most useful self-host model for our
   market — but neither license has been read. Blocks adoption.
0b. **Test AssemblyAI diarization on an Indic language.** Their docs state *no* language restriction and
   *never enumerate one*. Absence of a restriction is not a guarantee. Do not assume; measure.
0c. **Measure Sortformer DER on Hindi audio ourselves.** NVIDIA publishes no per-language DER. Its training
   set includes Mandarin corpora, so "English-only" may be too pessimistic — but it is unknown.
1. **Price of a Zoom RTMS credit.** Unverified; Zoom's developer pricing page is JS-rendered. **Model
   before choosing RTMS.**
2. **Task (sub-item) depth cap default per mode.** Jira-tight = 1. Does Notion-loose = 3?
3. **Mode config typing.** `mode_config` must not become an untyped JSONB swamp. Version the presets in
   `packages/contracts`; the Forge version-skew gate must cover mode *semantics*, not just field shape.
4. **Importer vs mode enforcement.** Imported Items missing required fields must bypass validation with
   `source='import'` plus a reconcile queue — otherwise Jira-tight mode makes import impossible.
5. **Drizzle vs Alembic ownership of `teams` and `statuses`.** Declare Drizzle the owner, in writing, now.
6. **Whether a Durable Object can sustain a multi-hour outbound WebSocket to Zoom RTMS under load.**
   Architecturally sound, untested; no source confirms anyone has done it.
