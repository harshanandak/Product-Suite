# perf/db-prepare-speed

- source: C:/Users/harsha_befach/Downloads/Personal-Projects/Product-Suite/.worktrees/db-prepare-speed
- branch: perf/db-prepare-speed
- HEAD: 15278568cf873234b3bf7a78fe66154a51d32b1b
- last commit: 2026-09-21T00:27:54+05:30 "perf(test): share one transactional branch per DB Contract mixed suite"
- base: origin/main at archive time (783769b8db4c1bf524e12e216b4e2ce97ddd35ef)
- commits archived: 1
- uncommitted: 4 entries (1 untracked); untracked copied: 1
- excluded: none

## restore

```
git switch -c restore/perf__db-prepare-speed 15278568cf87   # if the sha still exists locally; else start from origin/main
git am wip-archive/perf__db-prepare-speed/commits/*.patch
git apply wip-archive/perf__db-prepare-speed/uncommitted.diff
cp -r wip-archive/perf__db-prepare-speed/untracked/. .
```
