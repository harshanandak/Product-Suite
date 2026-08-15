# Coding Standards

**Read at review time only.** This file is not part of the per-turn context. Load it when you are
reviewing a diff (self-review before push, PR review, `/code-review`), not while writing code and not
at session start. AGENTS.md owns how a turn is shaped — planning, stopping, delegation, workflow
stages. This file owns only what a reviewer can see in a diff.

**Every rule here is diff-checkable**: a reviewer looking at the changed lines alone can tell whether
it holds. If a rule needs the reviewer to read the transcript, watch the agent work, or know how long
something took, it belongs in AGENTS.md instead.

**To add a line:** one sentence, positive phrasing ("do X"), stating the observable property of the
diff, plus an evidence tag in brackets naming where the rule came from (a mined corrective cluster
with its count, a decision log entry, or a named incident). No rule without evidence. No rule that
cannot be checked from the diff.

Evidence tags used below:
- `[mined:N]` — corrective-message cluster from `Roadmap/agent-transcript-mining-2026-08-13.md`
  (Product-Suite section; 180 corrective messages across 146 Codex sessions), N = cluster size.
- `[repo]` — verified in this repository against `origin/main` at bd62b57 (path cited). Verify repo
  facts against `origin/main`, never a local `main` that may be many commits behind.

---

## Database & migrations

- Hand-author migration SQL and its `_journal.json` entry in the same diff — never output from
  `drizzle-kit generate`. [repo: docs/design/2026-07-15-memory-brain-p1.md:23]
- **Never hand-author or copy forward a `meta/NNNN_snapshot.json`.** A drizzle snapshot is a complete
  materialised model of the schema at that point, chained by `id`/`prevId`. Copying the preceding
  snapshot and bumping its ids records the *old* schema as the new baseline, so every later diff is
  computed against a lie — that is how the current 9-snapshot gap started. A correct snapshot for a
  schema change cannot be written by hand; it has to be generated. Until the chain is repaired
  (`1c8d790e`), a new schema migration either lands with a properly regenerated chain or waits on that
  issue. `check:migration-parity` enforces this: it rejects a copied snapshot by `id` re-use and a
  broken `prevId` link. [repo: scripts/check-migration-parity.mjs, test/check-migration-parity.test.js]
- Number a new migration from the last `_journal.json` `idx` + 1, and keep the filename prefix equal
  to that new `idx`. [mined:6 — the 0016→0015 renumber]
- When reasoning about applied state in a diff or script, treat `__drizzle_migrations.id` as 1-based
  and `_journal.json` `idx` as 0-based, so ledger id N corresponds to idx N−1. [repo: memory note
  `product-suite-drizzle-ledger-offset`]
- Ship a `meta/NNNN_snapshot.json` with every new migration; on `origin/main` the chain has 22 `.sql`
  files and 22 `_journal.json` entries but only 13 snapshots (0000–0011 plus 0019), so **9 are
  missing** (0012–0018, 0020, 0021) — do not widen the gap. [repo: packages/db/migrations/meta at
  origin/main bd62b57]
- Keep `bun run check:migration-parity` green; the journal/`.sql` parity gate is already live on
  `origin/main` (`package.json` script, run by `.github/workflows/platform-api-deploy.yml`), so a
  migration diff that breaks it fails CI. [repo: package.json:27,
  .github/workflows/platform-api-deploy.yml:162]
- Write migrations additively with `IF NOT EXISTS` guards. Make a new column nullable **only when the
  domain genuinely allows a missing value** — nullable is the safe default for optional data on a live
  table, not a blanket rule. A column the system relies on to be correct (a privacy or access flag, a
  tenant or owner key, anything security-bearing) must not ship nullable: a NULL there fails open. Land
  it as add-nullable → backfill → `SET NOT NULL` (plus a `CHECK` where the value is constrained), in
  that order, and say which step this diff is. [repo: docs/design/2026-07-13-agent-slice-pr1-plan.md:17,
  .claude/skills/memory-brain/SKILL.md]

## UI & design system

- Use semantic tokens from `packages/ui/src/styles/tokens.css` in component styles — no raw colour
  literals in any notation (hex, `rgb()`/`rgba()`, `hsl()`/`hsla()`, `oklch()`, or a named colour).
  [repo: packages/ui/src/styles/tokens.css]
- Write user-visible labels, buttons, empty states, and toasts as ordinary English sentences, not
  identifier-shaped strings (no `snake_case`, `camelCase`, or SCREAMING_CASE in copy). [mined:20 —
  "teh label names are written like code they shoudl be written liek normal englishj"]

## Product vocabulary (user-facing strings)

- Say "item" in user-facing copy; `work_item*` stays a schema and code identifier only. [mined:
  glossary — "The work items can be just named as items"]
- Express relationships between items as connections/links, not parent-child nesting, in both schema
  and UI. [mined: glossary — "aren't sub-items just connected things?"]
- Keep "cycle" out of user-facing copy; it is not the user's word. [mined: glossary — all 23 hits are
  agent/code context]

## Scope of a change

- Keep a diff to the item it claims: unrelated fixes go in their own change with their own issue.
  [mined:29 — scope drift]
- State the future-scope assumption in the PR body or a code comment when a change closes off an
  extension point. [mined:29 — "we need to be very sure about the progressive future scope"]
- File Forge-tool issues in the Forge kernel and product issues in the Product-Suite tracker; a diff
  must not add issue references to the wrong tracker. [mined:1]

## Evidence in the diff

- Cite the primary source (doc URL, context7 lookup, file:line) in the PR body or comment when a
  change depends on external API or library behaviour. [mined:24 — "Use context 7 and parallel ai
  cli… Don't assume anything"]
- Prefer a targeted test for the changed path over broadening an existing suite run. [mined:5 — "dont
  run db test if all test are not passing that is lot more time"]

## Merge readiness (checkable on the PR, not the transcript)

- Land a PR with zero unresolved review threads. [mined:26 — "There should be no unresolved comments
  in the GitHub PR"]
- Keep one authoring branch per PR — a single lineage of commits, not interleaved work from several
  agents. [mined:15 — "why are we having mutiple sub agents leding teh pr it shoudl be one"]
