# Decisions log — the memory curator pass (rec #3)

Every deliberate choice made building the Global Curator pass on the Review Inbox
(research rec #3, `docs/research/2026-07-25-personal-vs-org-memory.md` Part 3 item 3,
SAP Signavio arXiv 2607.03228 §5.2). One entry per choice, recorded when it was made.

Authority read before building:

- `forge show personal-vs-org-memory-b0d3975f` — RANKED PLAN item 3: "Global Curator
  pass on Review Inbox (dup/overlap/conflict diff before human review — pays off even
  if personal tier slips; prevents rubber-stamping)".
- Research Part 3 item 3: "Before a proposal reaches a human, diff it against existing
  memory: quality checks in isolation (single rule, clear applicability, meaningful
  name) + relation checks (duplicate / overlap / conflict, naming the specific
  colliding memory). Present the verdict inline."
- Research §1.10B (the SAP paper): the Global Curator has read access to existing
  memory, runs (i) isolation quality checks — meaningful name, clear scope, single rule
  — and (ii) relation checks against existing memory, then emits proposed changes for a
  **human expert** to dispose of. The paper's atom is `{Applicability, Action, Purpose}`;
  "one atom = exactly one rule".

---

## D1 — The verdict is a READ, computed on demand, not a stored column

**Decision.** `GET /api/agent/proposals/:id/curator` computes the verdict per request.
Nothing is persisted; no migration.

**Why.** The verdict is a function of the candidate AND of current memory, and memory
moves under it. A stored verdict would be stale the moment another proposal is accepted,
and staleness in a rubber-stamp-prevention surface is worse than no surface. The
`GET /:id/active-rules` endpoint on the same router already establishes this shape:
proposal-scoped, read-only, tenant-scoped, `{ … }` envelope.

**Consequence.** Absolutely nothing about accept/reject changes. The curator cannot
auto-decide because it is never on the write path at all — the advisory guarantee is
structural, not a policy we remembered to honour.

---

## D2 — Collision candidates come from `searchMemories` and NOWHERE else

**Decision.** The curator's ONLY read of the `memories` table is
`searchMemories(sql, tenantId, probe, limit, reviewerUserId)`. Titles, ids, kinds,
scopes and bodies all come from the returned hits. The curator issues no SQL of its own.

**Why.** #151 made `searchMemories` dual-lane and fail-closed: the org lane is pinned to
`visibility='org'`, the private lane is a separate query bound to `owner_user_id = asker`
and is never issued at all when the asker is unknown. Reusing it means the
never-leak-another-user's-private-memory property is inherited rather than
re-implemented — and re-implementing it is exactly how a second surface leaks what the
first one correctly hides. One path also makes the invariant *testable*: assert the set
of SQL texts the curator issues, and any new path shows up as a new query.

**Consequence.** The scope filter and all similarity scoring happen in memory over the
hits FTS returned. That is the intended trade: no new retrieval (the brief's
constraint), at the cost of recall bounded by what FTS surfaces.

---

## D3 — The asker passed to the private lane is the REVIEWER

**Decision.** `reviewerUserId` (the human reading the Inbox, resolved by
`callerUserId`) is what the curator passes as the asker. Unknown/blank reviewer ⇒ no
private lane at all, and the verdict says so (`private_lane_skipped: true`).

**Why.** Three candidate identities exist — the reviewer, the proposal's `on_behalf_of`,
and the memory's future owner — and only the reviewer's is safe. The reviewer's own
private notes ARE legitimately theirs to see colliding, and surfacing them is real
value ("you already privately noted the opposite"). Any other identity would name a
memory the *viewer* is not entitled to, which is precisely the leak-through-the-curator
failure: the curator would print a title that the retrieval lanes correctly refuse to
return to this person. Fail-closed on unknown is inherited from `hasKnownAsker`.

---

## D4 — `scope_type` / `scope_id` added to `MemorySearchHit`

**Decision.** Both `searchMemories` lanes select `scope_type, scope_id` and
`MemorySearchHit` carries them. No WHERE clause changed.

**Why.** The brief scopes collisions to "same tenant + scope", and a verdict that says
"conflicts with X" without saying at what scope X binds is not actionable. Two extra
columns on an existing SELECT is additive; inventing a second scope-aware query for the
curator would violate D2. The bound parameters are untouched, so every #151 assertion
about what the lanes FILTER on still holds.

**Scope-collision rule** (kept to four explainable cases, because the object graph
needed to prove real containment is not available here):
an existing memory collides with the candidate when the existing one is `org`-scoped
(org policy binds everywhere), or the candidate is `org`-scoped (it would bind over
everything narrower), or both name the identical `scope_type` + `scope_id`. Two
different narrow scopes are NOT reported — we cannot prove containment, and a false
collision trains reviewers to ignore the panel.

---

## D5 — FTS probes: title content-words plus topics, capped at 3 queries

**Decision.** Up to three `searchMemories` calls per verdict: one built from the
candidate title's content words (stopwords stripped, capped at 4 terms), plus one per
`topics` entry (max 2).

**Why.** `plainto_tsquery` ANDs its terms. Passing the whole title+body would require an
existing memory to contain *every* word, so duplicates would only ever be found on
near-identical wording — near-zero recall dressed up as precision. Stripping stopwords
and capping the term count makes each probe an "about the same thing" question, and
`topics` are already curated labels so they are the highest-signal probe available. Three
is a bounded cost on a synchronous review-time read.

**Honest limitation.** Recall is still bounded by FTS lexical matching: a duplicate
phrased in entirely different words will not be found. Fixing that means embeddings
(`agent/embeddings.ts` exists) and is a separate piece of work, not something to smuggle
in here.

---

## D6 — Five quality checks, one code each, every one naming its evidence

**Decision.** `title_missing`, `title_placeholder`, `title_terse`,
`bundled_assertions`, `applicability_missing`. Each finding carries a `reason` sentence
that names what was found. There is no score.

**Why.** The SAP paper's isolation checks are exactly "meaningful name, clear scope,
single rule"; these are that list, split so each is individually testable and
individually explainable. A numeric quality score would be the one thing the brief
forbids — a reviewer cannot act on "0.4", but can act on "the body states three separate
directives". The three title codes are mutually exclusive (missing beats placeholder
beats terse) so one bad title never produces three findings.

`applicability_missing` fires only for `kind='rule'`, because that is the kind whose
meaning depends on knowing when it binds — SAP's Applicability field. A `fact` or a
`decision` needs no trigger condition, so demanding one would be noise.

---

## D7 — `memory:supersede` is curated; its own target is excluded

**Decision.** The curator runs for `memory:create` and `memory:supersede` (both carry
candidate text). `memory:retract` / `memory:defer` return `outcome: 'not_applicable'`.
For a supersede, the hit whose `id` equals the proposal's `target_id` is dropped before
classification.

**Why.** A supersede's candidate text is by construction near-identical to the row it
supersedes, so without the exclusion every supersede verdict would read "duplicates
<the very row you are replacing>" — a false positive on half of all memory proposals,
which is how a review surface becomes noise people click past. Excluding by hit id needs
no extra query (D2): only one row per chain is `active`, and `searchMemories` returns
only active rows, so the superseded ancestors are not in the candidate set anyway.

Retract and defer carry no candidate text at all (`waiting_on` / `review_after`), so
there is nothing to check in isolation and nothing to diff. Saying so explicitly beats
returning an empty "clean" verdict that would read as "we checked and it is fine".

---

## D8 — Conflict outranks duplicate; both outrank overlap

**Decision.** Per colliding memory the relation is the most severe that fires:
`conflict` > `duplicate` > `overlap`. The verdict's `outcome` is the most severe
relation across all collisions, else `quality_only` if any quality finding fired, else
`clean`.

**Why.** A negated near-copy ("deployments must never …" against "deployments must …")
scores as a near-duplicate on token overlap, because only one word differs. If duplicate
won, the single most dangerous case in the system — a contradiction entering memory —
would be reported as the most benign one. Conflict must win on the same evidence.

**Conflict signals** (two, both naming their evidence): a directive-polarity flip
between two texts that are already about the same thing, and a numeric divergence — two
texts that both state a number but different ones. The second is the SAP paper's own
worked example (an SOP allowing deviations below EUR 250 against a plant policy with a
lower threshold).

---

## D9 — Thresholds: duplicate ≥ 0.82, overlap ≥ 0.40, token Dice

**Decision.** Similarity is the Dice coefficient over stopword-stripped token sets of
title + body. Duplicate at ≥ 0.82, overlap at ≥ 0.40.

**Why 0.82.** It is the figure already used in this codebase's own prior art for
"the same thing, said twice" — `contradiction-detection-review-inbox-26708faa` specifies
annotations at ">=0.82 similarity across tiers" becoming Review-Inbox items. Reusing it
keeps one similarity vocabulary instead of two competing ones. Dice over token sets
rather than embeddings because the curator must stay a synchronous, deterministic,
explainable read: a reviewer can be shown which words matched.

---

## D10 — The panel is advisory in the UI as well as in the API

**Decision.** `CuratorVerdictPanel` renders inside the existing memory branch of
`ProposalDetail`, above the Accept/Reject controls, using `Badge` and the same
`rounded-md border border-border bg-muted/40` treatment as `RuleAttributionBadge`. It
never disables a control, and a failed fetch renders nothing.

**Why.** No new visual vocabulary was invented because the Inbox already has a settled
one for "context about this proposal". More importantly: the panel must not be able to
gate the human. Wiring it to `disabled` would convert a heuristic into an authority —
the exact rubber-stamp-in-reverse failure — and a fetch failure would silently become a
block. Rendering nothing on failure is the fail-safe direction here, the opposite of
retrieval's fail-closed, because the risk being managed is different: an unavailable
hint must not stop a human from deciding.
