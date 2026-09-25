# codex/capture-session-ack-ledger-plan

- source: (local branch, no worktree)
- branch: codex/capture-session-ack-ledger-plan
- HEAD: 7a46d7e36e177920d6f285ac319ba408e791e535
- last commit: 2026-08-10T12:07:05+05:30 "docs(plan): design capture session ACK ledger"
- base: origin/main at archive time (783769b8db4c1bf524e12e216b4e2ce97ddd35ef)
- commits archived: 1
- uncommitted: none
- excluded: none

## restore

```
git switch -c restore/codex__capture-session-ack-ledger-plan 7a46d7e36e17   # if the sha still exists locally; else start from origin/main
git am wip-archive/codex__capture-session-ack-ledger-plan/commits/*.patch
git apply wip-archive/codex__capture-session-ack-ledger-plan/uncommitted.diff
cp -r wip-archive/codex__capture-session-ack-ledger-plan/untracked/. .
```
