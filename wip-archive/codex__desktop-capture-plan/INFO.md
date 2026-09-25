# codex/desktop-capture-plan

- source: (local branch, no worktree)
- branch: codex/desktop-capture-plan
- HEAD: 935f20b1560d591d6e57aa3afe2baca83b54c72d
- last commit: 2026-08-09T22:28:41+05:30 "feat(desktop): scaffold least-privilege capture shell"
- base: origin/main at archive time (783769b8db4c1bf524e12e216b4e2ce97ddd35ef)
- commits archived: 3
- uncommitted: none
- excluded: none

## restore

```
git switch -c restore/codex__desktop-capture-plan 935f20b1560d   # if the sha still exists locally; else start from origin/main
git am wip-archive/codex__desktop-capture-plan/commits/*.patch
git apply wip-archive/codex__desktop-capture-plan/uncommitted.diff
cp -r wip-archive/codex__desktop-capture-plan/untracked/. .
```
