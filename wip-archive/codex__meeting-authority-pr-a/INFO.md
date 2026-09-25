# codex/meeting-authority-pr-a

- source: (local branch, no worktree)
- branch: codex/meeting-authority-pr-a
- HEAD: a40d0853f81aa5df1235a790c4aad496bd96d96e
- last commit: 2026-08-09T14:04:02+05:30 "docs(plan): finalize meeting authority delivery split"
- base: origin/main at archive time (783769b8db4c1bf524e12e216b4e2ce97ddd35ef)
- commits archived: 4
- uncommitted: none
- excluded: none

## restore

```
git switch -c restore/codex__meeting-authority-pr-a a40d0853f81a   # if the sha still exists locally; else start from origin/main
git am wip-archive/codex__meeting-authority-pr-a/commits/*.patch
git apply wip-archive/codex__meeting-authority-pr-a/uncommitted.diff
cp -r wip-archive/codex__meeting-authority-pr-a/untracked/. .
```
