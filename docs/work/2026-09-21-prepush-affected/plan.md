# Safe affected checks on first push

Date: 2026-09-21. Classification: Refactor. Issue: 1944f7bd-fcaf-4131-b58a-3ddc1f8b753b.

## Purpose and approval

Reduce unnecessary local validation on a first feature push without reducing selected-suite coverage or weakening branch protection. The user approved the independently reviewed next-task plan with "lets continue on that". This artifact finalizes that external plan for implementation.

## Approach

Use one Lefthook pre-push entry point with `use_stdin: true`. Read Git's ref-update stream once; run existing branch protection before validation, then classify the same records. Export/reuse its validated parser and main entry where possible; keep standalone branch protection compatible with Forge.

Optimize only one branch update whose local ref and OID match the current branch and HEAD. Existing destinations use Git's remote OID to local OID two-dot diff. New destinations require an unambiguous configured upstream distinct from the destination, a verified `merge-base --fork-point`, and ancestry proof. Keep `--no-renames`; missing or uncertain evidence retains full validation.

Never use default-main, HEAD~1, cached changes, or three-dot shortcuts. Keep FAST opt-in. Reuse existing classification and reverse-dependency expansion. Committed workspace manifests and dirty manifests used by that graph prevent narrowing; other dirty validation-relevant files must not cause a smaller suite selection than the committed push requires.

Unsupported multi-ref, tag, deletion-only, or non-HEAD updates must not be declared validated by tests of another checkout. Conservatively reject unsupported shapes before running tests with guidance to push a checked-out branch individually. Empty input in standalone invocation retains full validation; malformed Git input fails closed. Protected destination rejection always precedes any Bun command.

## Success criteria

- A real first push with a verifiable fork selects every affected suite and omits unrelated suites.
- Existing alternate-remote updates use their actual remote object.
- Shared-package consumer coverage, rename/delete visibility, unknown-path fallback, lint-once ordering, environment sanitation, validation-receipt behavior, and fail-fast semantics remain intact.
- One stdin consumer preserves protection and does not hang in actual Lefthook invocation.
- Git fixtures prove advanced upstream, stacked base, missing object/base, malformed records, unsupported refs, and manifest drift.
- Focused tests and required validation pass; report selected commands and measured selector overhead, not invented end-to-end savings.

## Scope and reverse path

Own hook wiring, branch-protection parser reuse, pre-push range/classifier logic, focused tests, changelog and these maintainer docs. No dependencies, Forge runtime changes, GitHub settings, database writes, CI coverage changes, or default FAST mode. Revert this focused PR to restore prior hooks. Schema, API, UI, reverse product states and agent surfaces do not apply; maintainer docs do.

## Technical research

Remote main inspected: 575afded41e76b86a5633f9def2add3996590841. Current `@{push}..HEAD` fails when a feature's remote ref does not exist. Existing classifier already expands workspace consumers. It reads workspace manifests from disk, so manifest changes require conservative handling. Existing tests have fake Bun execution and temporary Git fixtures.

Official Lefthook documentation says only one job receives stdin if several request it: https://lefthook.dev/configuration/use_stdin/ . Therefore consolidate entry, not multiple stdin consumers. Git-provided OIDs are data passed as argument arrays; never interpolate ref input into shell commands or output remote URLs/secrets. No new runtime dependency is needed. The security concern is preserving branch protection and fail-closed input validation, not a product threat-model change.

## Ambiguity policy

Prefer conservative full validation for uncertain ranges within the supported current-HEAD shape. Reject unsupported checkout/ref shapes rather than claiming coverage of untested objects. Use the repository decision rubric for other gaps; record decisions separately without altering approved plan/task snapshots.
