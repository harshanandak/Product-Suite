# feat/memory-injection-ranker

- source: (local branch, no worktree)
- branch: feat/memory-injection-ranker
- HEAD: 451cdfa001c8d5a6c9507c202f42d16a969780cb
- last commit: 2026-07-24T20:18:23+05:30 "test(e2e): update moat-loop step c to inline ProposalCard selector"
- base: origin/main at archive time (783769b8db4c1bf524e12e216b4e2ce97ddd35ef)
- commits archived: 8
- uncommitted: none
- excluded: none

## restore

```
git switch -c restore/feat__memory-injection-ranker 451cdfa001c8   # if the sha still exists locally; else start from origin/main
git am wip-archive/feat__memory-injection-ranker/commits/*.patch
git apply wip-archive/feat__memory-injection-ranker/uncommitted.diff
cp -r wip-archive/feat__memory-injection-ranker/untracked/. .
```
