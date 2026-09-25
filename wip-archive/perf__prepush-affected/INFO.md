# perf/prepush-affected

- source: (local branch, no worktree)
- branch: perf/prepush-affected
- HEAD: 4f7e09789812dcb1fe60d11c52d4fe8549951a99
- last commit: 2026-09-22T02:32:55+05:30 "test(tooling): share Git range fixture execution"
- base: origin/main at archive time (783769b8db4c1bf524e12e216b4e2ce97ddd35ef)
- commits archived: 4
- uncommitted: none
- excluded: none

## restore

```
git switch -c restore/perf__prepush-affected 4f7e09789812   # if the sha still exists locally; else start from origin/main
git am wip-archive/perf__prepush-affected/commits/*.patch
git apply wip-archive/perf__prepush-affected/uncommitted.diff
cp -r wip-archive/perf__prepush-affected/untracked/. .
```
