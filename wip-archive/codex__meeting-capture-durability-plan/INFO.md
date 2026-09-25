# codex/meeting-capture-durability-plan

- source: (local branch, no worktree)
- branch: codex/meeting-capture-durability-plan
- HEAD: 6d79d78a4ff9266dc81f7163984e6d58e3180535
- last commit: 2026-08-10T11:51:45+05:30 "docs(plan): design durable meeting capture"
- base: origin/main at archive time (783769b8db4c1bf524e12e216b4e2ce97ddd35ef)
- commits archived: 1
- uncommitted: none
- excluded: none

## restore

```
git switch -c restore/codex__meeting-capture-durability-plan 6d79d78a4ff9   # if the sha still exists locally; else start from origin/main
git am wip-archive/codex__meeting-capture-durability-plan/commits/*.patch
git apply wip-archive/codex__meeting-capture-durability-plan/uncommitted.diff
cp -r wip-archive/codex__meeting-capture-durability-plan/untracked/. .
```
