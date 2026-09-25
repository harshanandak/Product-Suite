# codex/meeting-authority-pr-b-plan

- source: (local branch, no worktree)
- branch: codex/meeting-authority-pr-b-plan
- HEAD: c3e3dd1181c899572ab818b1f6d42a304706c955
- last commit: 2026-08-09T02:19:40+05:30 "docs(plan): close final meeting review gaps"
- base: origin/main at archive time (783769b8db4c1bf524e12e216b4e2ce97ddd35ef)
- commits archived: 4
- uncommitted: none
- excluded: none

## restore

```
git switch -c restore/codex__meeting-authority-pr-b-plan c3e3dd1181c8   # if the sha still exists locally; else start from origin/main
git am wip-archive/codex__meeting-authority-pr-b-plan/commits/*.patch
git apply wip-archive/codex__meeting-authority-pr-b-plan/uncommitted.diff
cp -r wip-archive/codex__meeting-authority-pr-b-plan/untracked/. .
```
