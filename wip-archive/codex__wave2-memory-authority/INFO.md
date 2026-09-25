# codex/wave2-memory-authority

- source: (local branch, no worktree)
- branch: codex/wave2-memory-authority
- HEAD: 711897a01db68e858b88fb86de90f30b46ba806e
- last commit: 2026-08-08T17:55:53+05:30 "docs: reshape meeting authority delivery train"
- base: origin/main at archive time (783769b8db4c1bf524e12e216b4e2ce97ddd35ef)
- commits archived: 2
- uncommitted: none
- excluded: none

## restore

```
git switch -c restore/codex__wave2-memory-authority 711897a01db6   # if the sha still exists locally; else start from origin/main
git am wip-archive/codex__wave2-memory-authority/commits/*.patch
git apply wip-archive/codex__wave2-memory-authority/uncommitted.diff
cp -r wip-archive/codex__wave2-memory-authority/untracked/. .
```
