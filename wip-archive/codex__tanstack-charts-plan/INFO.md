# codex/tanstack-charts-plan

- source: (local branch, no worktree)
- branch: codex/tanstack-charts-plan
- HEAD: d86328f6ce2823b794d3f6f59ccdf6118d2ed087
- last commit: 2026-08-10T14:52:41+05:30 "feat(ui-charting): add isolated TanStack chart adapter"
- base: origin/main at archive time (783769b8db4c1bf524e12e216b4e2ce97ddd35ef)
- commits archived: 3
- uncommitted: none
- excluded: none

## restore

```
git switch -c restore/codex__tanstack-charts-plan d86328f6ce28   # if the sha still exists locally; else start from origin/main
git am wip-archive/codex__tanstack-charts-plan/commits/*.patch
git apply wip-archive/codex__tanstack-charts-plan/uncommitted.diff
cp -r wip-archive/codex__tanstack-charts-plan/untracked/. .
```
