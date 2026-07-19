# Test-Suite Speed & Reliability — External Best-Practices Research

Scope: research-only findings for Product-Suite's bun-workspaces monorepo (vitest + lefthook gate + GitHub Actions, platform-api on Cloudflare Workers + Neon Postgres/pgvector/Drizzle). Grounded in the six observed pains: (1) coarse FULL selection for platform-api/packages/db/scripts, (2) slow vitest startup (environment 624s / setup 310s / import 195s), (3) load-induced flake with 3 concurrent vitest processes, (4) worktrees missing node_modules, (5) Neon cold-start latency, (6) full 17-suite pre-push.

Every claim below is tied to a fetched primary source. Anything I could not verify from a primary source this session is explicitly flagged **[UNVERIFIED]**.

---

## Axis 1 — Test impact analysis / affected-only selection

### What leading tools do
- **Nx `affected`** — uses git to find changed files, maps them to projects via its project graph, then adds every project that *depends on* the changed projects, and runs the task only on that set. Base defaults to `main`, head to the working tree. Explicitly warns that if you change a widely-depended-on project you may still run almost everything, so it is "best paired with remote caching and distributed execution." Source: https://nx.dev/ci/features/affected
- **Turborepo `--affected`** — `turbo run build test --affected` filters to packages changed on the branch; by default equivalent to `--filter=...[main...HEAD]` (the `...` includes dependents). Composable with `--filter` (both constraints must hold). Critical correctness caveat documented: *"The comparison requires everything between base and head to exist in the checkout. If the checkout is too shallow, then all packages will be considered changed."* Source: https://turborepo.com/docs/reference/run and task model at https://turborepo.com/docs/crafting-your-repository/running-tasks
- **vitest native selection** — three mechanisms:
  - `--changed [base]` runs only tests against changed files (uncommitted by default; `--changed HEAD~1`, a hash, or `origin/main`). **Correctness backstop:** `forceRerunTriggers` forces the *whole* suite when listed files change; by default changes to the vitest config and `package.json` already rerun everything. Source: https://vitest.dev/guide/cli (`changed`)
  - `vitest related <files>` runs only tests that cover given source files — built for lint-staged/CI. **Caveat:** resolves *static* imports only, not dynamic `import(filepath)`. Source: https://vitest.dev/guide/cli (`vitest related`)
  - `projects` (workspace) config to scope/partition suites.
- **Bazel** — content-hash-addressed build graph; only targets whose transitive inputs changed are rebuilt/retested, with remote cache/remote execution. **[UNVERIFIED this session — not fetched; cited from general knowledge, URL pointer https://bazel.build/ ]**

### The correctness trap (state of the art)
The universal rule across Nx/Turbo/vitest: "affected" must include the **transitive reverse-dependency closure**, not just the directly-edited package. Under-testing happens when the changed→suite map omits a dependent. All three tools compute this closure from a real dependency graph; a hand-maintained map (our gate) drifts. The accepted safety valve is a *force-full trigger list* (vitest `forceRerunTriggers`; Turbo's shallow-checkout → "assume everything changed") so ambiguous/shared changes fail safe toward FULL.

### Applicable to our stack
- Our gate hand-maintains a workspace→suite map and lacks entries for `apps/platform-api`, `packages/db`, and `scripts/` → they fall through to FULL. Two correct fixes:
  1. **Add the missing entries, computed as a reverse-dependency closure.** `packages/db` is imported by platform-api (and likely others) → editing `db` must select *db's own suite + every workspace that imports db*, not FULL. Derive this from the bun workspace graph rather than by hand.
  2. **Replace the hand map with a graph-driven selector.** Either shell out to `turbo run test --affected` (Turbo reads the workspace graph for free) or, per-workspace, `vitest --changed origin/main` with a `forceRerunTriggers` list for cross-cutting files. `scripts/` should map to "the suites those scripts touch" (or a `scripts` lint/test), not FULL.
- **Caveat:** keep a `forceRerunTriggers`/force-full list (root config, lockfile, `packages/db` schema/migrations, tsconfig base, the gate script itself) so genuinely global changes still run everything.

---

## Axis 2 — vitest startup & execution speed

### Levers (all from vitest docs)
- **Pool choice.** Default pool is `forks` (child_process) — chosen for compatibility (avoids segfaults/hangs with native libs), but *"may be slightly slower than `pool: 'threads'` in larger projects."* `threads` uses worker_threads; cannot use `process.chdir()` and breaks native libs (Prisma/bcrypt/canvas). `vmThreads`/`vmForks` run in a VM sandbox — faster startup but leak memory on ESM and have global/Error-identity pitfalls. Sources: https://vitest.dev/config/pool , https://vitest.dev/guide/improving-performance
- **`isolate: false` (`--no-isolate`).** Biggest single lever for suites that clean up their own state (typical for `node`-env suites). Re-uses one environment across files instead of a fresh one per file. Can be scoped per-`projects` (isolated for the few side-effecty files, non-isolated for the rest). Not available in `vmThreads`. Source: https://vitest.dev/guide/improving-performance (Test Isolation)
- **`--no-file-parallelism` / `fileParallelism:false`** — trades parallelism for lower startup cost; useful for a single small suite. Source: https://vitest.dev/config/fileparallelism referenced in improving-performance.
- **`experimental.fsModuleCache`** — persists the transform cache to disk across runs (not just in-watch memory). Doc's own numbers: a 900-module file went 8.75s → 5.90s on rerun, cutting `transform` 4.02s→0.84s and `import` 5.52s→2.35s. Source: https://vitest.dev/guide/improving-performance (Caching Between Reruns)
- **`test.dir`** — narrow the file-search root so vitest doesn't scan unrelated folders. Source: same page (Limiting Directory Search).
- **Sharding** `--shard=1/N --reporter=blob` then `--merge-reports` — splits across machines/processes; the docs' own example caps workers per shard so `(1+workers)*shards == CPUs` to avoid oversubscription (see Axis 3). Source: https://vitest.dev/guide/improving-performance (Sharding)
- **bun test** — single fast process, Jest-compatible, TS/JSX native, no per-file worker spin-up; *"runs all tests in a single process."* Meaningfully faster startup than vitest but not a drop-in (Jest-compat gaps tracked at oven-sh/bun#1825; no vitest `projects`/pool model). Source: https://bun.com/docs/cli/test

### Reading OUR numbers
`environment 624s` + `setup 310s` + `import 195s` on platform-api is the smoking gun: nearly all wall-clock is **per-file environment construction + setupFiles**, not the tests. With `forks` + isolation on, every test file pays full environment + setup again. The fix is to (a) reduce isolation for platform-api's node-env files, and/or (b) shrink `setupFiles` (defer/lazy DB connect, avoid top-level heavy imports), and (c) consider `pool:'threads'` if no native-lib/`chdir` dependency. **Caveat:** `isolate:false` is only safe if platform-api tests don't leak module/global/DB state between files — audit shared singletons and per-test DB cleanup first (ties to Axis 5).

---

## Axis 3 — Flaky-test management & the oversubscription root cause

### Detection & policy
- **Retry:** vitest `--retry.count <n>` (config `test.retry`, default 0) with `--retry.delay`. Retries mask flake — use as a stopgap with tracking, not a cure. Source: https://vitest.dev/guide/cli (`retry.count`, `retry.delay`)
- **Repeat-to-detect:** vitest has no `--rerun-each`; the equivalent for hunting flake is running the file repeatedly / `test.repeats` in bench, or CI loops. **[Partially verified]** — `retry` is confirmed; a first-class "repeat N times to flush flake" CLI flag was not found in the fetched CLI docs.
- **Quarantine/allow-list:** standard practice is to tag known-flaky tests and run them in a separate non-blocking lane (skip/`test.fails`/a `flaky` project) rather than blocking merges. **[UNVERIFIED — pattern, no single authoritative vitest doc fetched.]**

### The oversubscription root cause (directly relevant to our gate's revert)
Our flake correlates with **3 concurrent vitest processes**, and vitest's own default is already-parallel: pool spawns up to CPU-count workers, and `maxConcurrency` defaults to 5 concurrent tests *within* a file. Running N vitest processes multiplies that by N → far more runners than cores → timing-sensitive tests miss deadlines under CPU starvation. The vitest sharding example is explicit about budgeting: on 32 CPUs with 4 shards it sets `VITEST_MAX_WORKERS=7` so `(1 main + 7 runners) * 4 = 32`. Sources: https://vitest.dev/guide/improving-performance (Sharding) , https://vitest.dev/guide/cli (`maxWorkers`, `maxConcurrency`, `fileParallelism`).

### Applicable to our stack
- Instead of reverting to fully-sequential suites (slow), run suites concurrently **with a global worker budget**: set `VITEST_MAX_WORKERS` / `--maxWorkers` per process so `Σ workers ≈ CPU count`. E.g. with 3 concurrent suites on an 8-core runner, cap each at `--maxWorkers=2` (or a `%` value). This keeps parallelism without oversubscription — the middle path the gate comment didn't try.
- Add `--maxWorkers`/`poolOptions.forks.maxForks` caps rather than "sequential vs unbounded-concurrent" binary.
- **Caveat:** worker caps reduce but don't eliminate flake from genuine shared-resource contention (e.g. the same Neon DB). Load-independent flake needs test-level isolation, not just fewer workers.

---

## Axis 4 — Local pre-push gate vs CI

### Prevailing philosophy
- The graph-affected tools above exist precisely so *local* runs stay minimal while *CI* can afford breadth (Nx: affected local, remote-cache + distribution in CI; Turbo: `--affected` for "narrowing a CI run"). Sources: https://nx.dev/ci/features/affected , https://turborepo.com/docs/reference/run
- **Synthesis / [UNVERIFIED as a single citable "anti-pattern" ruling]:** a full 17-suite (~11 min) pre-push is widely considered too heavy for a hook — pre-push should be *fast and affected-only* (typecheck + lint + affected unit tests), with the exhaustive matrix (full suite, integration, coverage, cross-OS) living in CI on `pull_request`. This is my synthesis grounded in the affected-testing docs and our own MEMORY note "*'Ready' means CI green, not local*", not a single authoritative source. Rationale: the pre-push job is to catch obvious breakage cheaply; the merge gate is where exhaustive correctness belongs, and CI parallelizes/caches in ways a laptop can't.

### Applicable to our stack
- Make pre-push run **affected-only verify** (typecheck + affected workspaces' unit tests), and let GitHub Actions run the full matrix. Keep a `--full` escape hatch and force-full triggers for lockfile/root/db changes.
- The pre-commit `check-source-test-coupling` is appropriately cheap and belongs at pre-commit; keep it.

---

## Axis 5 — DB / integration test efficiency (Neon + pgvector + Drizzle)

### Techniques
- **Per-test transaction rollback** — wrap each test in `BEGIN … ROLLBACK` so no row ever commits; fastest reset, keeps a single connection warm (also sidesteps Neon cold starts by reusing one pooled connection). **[UNVERIFIED — widely-used pattern; no single doc fetched this session.]** Caveat: can't test code that itself manages transactions/commits.
- **Template databases** — `CREATE DATABASE test TEMPLATE test_template` for a fast pre-seeded clone per run. **[UNVERIFIED — Postgres feature, not fetched.]**
- **Neon branch-per-CI-run** — Neon creates an instant copy-on-write branch of prod data (or schema-only) and deletes it after; designed exactly for isolated, disposable test databases. Schema-only branching avoids copying sensitive data. Source: https://neon.com/docs/guides/branching-test-queries (schema-only: https://neon.com/docs/guides/branching-schema-only)
- **PGlite** — real Postgres compiled to WASM, in-memory (or persisted), ~3MB gzipped, runs in Node/Bun, **supports pgvector**. Ideal for fast local/unit-level DB tests with no server and no cold start. Source: https://github.com/electric-sql/pglite , https://pglite.dev . Caveat: single-connection, not 100% wire-identical to a Neon serverless cluster (extensions/concurrency differences) — use for unit/integration, keep a small real-Neon smoke lane.
- **Testcontainers (node)** — throwaway Dockerized Postgres per test run; closest to prod, but needs Docker and has container-startup cost. Source: https://node.testcontainers.org/

### Applicable to our stack
- Our `environment 624s` on platform-api suggests DB setup is on the hot path per file. Two-tier it: **PGlite (with pgvector) for the bulk of Drizzle/pgvector unit+integration tests** (kills cold-start latency and needs no server), and a **thin real-Neon branch smoke lane in CI** for wire-level fidelity.
- If staying on real Neon: reuse one warm pooled connection across the suite (avoid per-test connect → repeated scale-to-zero cold starts) and use per-test transaction rollback for isolation.
- **Correctness caveat:** PGlite ≠ Neon serverless exactly (pooling, concurrency, some extensions). Keep pgvector index behavior and any Neon-specific SQL covered by the real-DB smoke lane.

---

## Axis 6 — Worktree-aware deps (node_modules missing in fresh worktrees)

### Options
- **Install into the worktree.** Fresh `git worktree` shares `.git` but not `node_modules`; run `bun install` in the new worktree (fast against a warm global cache/store). Our MEMORY note already prefers `forge worktree create` (which does branch + deps install) over raw `git worktree add`.
- **Content-addressed store + symlinks.** pnpm/bun keep a global store; installs in a new worktree hardlink/symlink from it, so cost is near-zero after the first. **[UNVERIFIED — store mechanics not fetched this session.]**
- **Automate via hook.** A `post-checkout`/worktree-create hook that runs `bun install` guarantees `tsc`/binaries exist before any gate runs.
- **CI doesn't hit this** (fresh clone + install each run) — it's a local-worktree-only failure.

### Applicable to our stack
- Root-cause of "gate can't find `tsc`": the worktree never got `node_modules`. Fix by making worktree creation always install (standardize on `forge worktree create`) or add a pre-push preflight that detects missing `node_modules`/`tsc` and runs `bun install` before verifying, rather than failing the push.
- Ties to the parallel-build reliability memory: agents should worktree + install as one step.

---

## Ranked shortlist — highest-leverage changes for OUR observed pains

| # | Change | Pain(s) | Effort | Expected impact |
|---|--------|---------|--------|-----------------|
| 1 | **Map `platform-api`, `packages/db`, `scripts/` into the gate's workspace→suite selection as a reverse-dependency closure** (db → db-suite + its importers, not FULL; scripts → their targeted suites). Keep a `forceRerunTriggers`/force-full list for lockfile/root/tsconfig/db-schema. | 1, 6 | **S–M** | Huge: removes the most common false-FULL; most pushes drop from ~11 min to one/few suites. Correctness preserved via the force-full list. |
| 2 | **Cut platform-api startup: reduce `setupFiles` cost + adopt `isolate:false` for node-env files (scoped via `projects`)**, consider `pool:'threads'` if no native-lib/`chdir` dep. | 2 | **M** | Huge: directly attacks the 624s env / 310s setup — likely the single biggest wall-clock win. Caveat: verify no cross-file state leakage first. |
| 3 | **Replace "sequential-only vs 3× unbounded" with a global worker budget** — cap `VITEST_MAX_WORKERS`/`--maxWorkers` per concurrent suite so `Σ workers ≈ CPU count`. | 3 | **S** | High: restores safe concurrency, removes the oversubscription flake without going fully sequential. |
| 4 | **Two-tier DB tests: PGlite (with pgvector) for bulk Drizzle unit/integration + one warm-pooled real-Neon smoke lane in CI**; per-test transaction rollback for isolation. | 2, 5, 3 | **M–L** | High: eliminates Neon cold-start latency from the hot loop and reduces shared-DB flake. Caveat: keep Neon smoke lane for wire fidelity. |
| 5 | **Make pre-push affected-only (typecheck + affected unit tests); move full 17-suite matrix + coverage to CI `pull_request`.** | 1, 6 | **M** | High: aligns hook cost with its job; "ready" gates on CI green, not local full. |
| 6 | **Guarantee worktree deps** — standardize `forge worktree create` (installs) and/or a preflight that runs `bun install` when `node_modules`/`tsc` is missing instead of failing the push. | 4 | **S** | Medium: removes the manual-install stall on fresh worktrees. |
| 7 | **(Larger) Adopt a graph-driven selector** (`turbo run test --affected` or per-workspace `vitest --changed origin/main`) to retire the hand-maintained map entirely. | 1 | **L** | High but bigger: durable fix for map drift; do after #1 proves the closure logic. Caveat: ensure non-shallow checkout so "affected" isn't silently everything. |

### Sources (verified this session)
- Nx affected: https://nx.dev/ci/features/affected
- Turborepo `run` / `--affected`: https://turborepo.com/docs/reference/run · https://turborepo.com/docs/crafting-your-repository/running-tasks
- Vitest improving performance: https://vitest.dev/guide/improving-performance
- Vitest pool: https://vitest.dev/config/pool
- Vitest CLI (`changed`, `related`, `retry`, `maxWorkers`, `maxConcurrency`, `fileParallelism`, `shard`): https://vitest.dev/guide/cli
- Bun test: https://bun.com/docs/cli/test
- Neon branching for tests: https://neon.com/docs/guides/branching-test-queries · schema-only: https://neon.com/docs/guides/branching-schema-only
- PGlite: https://github.com/electric-sql/pglite · https://pglite.dev
- Testcontainers (node): https://node.testcontainers.org/

**Flagged unverified this session:** Bazel content-hash selection (general knowledge, not fetched); the "full pre-push is an anti-pattern" ruling (synthesis, not a single citable source); per-test transaction-rollback & template-DB patterns (well-known, no doc fetched); pnpm/bun store symlink mechanics; vitest quarantine/allow-list convention.
