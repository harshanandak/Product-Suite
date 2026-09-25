# chore/bun-latest

- source: (local branch, no worktree)
- branch: chore/bun-latest
- HEAD: 5dbf2f2d1f33a1b8fa2e717dbcb601ea1e9ff83d
- last commit: 2026-09-20T01:25:44+05:30 "docs: attribute consolidated toolchain security fix to PR 188"
- base: origin/main at archive time (783769b8db4c1bf524e12e216b4e2ce97ddd35ef)
- commits archived: 8
- uncommitted: none
- excluded: none

## restore

```
git switch -c restore/chore__bun-latest 5dbf2f2d1f33   # if the sha still exists locally; else start from origin/main
git am wip-archive/chore__bun-latest/commits/*.patch
git apply wip-archive/chore__bun-latest/uncommitted.diff
cp -r wip-archive/chore__bun-latest/untracked/. .
```
