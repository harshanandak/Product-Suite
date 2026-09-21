# Decisions and evidence

## Approved implementation boundary

The user authorized implementation of the next-task plan. Sol's final research corrected the original two-consumer idea: only one Lefthook job can consume stdin, so the validation entry invokes branch protection first using the same input. Unsupported non-HEAD/multi-ref shapes are rejected rather than misrepresenting current-checkout tests as proof for other objects. No gate bypass is authorized.

Implementation and validation evidence will be appended here; plan.md and tasks.md remain the approved authority snapshot.

## Interrupted implementation handoff

Work is incomplete and uncommitted on `perf/prepush-affected`. After the interruption, the lead verified that only the three focused test files were modified; production files were unchanged. Planning and research documents are also preserved locally. No implementation commit or PR was created.

Sol reported the baseline passing: `bun test test/branch-protection.test.js test/prepush-gate.test.js test/prepush-classify.test.js`, 66 tests, 447 assertions, zero failures, 9.04 seconds on Bun 1.4.2. The regression run then failed on missing single-consumer hook wiring, missing exported parser, and unsafe workspace-manifest narrowing. This is RED evidence, not a completed implementation. Some grouped Git fixtures reached their timeout because the old gate repeatedly executed the fake full suite; use dry-run for selection-only assertions while retaining fake Bun for ordering and fail-fast tests. Do not increase timeouts to hide fixture overhead.

The lead independently ran `bun audit --audit-level critical`: exit 0, 1,462 packages checked, zero critical advisories, 114 advisories below that threshold. This does not mean the dependency graph has no advisories.

Resume in order: verify lease and current worktree; inspect the preserved test patch; finish efficient selection fixtures; implement the approved single-consumer entry and exact-range selection; run focused GREEN and one installed-Lefthook smoke; obtain spec then quality review; run required validation; commit and push with hooks enabled; create the PR. No agents remained active after the interruption, and the stopped validation work was not restarted automatically.

Compatibility review: standalone Forge branch-protection precheck has no stdin and must remain CommonJS-compatible. The actual hook should explicitly distinguish expected input from standalone use, rejecting missing hook input. Do not treat `.forge-push-token` as proof of affected application validation; current Forge's root test only proves repo-tooling. Preserve explicit `PREPUSH_GATE_FAST` behavior and do not introduce a mapping from Forge quick mode in this change.

## Implementation decision

The hook now has one stdin consumer: `prepush-gate.mjs --pre-push` reads the stream once and invokes the existing CommonJS branch-protection entry before any Bun command. The shared parser accepts equal-width SHA-1 or SHA-256 records. The gate rejects unsupported update shapes, narrows an existing destination from its supplied remote object, and narrows a new destination only from a distinct configured upstream with a verified fork point and ancestry. Missing evidence, changed workspace manifests, dirty workspace manifests, and unknown paths retain full validation. No FAST default, Forge quick mapping, receipt behavior, dependency, or CI coverage changed.

The test fixtures use dry-run output for selection proof and reserve fake Bun execution for ordering, fail-fast, and the installed-Lefthook smoke. Process-heavy scenarios are independent tests so loaded Windows startup does not make several correct scenarios share one 30-second budget. Successful dry-run cases in the final focused run took 5.45 seconds for an ordinary first push, 7.68 seconds after upstream advanced, 8.27 seconds for a stacked base, 8.92 seconds for SHA-256, and 12.78 seconds for the divergent existing-remote proof. The installed-Lefthook smoke took 7.04 seconds. These are fixture-plus-process timings, not claimed production push savings.

Final focused validation: `bun test test/branch-protection.test.js test/prepush-gate.test.js test/prepush-classify.test.js` passed 91 tests and 508 assertions with zero failures in 136.03 seconds on Bun 1.4.2. The interrupted baseline was 66 tests and 447 assertions in 9.04 seconds before real Git range fixtures were completed; wall-clock comparison is not meaningful because the final suite adds process-heavy temporary repositories and ran under different machine load.

Test-performance follow-up: repeated Git init/config/base-commit/remote-ref setup was the shared cost across every range scenario. The test now creates one immutable real repository seed per object format, copies it into an isolated temporary directory for each scenario, and removes both seeds after the suite. The same focused command remained green at 91 tests and 508 assertions and fell from 136.03 seconds to 86.72 seconds on the same host and sequential runner, a 49.31-second (36.25%) reduction. The suite remains slower than the 9.04-second interrupted baseline because it now includes the approved real-Git range and installed-Lefthook scenarios; no timeout, assertion, or scenario was removed.

## Review and integration validation

Independent spec review approved after strengthening the divergent-remote fixture and the ambiguous first-push fallback fixtures. Independent quality review approved after consolidating raw status output into the existing Git execution helper; no new Sonar suppression remains. A tracked-dirty-manifest regression proves the exact leading-space porcelain record. Its focused check passed three tests and eleven assertions after the final helper refactor; syntax and diff checks also passed.

The lead ran `bun run test:repo-tooling`: 246 tests, 5,268 assertions, zero failures in 79.03 seconds before the final behavior-preserving helper refactor. The final refactor was checked with the three focused manifest tests, and the normal push hook will run the final committed tooling suite again. `bun run lint` passed all four configured workspace lint commands with the zero-warning threshold. `bun run check:source-test` and syntax checks for all three changed JavaScript modules passed. The fresh critical-level audit again reported no critical advisories and 114 below that threshold across 1,462 packages.

Validation uses the repository's targeted tooling commands under the approved local-checks/CI-integration boundary. No generic Forge validation receipt is claimed or reused. Push and PR checks remain required; this local evidence is not a merge-readiness claim.

Final quality correction: the shared Git command helper now optionally returns raw output, so NUL-delimited porcelain status preserves its leading index/worktree columns without a second command boundary or suppression. The tracked dirty-manifest regression proves the exact ` M packages/db/package.json\0` record. The three workspace-manifest matches passed with 11 assertions in 29.28 seconds, and `node --check scripts/prepush-gate.mjs` passed.
