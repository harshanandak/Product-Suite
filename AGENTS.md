# Product-Suite

## 1. What this is

Product-Suite is an open-source, composable work-and-agent platform. The atom is a
flat **item** with **connections** — boards, canvas, and agent chat are separable
surfaces that compose into one stack. Think of it as an open alternative to Linear +
Notion + an agent console, where the ceiling is user-authored rather than
vendor-decided.

Everything below is written so you can make a change here without breaking something
you could not see. Read §2–§9 before your first edit in a new area; §10 onward is
reference you can come back to.

> *Provenance: product framing mined from 406 Codex + 4 Claude sessions in this repo,
> Apr–Aug 2026 (`Roadmap/agent-transcript-mining-2026-08-13.md`), and the section
> architecture from `Roadmap/theo-file-structures-and-ours-2026-08-13.md` Part C3.*

## 2. What we can never compromise on

Check your own diff against this list before you propose it. If a change hurts one of
these, it is the wrong change — say so and propose a different one.

- **Open source and composable.** Surfaces stay separable. Nothing may only work
  because two surfaces are secretly coupled.
- **The ceiling is user-authored.** Custom modes and custom views exist so a user can
  build their own application right here. Do not close a door a user could have opened.
- **Flat items plus connections.** No forced hierarchy, no deep nesting. When you feel
  the pull to add a parent level, add a connection instead.
- **UI labels are plain English.** Never code-shaped. `owner_user_id` is a column;
  "Owner" is a label. A label that reads like an identifier is a bug.
- **Throughput under a budget.** Speed *and* quality, measured against real usage
  limits. Neither alone is the goal.
- **Agent-native.** Chat is a dispatch surface, not a chatbot. Anything a user can do
  by clicking, an agent should be able to do by asking.

## 3. A note from Harsha

> ⚠️ **PENDING HARSHA'S VOICE — not yet authoritative. Do not cite this section as
> product policy.** Unlike the rest of this file, the text below was reconstructed from
> mined session transcripts rather than written or dictated by Harsha. It is *input for
> his rewrite*, kept here so the draft is not lost — treat it as a strong hint about
> working style, never as a rule you can point at. Every other section of this file is
> authoritative; this one becomes authoritative when Harsha replaces it in his own words.
> *(See `agent-setup-overhaul-2026-08-12.md` §5.6 note 14: this block is hand-written by
> Harsha; agent drafts are input, not the article.)*

Don't spend three hours on thirty lines. If a change is small, make it small and move.

Don't stop to ask. If you found the next step while doing the first one, do the next
step. Tell me what you did, not what you're about to do. Asking permission for the
mechanical middle of a task you were already given is the single thing that costs us
the most time.

Research before deciding. Use context7 and parallel-ai. When it's a build-or-buy call,
answer the three axes out loud: is it open source, what does integration cost, and is
the future scope something we want to own?

Say what you actually verified and what you didn't. "Written but unverified" is a fine
sentence. A confident wrong one is not.

## 4. Good defaults, not hard rules

Everything here is the default. The human in the session overrides any of it, and a
more specific `AGENTS.md` deeper in the tree overrides this one. If a rule is getting
in the way of obviously-correct work, say which rule and why — don't quietly route
around it, and don't stop and wait either.

## 5. People and words

**People.** *You* = the agent reading this. *We/us* = Harsha and whoever is building.
*User* = the person driving the session. *Harness* = whatever runtime you happen to be
running in.

**Glossary — these are the user's words, use them back:**

| Word | What it means |
|---|---|
| **item** | The atom. An item is the epic, the backlog entry, and the task — one flat kind, not three. |
| **connected** | How items relate. A "sub-item" is just a connected item. |
| **board / items board / agent board** | The plural list surfaces. |
| **canvas** | The spatial surface (BlockSuite / excalidraw-style). |
| **blocks** | Composable content units inside canvas and docs. |
| **custom mode** | A user-authored configuration of a surface — the ceiling. |
| **agent chat** | The dispatch surface. |
| **multipliers** | Parallel agent slots. |
| **Sol / Luna** | Model tiers. |
| **limits** | The usage budget work is measured against. |
| **stacked lineup** | A PR train. |
| **memory brain** | The decision/knowledge store behind chat and agents. |
| **Forge kernel** vs **PS tracker** | Two different trackers. See §7. |

**Anti-terms — never write these:**

- **"work item"** → say **item**. ("The work items can be just named as items… having
  single-worded things makes things simpler.")
- **"cycle"** → not the user's vocabulary. Every occurrence in this repo is agent or
  code context. Do not put it in a UI label or a design doc as though it were his word.
- **"nested"** → say **connected**. He repeatedly rejects hierarchy depth.
- *capture / injection / proposal / holdout* are **our** words for memory-brain
  internals, not his. Fine in code; wrong in a label or a conversation with him.

## 6. Ways to hurt yourself

Each of these has already happened here at least once.

1. **`drizzle-kit generate` is forbidden.** Migration SQL in this repo is
   hand-authored. `generate` needs an intact snapshot chain and ours is broken (§7),
   so it will produce a wrong or empty diff that looks plausible. See §9 for what to
   do instead.
2. **The ledger id is offset from the journal idx.** `__drizzle_migrations.id` is
   1-based; `_journal.json` `idx` is 0-based. Ledger id *N* records journal idx *N−1*.
   Sixteen ledger rows means 0000–0015 applied, **not** 0016. Cross-check
   `created_at` against the journal's `when` before you conclude anything. Misreading
   this nearly deleted a live migration record.
3. **Snapshot drift.** 9 of 22 migrations have no `meta/*_snapshot.json`. Do not
   hand-write one to "fix" the count — see §7 and kernel issue
   `1c8d790e-68f9-4333-9dcd-0316b69d336b`.
4. **Stopping to ask instead of executing.** The most-repeated correction in this
   repo's history by a wide margin (~48 occurrences). Finish the task you were given,
   including the mechanical steps it implies. Silence means continue.
5. **Filing PS issues in the Forge kernel, or Forge issues in the PS tracker.** They
   are different trackers with different backlogs. Check which repo the work belongs
   to before you file.
6. **Merging with unresolved review threads.** Count threads via the GraphQL
   `reviewThreads { isResolved }` field. Summary scripts under-report — one of ours
   only counted a single bot and hid the rest.
7. **Asserting absence from the working tree.** This checkout is often detached or
   behind. Zero grep hits are only meaningful on the ref that matters — check
   `git show origin/main:<path>`, not your local file.
8. **Running the DB tests while the unit tests are red.** They are slow. Get the fast
   lanes green first.
9. **Two agents in one checkout.** Concurrent git work needs one worktree each
   (`bun run worktree:create`). Sharing the primary checkout collides on HEAD
   mid-task.
10. **Fake absolute paths in tests.** `'/repo'` or `'/gcd'` write to real drive roots
    on Windows — vacuously green locally, red on Linux CI. Use temp paths.

## 7. Hit every surface

**Walk this list out loud and say which rows apply to your change** before you start,
and again before you call it done. Naming a row and dismissing it is fine. Silently
skipping one is how half-built changes ship.

| Change | Every surface it touches |
|---|---|
| **Schema** | `packages/db/src/schema.ts` → hand-authored `packages/db/migrations/NNNN_name.sql` → an entry in `migrations/meta/_journal.json` → the snapshot chain (`meta/NNNN_snapshot.json`) → a test in `packages/db/src/schema.test.ts` → **manually** `bun run migrate` from `packages/db` → **re-fetch the ledger to prove it applied** |
| **API** | `packages/contracts` (the wire contract) → `packages/sdk` → every consuming app in `apps/` |
| **UI** | `packages/ui/src/styles/tokens.css` semantic tokens → the *right* `ui-*` package (`ui`, `ui-chat`, `ui-canvas`, `ui-meeting`, `ui-planning`, `ui-charting`) → the consuming app → dark mode |
| **Reverse states** | Every forward action needs its inverse: archive ⇒ unarchive, block ⇒ unblock, connect ⇒ disconnect. Ship both or say which you deliberately left. |
| **Agent surfaces** | chat + board + canvas — a capability added to one usually belongs in all three |
| **Docs** | user-facing vs maintainer-facing are different documents |

**On the schema row specifically:** the deploy pipeline has never run migrations
automatically. `bun run migrate` from `packages/db` is a manual step a human does
against a live Neon database. The DB contract check cannot detect a migration that was
written but never applied — only re-fetching the ledger can.

**On the snapshot chain:** `meta/` currently holds 13 snapshots (0000–0011, 0019)
against 22 journal entries and 22 `.sql` files. Missing: 0012–0018, 0020, 0021. The
parity check freezes that list as a baseline, so a **new** migration without a snapshot
fails CI while the historical gap stays quarantined. Regenerating the 9 is tracked in
`1c8d790e-68f9-4333-9dcd-0316b69d336b`; the surface-index follow-up is
`f354bdc2-55f3-40fe-9ae5-2c22985d7b18`. Do not guess at snapshot contents — they must
be rebuilt in order from a clean checkout.

## 8. Where the code lives

```text
apps/         meeting-api  meeting-web  platform-api  platform-web  roadmap-web
packages/     db  contracts  sdk  ui  ui-canvas  ui-charting  ui-chat  ui-meeting  ui-planning
services/     agent-core  hocuspocus
scripts/      repo-level checks (migration parity, source/test coupling, DB authority…)
```

Bun workspaces; `bun@1.3.6` is pinned in the root `package.json`.

**Taste.** Push complexity to the adapter boundary and keep orchestration pure. UI
components stay dumb. Prefer inferred types over hand-written ones; `any` is the enemy.
Labels in plain English (§2).

## 9. Runbook — the exact spellings

```bash
bun install                                  # root, once
bun run worktree:create <slug>               # never raw `git worktree add`
bun run --cwd packages/db test               # the db package's own vitest
bun run check:migration-parity               # journal ↔ .sql ↔ snapshot chain
bun run check:source-test                    # source/test coupling gate
bun run test:repo-tooling                    # the repo-level script tests
bun run test:prepush                         # what the pre-push hook runs
```

**Migrations — the one procedure worth memorising:**

```bash
# 1. Edit packages/db/src/schema.ts
# 2. Hand-author packages/db/migrations/NNNN_short_name.sql
#    NEVER `drizzle-kit generate` — the snapshot chain is broken (§7)
#    Separate statements with:  --> statement-breakpoint
#    Head-comment WHY, not what.
# 3. Add the entry to packages/db/migrations/meta/_journal.json (idx is 0-based)
# 4. bun run check:migration-parity
# 5. bun run --cwd packages/db test
# 6. Apply it. Locally, against YOUR dev database (reads DATABASE_URL):
bun run --cwd packages/db migrate
#    Against production, never that command — go through the executor the deploy
#    workflow uses, which reads MIGRATION_DATABASE_URL and enforces the history
#    variant and the exact pending set (.github/workflows/platform-api-deploy.yml):
#    bun run migrate:database -- apply --environment production \
#      --history-variant original-production --expected-pending <tags>
#    `packages/db migrate` would hit whatever DATABASE_URL points at and skip
#    those checks entirely.
# 7. Re-fetch __drizzle_migrations and prove your tag landed.
#    Remember the offset: ledger id N == journal idx N-1.
```

**CLAUDE.md is a pointer to this file, never a copy.** It drifted across ~10 worktrees
when it was a manual copy. If you find any harness file duplicating this content,
replace it with a pointer.

**Test data.** Temp paths only. Never `'/repo'`, never `'/gcd'` (§6.10).

## 10. Verification

Targeted checks over full builds — run the lane that covers what you touched, not the
whole matrix, and say which lane you ran.

Anything user-visible gets **one integrated pass in the running app** before you call
it done, not just a green unit test.

"Ready to merge" means CI is green, not that it passed locally. Local green is not
matrix green.

Never let a search summary settle a decision. For anything decision-gating, fetch the
actual doc, schema, or file and read it.

## 11. Pull requests

- **Merge train, not fan-out.** Update only the PR that is next at bat.
- **Zero unresolved threads**, counted via GraphQL `reviewThreads { isResolved }` —
  never a summary script (§6.6).
- **One lead agent per PR.** No nested subagents owning the same PR.
- **Review at the head SHA.** Let the head settle before reading review state.
- PR bodies lead with the problem, then the change. Attribute where the finding came
  from.

**Shipping regime (pre-user).** Product-Suite has no outside users yet, so a feature PR
is reviewed as a feature, not as a diff:

- The merge artifact is a **demo** (recording or screenshots from the integrated pass in
  §10) plus the plan's acceptance checklist walked out loud, item by item. Line-level
  correctness is the in-PR agent loop's job — implementer, spec review, quality review.
- **Completeness gates the merge, size does not.** Every state and transition, entry
  point and reverse path the plan named gets walked before ship. Half-built is the
  failure mode; big is not.
- **Bot feedback is advisory** except secrets, injection, and a broken build, and it
  never expands the PR — file the follow-up. Threads still get resolved before merge
  (that is the mechanical gate above), but resolving one can mean "filed as <id>".
- **Main is recoverable:** squash-only, branch deleted on merge, revert or fix forward
  within the hour, never debug on a red main. No merge queue.

## 12. Standards — what "good" feels like

These are user-perceived symptoms, not metrics:

- Board interactions feel instant.
- No lying spinners — a spinner means work is actually happening.
- Optimistic updates always reconcile; a row never silently keeps a wrong value.
- No stale labels after a rename.
- Security effort is proportionate. Do not run a full threat model over a
  maintainer-only dev script.

## 13. Escape hatch

If following this file would make you do something obviously wrong — the rule is
stale, the surface moved, the instruction contradicts what the code plainly says —
**do the right thing and say which rule you broke and why, in one line.** Then file an
issue to fix the rule. Never silently ignore it, and never stop and wait for
permission to be correct.

If you genuinely cannot proceed: change nothing, file the issue, say so plainly.

---

# Contributor workflow (Forge)

*Everything below is the Forge toolchain and workflow layer. It is real and in use, but
it is about **how we work**, not about **what we're building** — read §1–§13 first.*

## Issue tracking

This project uses the **Forge Kernel** for issue tracking — the **PS tracker**, which is
distinct from Forge's own backlog (§6.5). Run `forge prime` for full context.

```bash
forge ready           # Find available work
forge show <id>       # View issue details
forge claim <id>      # Claim work
forge close <id>      # Complete work
```

More commands (`forge <command> --help` for full usage):

```bash
forge remember <note>           # Persist a project-memory note
forge recall [query]            # Read it back
forge insights                  # Detect recurring evidence patterns
forge gate <verb> <gate-id>     # Toggle a workflow gate / record a human-gate approval
forge role <role> --use <skill> # Bind a role to a skill in .forge/config.yaml
```

**Rules**

- Use `forge` as the routine surface for issue tracking — not TodoWrite, TaskCreate, or
  markdown TODO lists. Exception: `/plan` Phase 3 writes task lists to
  `docs/work/YYYY-MM-DD-<slug>/tasks.md`, which `/dev` consumes.
- Use `forge remember` / `forge recall` for persistent knowledge — not MEMORY.md files.
- **Nothing discussed goes missing.** Anything raised in a session — a bug, an idea, a
  decision, a follow-up, a risk noticed in passing — becomes a kernel issue via
  `forge issue create` before it can be forgotten, triaged with a type and a parent.
  When you defer scope, file the follow-up and reference it. Canonicalized in
  `rules/kernel-tracking.md`, governed by the default-on `rail.kernel_tracking` rail
  (`forge gate disable rail.kernel_tracking` to turn it off deliberately).

## Stage workflow

A default TDD-first workflow template: six stages plus a composable **research** skill.
These are one configurable composition over Forge runtime building blocks, not a
mandatory ladder — commands may run as full stages or as smaller fragments when the
active plan permits.

| Stage | Command | Purpose | Required for |
|---|---|---|---|
| 1 | `/plan` | Design intent → research → branch + worktree + task list | Critical, Standard, Refactor |
| 2 | `/dev` | Subagent-driven TDD per task (spec + quality review) | All |
| 3 | `/validate` | Validate + 4-phase debug mode on failure | All |
| 4 | `/ship` | Create PR with documentation | All |
| 5 | `/review` | Address ALL PR feedback | Critical, Standard |
| 6 | `/verify` | Post-merge health check (CI, deployments) | All |

**Pre-merge gate** (not a numbered stage): finish doc updates on the feature branch,
confirm CI is green, hand off the PR. Embedded in `/ship` and `/review`; runs for
Critical, Standard, and Refactor work. Simple, Hotfix, and Docs work skip it.

**Utilities** (not stages): `/status` — context check before starting work.
`/shepherd <pr>` — one bounded pass that reads CI and check state, re-runs a flaky
required check, or escalates, then hands off. It never merges (the human merges in the
GitHub UI) and never resolves review threads (that stays with `/review`).
`--auto-rebase` is opt-in and default OFF. See
[docs/reference/shepherd.md](docs/reference/shepherd.md).

### Change classification

Classify the request, then run the matching path:

- **Critical** (security, auth, payments, breaking changes, new architecture, data
  migrations) → plan → dev → validate → ship → review → verify
- **Standard** (features, enhancements, new components) → plan → dev → validate → ship → review
- **Simple** (bug fixes, UI tweaks, minor refactors) → dev → validate → ship
- **Hotfix** (production emergencies) → dev → validate → ship, immediate merge allowed
- **Docs** (documentation only) → verify → ship
- **Refactor** (cleanup, perf, tech debt) → plan → dev → validate → ship

### Enforcement philosophy

Conversational, not blocking. When a prerequisite is missing, offer options and a
default rather than erroring out. When a step is skipped, create accountability for it:
allow the commit, file the follow-up issue, mark it `[tech-debt]` in the message.

Command files (`.claude/commands/*.md` and agent equivalents) must never hardcode
example output that a script generates dynamically — reference the script and describe
what it does.

### `/dev` loop

Read the task list from `/plan` Phase 3 → dispatch one implementer subagent per task
with fresh context → RED-GREEN-REFACTOR enforced by a hard gate (failing output shown
before implementation, passing output shown after) → spec-compliance review → code
quality review → decision gate with 7-dimension impact scoring when a spec gap appears,
routing to PROCEED / SPEC-REVIEWER / BLOCKED.

## Git hooks and push

Lefthook drives the gates.

- **Pre-commit** blocks source changes without accompanying tests. Strong default, not
  a hard floor: it is the default-ON `rail.tdd_intent` rail
  (`forge gate disable rail.tdd_intent`; the `minimal` profile ships it off). Hooks read
  the resolved config at run time, so a disabled rail is genuinely inert.
- **Pre-push** blocks direct pushes to `main`/`master`, runs ESLint at
  `--max-warnings 0`, and requires tests to pass.
- **PRs** squash-merge for a linear history. Reference the kernel issue id in the body.

**Never use `LEFTHOOK=0`, `--no-verify`, or any hook bypass.** If a hook fails, fix the
cause. Only humans may bypass, documented in the PR description.

```bash
forge push                    # Branch protection + lint + tests, then push
forge push --quick            # Review-cycle: lint-only push (CI runs full suite)
forge worktree create <slug>  # Create a worktree
forge test                    # Run tests with correct timeouts
forge clean                   # Remove merged worktrees (from the primary root)
```

## Shell and MCP

| Platform | Shell for Forge stage flows |
|---|---|
| Windows | Git Bash |
| macOS/Linux | Default login shell |

Optional MCP servers that improve research: **Context7** (library docs) and **grep.app**
(search real-world code across GitHub). See [.mcp.json.example](.mcp.json.example) and
[docs/reference/TOOLCHAIN.md](docs/reference/TOOLCHAIN.md).

## Stage handoff context

Every stage transition should carry Summary / Decisions / Artifacts / Next so the next
stage — or a fresh session — can resume without re-reading the design doc. **Advisory:**
missing fields never block a transition.

Record it on the issue itself:

```bash
forge issue comment <issue-id> "stage: dev -> validate
summary: All 5 tasks done, 1 decision gate fired
decisions: Used streaming parser over DOM for memory efficiency
artifacts: lib/parser.js test/parser.test.js
next: Run lint first — streaming approach may trigger no-await rule"
```

`gate.issue_verify` (default-on) confirms the comment actually landed. Read it back with
`forge show <issue-id>`, or `forge recap <issue-id>` for the bounded envelope.

## Skills

Skills live at `.claude/skills/<name>/SKILL.md`, each with an `evals/evals.json`
alongside it. They are committed. Edit the SKILL.md directly.

A skill's description is the only part always in context, so it must carry every
trigger: what the skill does, when to reach for it, the phrasings that should fire it,
and explicitly which sibling skills it is *not*.

## Documentation index

- [docs/INDEX.md](docs/INDEX.md) — full reading order
- [docs/reference/TOOLCHAIN.md](docs/reference/TOOLCHAIN.md) — tool setup
- [docs/reference/VALIDATION.md](docs/reference/VALIDATION.md) — enforcement details
- `docs/work/YYYY-MM-DD-<slug>/` — `plan.md`, `tasks.md`, `decisions.md` per feature

## Session completion

Work is not complete until `git push` succeeds. File issues for remaining work, run the
quality gates, update issue status, then:

```bash
git pull --rebase
forge sync
git push
git status   # must show up to date with origin
```

Then clean up stashes and pruned branches, and hand off context for the next session.
Never say "ready to push when you are" — push. After fixing review feedback, push and
resolve the GitHub review threads via GraphQL before considering the work done.
