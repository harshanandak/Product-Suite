# feat/external-meeting-connector

- source: (local branch, no worktree)
- branch: feat/external-meeting-connector
- HEAD: e9e9a337650b723ad9fb74784a9080bf721b69e6
- last commit: 2026-08-08T18:08:37+05:30 "docs(plan): isolate meeting source adapter ownership"
- base: origin/main at archive time (783769b8db4c1bf524e12e216b4e2ce97ddd35ef)
- commits archived: 3
- uncommitted: none
- excluded: none

## restore

```
git switch -c restore/feat__external-meeting-connector e9e9a337650b   # if the sha still exists locally; else start from origin/main
git am wip-archive/feat__external-meeting-connector/commits/*.patch
git apply wip-archive/feat__external-meeting-connector/uncommitted.diff
cp -r wip-archive/feat__external-meeting-connector/untracked/. .
```
