# feat/f2-data-plane

- source: (local branch, no worktree)
- branch: feat/f2-data-plane
- HEAD: 49be81a1e54c477c33cad9a39568296fba436e09
- last commit: 2026-09-11T12:04:22+05:30 "docs(f2): plan review brief + host-blocked review state"
- base: origin/main at archive time (783769b8db4c1bf524e12e216b4e2ce97ddd35ef)
- commits archived: 3
- uncommitted: none
- excluded: none

## restore

```
git switch -c restore/feat__f2-data-plane 49be81a1e54c   # if the sha still exists locally; else start from origin/main
git am wip-archive/feat__f2-data-plane/commits/*.patch
git apply wip-archive/feat__f2-data-plane/uncommitted.diff
cp -r wip-archive/feat__f2-data-plane/untracked/. .
```
