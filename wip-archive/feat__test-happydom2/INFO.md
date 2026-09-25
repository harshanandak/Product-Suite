# feat/test-happydom2

- source: (local branch, no worktree)
- branch: feat/test-happydom2
- HEAD: 65b614e7c405b77252936c4e43853f440dceffd9
- last commit: 2026-07-18T16:57:22+05:30 "perf(platform-web): migrate vitest from jsdom to happy-dom"
- base: origin/main at archive time (783769b8db4c1bf524e12e216b4e2ce97ddd35ef)
- commits archived: 1
- uncommitted: none
- excluded: none

## restore

```
git switch -c restore/feat__test-happydom2 65b614e7c405   # if the sha still exists locally; else start from origin/main
git am wip-archive/feat__test-happydom2/commits/*.patch
git apply wip-archive/feat__test-happydom2/uncommitted.diff
cp -r wip-archive/feat__test-happydom2/untracked/. .
```
