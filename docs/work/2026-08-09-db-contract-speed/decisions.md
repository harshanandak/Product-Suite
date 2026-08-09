# DB Contract runtime reduction — decisions

## Task A1 — topology and fail-closed collection

- The contract inventory is an explicit 57-entry manifest: 19 transactional real assertions, 9 dedicated-branch real assertions, and 29 control-plane/unit assertions.
- Control-plane counts are locked at `neon-authority: 18`, `role-privileges: 7`, and `reap: 4`; these entries never count as branch coverage.
- Unknown test ids fail closed instead of being inferred from a file or name prefix.
- The required config keeps Vitest file/suite concurrency at one until the serial isolation work is proven.
- The custom reporter rejects zero/count-mismatched collections, skipped/todo/pending/filtered tests, unclassified assertions, missing exact-head metadata, and incomplete cleanup with stable redacted codes.

## Task A4 — routing decision

- **A4-1:** Correct the manifest inversion before routing: `accept-path:5` is a dedicated-branch proof because it verifies committed idempotency across a repeated accept, while `baseline:11` is transactional because its tenant-scoping proof is fully rollback-safe. An AST-based topology regression compares every routed call site with this explicit execution class and rejects the legacy `withDbBranch` alias.
