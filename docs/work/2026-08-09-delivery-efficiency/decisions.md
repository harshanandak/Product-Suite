# Delivery efficiency decisions

## Slice 1: classifier contract

- The classifier accepts only inert metadata supplied by a trusted caller. It
  never reads, imports, or evaluates pull-request code.
- `apps/platform-api/**` is T3 because the approved plan explicitly makes that
  path a full real-Neon DB Contract trigger. Non-sensitive shared contracts and
  cross-application behavior remain T2.
- Root manifest and lockfile changes require an exact-base/head dependency proof.
  A proven UI-only closure may remain T1; missing, mismatched, unsupported, or
  database-runtime-affecting evidence is T3. The proof records affected
  workspaces, changed packages, frozen-lock consistency, and whether package
  manager lifecycle behavior changed; a lifecycle change is always T3.
- T0 is an allowlist, initially limited to Markdown documentation plus known
  inert spelling/Markdown/editor metadata. All unmatched paths fail closed.
- The classifier test uses `test/delivery/classify-change.test.js`, the
  source-relative path required by the repository's source-test coupling gate.
