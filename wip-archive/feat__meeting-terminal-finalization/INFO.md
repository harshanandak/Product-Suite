# feat/meeting-terminal-finalization

- source: (local branch, no worktree)
- branch: feat/meeting-terminal-finalization
- HEAD: 6394ccc88e81fd0c46641a54d3c1416a41ba8d9e
- last commit: 2026-08-08T18:34:55+05:30 "docs(plan): define meeting terminal finalization bridge"
- base: origin/main at archive time (783769b8db4c1bf524e12e216b4e2ce97ddd35ef)
- commits archived: 1
- uncommitted: none
- excluded: none

## restore

```
git switch -c restore/feat__meeting-terminal-finalization 6394ccc88e81   # if the sha still exists locally; else start from origin/main
git am wip-archive/feat__meeting-terminal-finalization/commits/*.patch
git apply wip-archive/feat__meeting-terminal-finalization/uncommitted.diff
cp -r wip-archive/feat__meeting-terminal-finalization/untracked/. .
```
