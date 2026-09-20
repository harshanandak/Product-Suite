# Decisions

- Preserve aggregate workspace lint. At the initial `9cf66fa31cb422c1d06b5d1e2da476950b404681` baseline, removing it would have lost Roadmap and otherwise unaffected-workspace coverage. Main `499cc401efeec02eaa0b6bea5c04e2b34ae3d20f` retired Roadmap; aggregate lint still preserves coverage for unaffected supported workspaces.
- Keep CI verification commands unchanged; only the local runner expands duplicate-lint suites.
- Use the existing descriptor runner, with lint first, instead of new package aliases or ambient proof flags.
- Preserve the dirty root checkout and unfinished database optimization worktree; implement in `perf/prepush-lint-once` from fetched main.
- Initial validation evidence: focused regressions passed (65 tests, 8.20 seconds); changed-file ESLint and independent spec/quality reviews passed. The normal full local gate exited 1 after 523.628 seconds; the fresh Platform API Vitest cache identified `test/db-contract/branch-lease.test.ts` as its failed file. Isolated diagnosis belongs to the existing Windows branch-lease stability work. After rebasing onto the retirement commit, the focused integration set passed 66 tests in 2.37 seconds.
- At the initial baseline, the unchanged dependency lock failed the critical audit on Next.js 16.2.6, and separate issue `cee01acc-7055-4684-8bd5-7a8b7fdc3eb9` tracked the dependency fix. Main `499cc401efeec02eaa0b6bea5c04e2b34ae3d20f` resolved that blocker by retiring Next.js; no required check or security gate was waived.
- Worktree setup used the repository's frozen copyfile bootstrap after raw Forge setup rewrote the lock. The generated lock change was restored and the frozen install verified seven tool binaries. Follow-up `57d968b4-8e0d-4e30-ac35-b9fb07aa141b` tracks the duplicate setup work.
