# Branch lease runtime matrix

Date: 2026-08-30
Issue: `8ab811b2-8a86-4161-beb6-7b5b4d02cd08`
Tested ref: `217ff5ce41656327d00f71fc4b866b0a347b599b`

## Result

```text
result = NULL_SOURCE_ALREADY_FIXED
supported_signature = NOT_REPRODUCED
source_change = NONE
test_change = NONE
workflow_change = NONE
timeout_change = NONE
```

The issue signature is `DB_CONTRACT_BRANCH_LEASE_LOCK_UNCERTAIN` where the timed-out waiter test expects `DB_CONTRACT_BRANCH_LEASE_ACQUISITION_TIMEOUT`. Current tracked source already retries `EEXIST` everywhere and `EPERM` only on Windows, while unknown filesystem errors remain `LOCK_UNCERTAIN`. `git diff --exit-code origin/main...HEAD -- apps/platform-api/test/db-contract/branch-lease.ts apps/platform-api/test/db-contract/branch-lease.test.ts .github/workflows/db-contract.yml` exited 0, proving this R1 branch changes no source, test, or workflow surface. Because the timeout values live in those unchanged source and test files, it also makes no timeout edit.

After rebasing, the same two-file diff from tested ref `217ff5ce41656327d00f71fc4b866b0a347b599b` through current main `60c2c5882797240a5699200c0f016689d509ed00` also exits 0.

Immediately before the final review push, `git fetch origin main`, `git rev-parse origin/main`, and `git merge-base --is-ancestor origin/main HEAD` resolved main to `60c2c5882797240a5699200c0f016689d509ed00` and exited 0.

Bun 1.3.6 is supported: the root `packageManager` and the DB-contract workflow pin it. Bun 1.4.0 is compatibility evidence only.

## Matrix

| OS | Bun | Branch-lease file | Exact timeout regression | Outcome |
| --- | --- | --- | --- | --- |
| Windows | 1.3.6 | 17/17 passed | 50/50 consecutive passes | Supported signature not reproduced |
| Windows | 1.4.0 | 17/17 passed | Covered by the file run | Compatibility pass |
| Linux (WSL2 Ubuntu) | 1.3.6 | 17/17 passed | Covered by the file run | Supported pass |
| Linux (WSL2 Ubuntu) | 1.4.0 | 17/17 passed | Covered by the file run | Compatibility pass |

The clean Windows Bun 1.3.6 Platform API suite also passed: 80 files passed, 6 skipped; 965 tests passed, 29 skipped; exit 0.

## Commands and exact outcomes

Windows cells used a clean Git archive at `C:\tmp\product-suite-r1-win-217ff5c`, installed from the frozen lockfile with scripts disabled.

```powershell
npm exec --prefix C:\tmp\product-suite-r1-runtime --yes --package=bun@1.3.6 -- bun run --cwd C:\tmp\product-suite-r1-win-217ff5c\apps\platform-api test -- test/db-contract/branch-lease.test.ts
# exit 0; 1 file passed; 17 tests passed

npm exec --prefix C:\tmp\product-suite-r1-runtime --yes --package=bun@1.4.0 -- bun run --cwd C:\tmp\product-suite-r1-win-217ff5c\apps\platform-api test -- test/db-contract/branch-lease.test.ts
# exit 0; 1 file passed; 17 tests passed

npm exec --prefix C:\tmp\product-suite-r1-runtime --yes --package=bun@1.3.6 -- bun run --cwd C:\tmp\product-suite-r1-win-217ff5c\apps\platform-api test
# exit 0; 80 files passed, 6 skipped; 965 tests passed, 29 skipped

# Revalidated after rebase with this exact pinned Bun 1.3.6 wrapper:
$bunExe = (Get-Command bun.exe -ErrorAction Stop).Source
$bunDir = Split-Path -Parent $bunExe
$repoRoot = (& git rev-parse --show-toplevel).Trim()
$platformApi = Join-Path $repoRoot 'apps/platform-api'
$env:PATH = "$bunDir;$env:PATH"
$version = (& $bunExe --version).Trim()
if ($version -ne '1.3.6') { throw "Expected Bun 1.3.6, got $version" }
$passed = 0
for ($iteration = 1; $iteration -le 50; $iteration++) {
  & $bunExe run --cwd $platformApi test -- test/db-contract/branch-lease.test.ts '--testNamePattern=removes.*timed-out.*waiter.*disturbing.*active.*capacity' --reporter=dot *> $null
  if ($LASTEXITCODE -ne 0) { throw "Iteration $iteration failed with exit $LASTEXITCODE" }
  $passed++
}
"BUN_VERSION=$version PASSED=$passed FAILED=0"
# BUN_VERSION=1.3.6 PASSED=50 FAILED=0
```

Linux cells used an isolated Git archive at `/tmp/product-suite-r1-linux-217ff5c`; PATH was pinned so the child-process test inherited the same native Bun binary as Vitest.

```sh
PATH=/tmp/product-suite-r1-bun/1.3.6/bun-linux-x64:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH
test "$(bun --version)" = "1.3.6" || exit 1
bun run --cwd /tmp/product-suite-r1-linux-217ff5c/apps/platform-api test -- test/db-contract/branch-lease.test.ts
# Bun 1.3.6 asserted; exit 0; 1 file passed; 17 tests passed

PATH=/tmp/product-suite-r1-bun/1.4.0/bun-linux-x64:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH
test "$(bun --version)" = "1.4.0" || exit 1
bun run --cwd /tmp/product-suite-r1-linux-217ff5c/apps/platform-api test -- test/db-contract/branch-lease.test.ts
# Bun 1.4.0 asserted; exit 0; 1 file passed; 17 tests passed
```

## RED/GREEN classification and remaining uncertainty

No issue-specific RED reproduced on supported Bun 1.3.6, so the production TDD edit gate was not entered. The exact regression remained GREEN for 50 consecutive Windows passes, and the broad suite remained GREEN once.

A whole-file Windows Bun 1.3.6 repetition produced a different RED on iteration 14: `TEST_TIMEOUT` at `branch-lease.test.ts:165` in `observes the full configured acquisition budget before timing out the test observer`, after 13 complete 17/17 passes. It did not produce `LOCK_UNCERTAIN`, is outside the locked semantic signature, and was not used to justify a source or timeout change. This separate observer/scheduling flake needs its own compatibility follow-up if it is prioritized.
