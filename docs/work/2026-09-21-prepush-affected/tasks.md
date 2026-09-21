# Implementation task

## Task 1: Use the actual push range for affected local validation

OWNS: lefthook.yml; scripts/branch-protection.js; scripts/prepush-gate.mjs; scripts/prepush-classify.mjs; test/branch-protection.test.js; test/prepush-gate.test.js; test/prepush-classify.test.js; CHANGELOG.md; docs/work/2026-09-21-prepush-affected/decisions.md.

Implement the complete plan contract as one coherent hook change: one stdin consumer, protection before validation, validated ref records, exact destination object for existing pushes, verified upstream fork point for new pushes, existing dependency closure, conservative manifest handling and unsupported-shape rejection. Preserve standalone branch-protection callers, lint-once behavior, validation receipt handling and explicit FAST semantics. Reuse existing helpers and test fixtures rather than add dependencies or a new orchestration layer.

TDD steps:
1. Read the complete owned source and test files. Run the current three focused test files as a baseline.
2. Add failing tests for protected destinations before Bun execution, ordinary first push, advanced upstream, stacked base, alternate-remote OID, rename/delete visibility, unknown path, shared DB consumers, committed/dirty manifests, malformed records, unsupported multi-ref/tag/deletion/non-HEAD updates, missing fork point/object, and FAST default-off. Use temporary repositories with real refs for range behavior and fake Bun only for command execution.
3. Run new tests and capture expected RED evidence before production edits.
4. Implement the smallest change, preserving protected branches and existing exact-head/receipt contracts. Run focused tests to GREEN. Include an actual installed Lefthook smoke using a temporary repository so stdin/EOF and command ordering are exercised.
5. Self-review and record decisions, measured selection/overhead evidence and validation in decisions.md. Commit with hooks enabled after lead's spec and quality review or when instructed by lead. Lead owns Forge transitions, final validation, push, PR and integration.

Expected output: verifiable first pushes select affected checks; uncertain ranges select full checks; unsupported ref shapes are rejected before validation; protected refs are rejected before Bun; every focused regression passes with no skipped coverage.
