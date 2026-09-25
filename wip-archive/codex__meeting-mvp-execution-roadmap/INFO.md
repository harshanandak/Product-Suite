# codex/meeting-mvp-execution-roadmap

- source: (local branch, no worktree)
- branch: codex/meeting-mvp-execution-roadmap
- HEAD: a9ad75bbdefb23c08c96ba3c2dc0c20e3c2562e2
- last commit: 2026-08-09T06:39:36+05:30 "docs(plan): define meeting MVP execution roadmap"
- base: origin/main at archive time (783769b8db4c1bf524e12e216b4e2ce97ddd35ef)
- commits archived: 1
- uncommitted: none
- excluded: none

## restore

```
git switch -c restore/codex__meeting-mvp-execution-roadmap a9ad75bbdefb   # if the sha still exists locally; else start from origin/main
git am wip-archive/codex__meeting-mvp-execution-roadmap/commits/*.patch
git apply wip-archive/codex__meeting-mvp-execution-roadmap/uncommitted.diff
cp -r wip-archive/codex__meeting-mvp-execution-roadmap/untracked/. .
```
