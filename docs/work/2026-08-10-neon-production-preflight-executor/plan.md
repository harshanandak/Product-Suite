# Protected Neon production preflight executor

**Feature:** `neon-production-preflight-executor`
**Date:** 2026-08-10
**Status:** PLAN complete; implementation and every production action require separate human approval
**Forge issue:** `544a6a1c-6b21-4776-8e2d-493d4e885190`
**Planning base:** exact `origin/main` `5a4ed8d8f52b7fe78044fac000602b9cd6552ee0`

## Purpose

Rollout `85be2b76-7ef6-4add-abd5-e0dea6e02492` needs a repeatable production preflight that can inspect the canonical Neon authority without inheriting the existing deploy workflow's ability to provision roles, apply migrations, or deploy. The executor must produce reviewable, redacted evidence and stop on every ambiguity. It does not authorize the later migration apply.

## Success criteria

1. A dedicated, manually dispatched workflow runs from `refs/heads/main`, checks out the operator-entered full 40-character SHA, and fails unless that SHA equals both the checked-out commit and current `origin/main`.
2. The job uses a separate protected GitHub environment, `db-preflight-production`, with required reviewers and protected-branch deployment policy. It has only `contents: read`; no write, OIDC, package, deployment, Cloudflare, or apply-environment permission/secret is available.
3. The environment's `MIGRATION_DATABASE_URL` is a distinct direct Neon credential for the one LOGIN identifier pinned by the approved attestation. It receives only the named `product-suite-neon-preflight-reader-v1` grant contract; it is never the owner/apply credential or another LOGIN. The verifier binds the observed role and canonical grant-contract digest into evidence and rejects either mismatch. It proves the role is not superuser, `CREATEDB`, `CREATEROLE`, replication, or bypass-RLS; has no database/schema `CREATE` or temporary-object authority; and has no direct, inherited, `PUBLIC`, or default-ACL write path to any ledger/migration table or sequence. Missing least-privilege proof is a hard failure.
4. The only repository command given database credentials is exactly:

   ```text
   bun run migrate:database -- verify --environment production --history-variant original-production --expected-floor 0017
   ```

   `MIGRATION_DATABASE_URL` exists only in that step's `env`. Install, checkout, SHA validation, artifact upload, and all other steps receive no database secret.
5. The canonical verifier recognizes the ordered `original-production` vector through `0017`, count `18`, and derives the exact repository suffix. For rollout 85be it succeeds only when pending is exactly `0018,0019` (or `0019` if the observed floor is explicitly changed by a separately reviewed rollout revision); mixed, unknown, partial, duplicate, reordered, hash/timestamp mismatch, extra pending, or changed floor fails closed.
6. One structured artifact records only allowlisted fields: schema version, PASS/FAIL and stable reason codes, run/repository/SHA, attestation Git-blob/SHA-256/signature identity, Neon endpoint ID, approved project/branch/database/schema identifiers and proof source, pinned preflight LOGIN identifier, named grant-contract version/digest, `original-production`, applied count/floor and per-tag hashes/timestamps, derived pending tags/hashes, recovery reference, catalog/grant digest, allowlisted aggregate row counts, and timestamps. URLs, passwords, SQL, environment dumps, query text, and row payloads are never serialized or logged. The LOGIN identifier and non-secret digests are explicitly allowed; no connection username is inferred or emitted from the URL.
7. The preflight consumes the exact checked-in `config/neon-production-preflight-attestation.json`, validated by `config/neon-production-preflight-attestation.schema.json` and the repository-pinned Ed25519 trust key. The signed canonical payload names the exact Neon project ID, production branch ID, endpoint ID, `neondb`, `public`, approved preflight LOGIN identifier, grant-contract digest, recovery kind/ID/source-branch ID, source kind and immutable source hash, production time, validity window, signer key ID, and signature. The artifact binds that file's Git blob ID and SHA-256 to the exact run SHA. Absent, stale, forged, unsigned, operator-entered shape-only, endpoint-mismatched, or recovery-mismatched evidence fails; unsupported identity claims are `UNPROVEN`, never assertions.
8. Repository tests demonstrate that the workflow cannot dispatch `bootstrap`, `apply`, role provisioning, arbitrary SQL, Neon control-plane mutation, Cloudflare/Wrangler deploy, or another workflow; that no apply/deploy job depends on it; and that its environment, secret scope, permissions, concurrency, timeout, ref, and exact-SHA checks are fixed.
9. The preflight has no automatic successor. A PASS artifact is reviewed independently, then rollout 85be requires its own fresh lease proof and explicit apply approval in `db-migrate-production`.

## Out of scope

- Editing a workflow, verifier, credential, GitHub environment, or Neon resource in PLAN.
- Calling production, creating or rotating roles, creating a recovery branch/snapshot, or discovering secrets.
- Migration apply/bootstrap, role provisioning, DDL/DML, deploy, engine upgrade, data copy/drop, journal rewrite, down migration, or workflow chaining.
- Treating aggregate row counts as tenant-isolation proof or exposing production identifiers/data beyond the approved evidence allowlist.
- Closing rollout 85be or authorizing Meeting Authority work.

## Approach selected

### Selected: dedicated workflow plus a fail-closed extension of the canonical verifier

Add one standalone preflight workflow and extend the existing `verify` path/evidence schema. The workflow supplies no executable choice: there is no operation input and its sole credentialed command is the fixed canonical `verify` command. The verifier, not shell snippets, owns read-only SQL, history classification, invariant evaluation, and redaction.

This is the smallest approach that separates preflight authority from `.github/workflows/platform-api-deploy.yml`, whose `migrate` job can currently run `provision:database-roles`, `apply`, post-apply `verify`, and then unblock `deploy`. Reusing or parameterizing that workflow would retain excessive authority and an unsafe job graph.

Alternatives rejected:

- **A preflight flag on the deploy workflow:** fewer YAML lines, but the same protected run and job graph retain provisioning/apply/deploy authority.
- **A shell-only workflow around the current verifier:** the current verifier reads the journal but does not prove derived pending suffix, target/recovery identity, grants, catalog, or row-count invariants, and its evidence is insufficient for the rollout gate.
- **A new independent database script:** duplicates history authority and invites drift. The canonical verifier must remain the single migration-history decision point.

## Technical design

### 1. Authority separation

`db-preflight-production` and `db-migrate-production` are different GitHub environments with different credentials and approvals. The preflight environment contains only the read-only direct Neon URL plus non-secret expected identifiers/contract inputs. It must not expose `NEON_API_KEY`, the owner migration URL, Cloudflare tokens, runtime secrets, or deployment credentials.

The executor cannot provision its own read-only role; that would defeat the boundary. `config/neon-production-preflight-grants.json` defines `product-suite-neon-preflight-reader-v1`: the approved LOGIN identifier/digest is supplied by the signed attestation, while the grant contract enumerates the only positive reads and every required negative privilege. If that exact role/grant state does not already exist, implementation stops at a human infrastructure gate. Provisioning or credential rotation belongs to a separately approved operation.

### 2. Exact target and recovery proof

The direct host proves an endpoint ID, not by itself the Neon project or branch. Neon's control-plane model maps each endpoint to a project and branch, so the repository carries an immutable, non-secret signed attestation at `config/neon-production-preflight-attestation.json`. Its canonical payload schema is:

```text
schemaVersion = neon-production-preflight-attestation.v1
target = { projectId, productionBranchId, endpointId, database: "neondb", schema: "public" }
role = { loginIdentifier, grantContract: "product-suite-neon-preflight-reader-v1", grantContractSha256 }
recovery = { kind: "branch"|"snapshot", id, projectId, sourceBranchId, createdAt, expiresAt }
source = { kind: "neon-control-plane-export"|"independently-signed-export", immutableSourceSha256, producedAt }
validity = { notBefore, expiresAt }
signature = { algorithm: "Ed25519", keyId, canonicalPayloadSha256, value }
```

The source must be a control-plane-produced immutable export or an independently signed export; in both cases the repository-pinned reviewer signature covers every field above. The workflow validates JSON Schema, canonical payload hash, Ed25519 signature/key ID, freshness, recovery readiness window, exact project/production-branch/endpoint/database/schema/role/grant values, Git blob ID, file SHA-256, and exact run SHA before the secret step. An operator-entered UUID or matching string shape is never proof. The verifier independently matches the URL endpoint/database and observed role/grants to the signed payload. If this chain cannot be produced without expanding credentials, the run remains `INCOMPLETE`.

### 3. Canonical read-only verification

The `verify` CLI opens an explicit read-only transaction and performs allowlisted `SELECT` statements only:

- current database/schema/server and current-role privilege posture;
- ordered Drizzle journal rows and recognized historical hashes;
- derived repository pending suffix and hashes;
- deterministic catalog/grant snapshot for the floor-`0017` checkpoint;
- allowlisted aggregate row counts needed for before/after comparison.

The named grant contract requires `CONNECT`, schema `USAGE`, and only the enumerated `SELECT` rights. It explicitly evaluates `has_schema_privilege`, `has_table_privilege`, and `has_sequence_privilege` for the current LOGIN, every transitive inherited role, `PUBLIC`, PostgreSQL built-in/default roles (including `pg_database_owner`, `pg_read_all_data`, and `pg_write_all_data`), and applicable `pg_default_acl` paths. For every Drizzle journal, migration ledger, row-count ledger/table, and associated sequence, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`, sequence `USAGE`/`UPDATE`/`SELECT`, database/schema `CREATE`, and temporary-object paths must all be false unless an exact positive read is named. The canonical catalog/grant snapshot and contract digest are bound into the artifact.

After static privilege checks, the verifier attempts deny probes for `INSERT`, `UPDATE`, `DELETE`, DDL, and sequence `nextval` in both autocommit and an explicit transaction. Every probe must fail with an allowlisted PostgreSQL read-only/insufficient-privilege code; success is a critical failure. Probes target only contract-named sentinel-safe ledger/migration objects and run with `default_transaction_read_only=on`; implementation must not invent a production probe whose unexpected success could alter business rows. The explicit transaction is always rolled back. If a safe autocommit denial probe cannot be guaranteed by the credential/target contract, the executor is not write-incapable and must stop before production dispatch.

The verifier rolls back/ends the read-only transaction, emits a single redacted evidence packet, and closes the pool. A query error, timeout, unexpected extra/missing object, unsupported privilege observation, or artifact-validation error is a nonzero result with a stable redacted code.

The current `verify` zero-pending behavior at floor `0019` remains intact. Pre-apply production verification at floor `0017` is explicitly recognized as `PREFLIGHT_READY` only when the derived suffix matches the production allowlist and all other gates pass; it is never labeled `NOOP`.

### 4. Workflow contract

- `workflow_dispatch` only; no push, schedule, `workflow_run`, repository dispatch, or callable trigger.
- Required full SHA input; dispatch ref must be `refs/heads/main`; checkout is pinned and credentials are not persisted.
- Before secrets are in scope: compare input, checkout SHA, and fetched current `origin/main`; validate the checked-in attestation's schema, Git blob/SHA-256, canonical payload hash, Ed25519 signature/trust key, source hash, freshness, and recovery reference. Shape-only validation is forbidden.
- Dependency install uses the lockfile and `--ignore-scripts`.
- One credentialed step runs the exact command, writes the evidence file, and exposes no shell tracing.
- Artifact upload uses a digest-bearing fixed name and short retention. A redacted failure artifact is uploaded when safely available; absence of a valid PASS artifact is failure.
- Job concurrency is one dedicated preflight group with `cancel-in-progress: true`; cancellation is safe because every database transaction is read-only. A timeout bounds connection and runner hangs.
- No `needs` edge, reusable output, dispatch token, or automatic call connects this workflow to migration apply or deploy.

### 5. Evidence and privacy

Evidence is deny-by-default: the serializer copies only schema-defined scalar/array fields and validates tag/hash/identifier formats. It explicitly allows the approved non-secret preflight role identifier, grant/catalog digest, attestation hash/signature identity, and recovery IDs. It rejects unknown keys and recursively scans the final JSON for URL schemes, passwords, credential/query-string patterns, SQL verbs/text, environment-like keys, and row payloads before writing. Errors are stable codes, not driver messages.

Aggregate row counts are limited to the explicitly approved contract and are intended only as pre/post rollout invariants. They do not replace authorization or tenant-isolation tests.

## Security analysis

- **A01 Broken access control:** separate environment, reviewer gate, least-privilege database role, no apply/deploy credentials, and no automatic successor.
- **A02 Cryptographic failures / secret exposure:** step-scoped secret, no lifecycle scripts while secrets are present, no shell tracing, deny-by-default evidence, redacted errors, and no credential persistence.
- **A03 Injection:** no user-supplied SQL or identifiers; fixed queries and strict identifier/attestation formats. The workflow has no free-form command input.
- **A04 Insecure design:** exact SHA, current-main equality, read-only credential plus read-only transaction, fail-closed identity proof, and independent artifact review.
- **A05 Misconfiguration:** structural tests lock triggers, environment, permissions, secret scope, action pins, concurrency, timeout, and absence of dangerous commands/jobs.
- **A08 Integrity failures:** frozen lockfile, pinned actions, exact checkout, immutable artifact digest, recognized history hashes, and strict schema validation.
- **A09 Logging/monitoring failures:** stable PASS/FAIL codes and artifact provenance without secrets; cancellation and missing artifacts remain visible failures.
- **A10 SSRF:** no operator-provided URL; only the protected Neon URL is accepted and its direct Neon host/database/TLS/endpoint are validated.

## Edge cases and fail-closed decisions

- Current main moves after dispatch or checkout: fail; re-dispatch at the new reviewed SHA.
- Existing owner/apply credential, an unpinned LOGIN, or a role/grant digest mismatch: fail; do not reuse or infer identity from the URL username.
- Attestation is absent, stale, forged, unsigned, signed by an untrusted key, hash/blob/run-SHA mismatched, shape-only, or its project/production-branch/endpoint/database/schema/recovery fields disagree: `UNPROVEN`, fail.
- Any direct, inherited, `PUBLIC`, or default-ACL write path exists, or any autocommit/transaction deny probe succeeds: critical fail and no production retry until role grants are corrected through a separately approved operation.
- Journal vector is CRLF/LF mixed outside the approved immutable manifest, or count/floor differs: fail.
- Observed pending is empty, extra, reordered, or not the approved suffix: fail. A later legitimate state requires a new reviewed plan/contract, not a permissive flag.
- Catalog or grant inspection lacks visibility: fail, rather than treating missing rows as compliant.
- Row-count query times out or an expected table is absent: fail; never emit partial PASS.
- Artifact serialization or upload fails: the workflow fails and confers no approval.
- Cancellation: read-only transaction ends with connection teardown; no recovery operation is needed.

## TDD scenarios

1. Happy path: exact main SHA, signed fresh attestation with matching blob/hash/signature/project/production-branch/endpoint/recovery/role/grant digest, exact named read-only contract, 18-row recognized `0000..0017` vector, derived `0018,0019`, exact catalog/grants/counts -> `PREFLIGHT_READY` and redacted artifact.
2. History failure: one unknown/reordered/duplicate hash or unexpected pending tag -> stable nonzero code, no PASS artifact, and query spy shows no mutating SQL.
3. Privilege adversary: owner/other LOGIN, role/digest mismatch, superuser/`CREATEROLE`/schema-CREATE, direct/inherited/`PUBLIC`/default-ACL write grant, or any successful autocommit/transaction `INSERT`/`UPDATE`/`DELETE`/DDL/`nextval` probe -> reject before history is accepted; catalog/grant digest mismatch also rejects.
4. Workflow adversary: non-main dispatch, short/stale SHA, altered command, added apply/provision/deploy token, broader permissions, secret at job scope, or dependency lifecycle script -> structural test fails.
5. Redaction adversary: driver error and evidence input containing URL/password/SQL/row payload/unknown key -> output contains only stable code and allowlisted metadata.
6. Identity ambiguity: UUID-shaped operator input, missing/stale/forged attestation, bad signature/source hash/blob/run-SHA, or mismatched project/production branch/endpoint/database/schema/recovery -> `UNPROVEN`, fail.
7. Post-apply compatibility: recognized floor `0019` with zero derived pending keeps existing `NOOP` semantics.

## Validation plan

- Focused RED/GREEN tests for migration verification/evidence and workflow structure.
- Mutation/adversarial tests for every dangerous command/trigger/permission and every evidence-redaction class.
- Existing authority, migration, evidence, secret-boundary, historical-artifact, parity, catalog, and repo-tooling tests.
- YAML parse plus exact-string assertions for the fixed command and step-scoped secret.
- No production call is part of DEV or VALIDATE. The first protected run is a later human-gated rollout action.

## Rollback

Before any production run, rollback is `git revert` of the implementation commit/PR; no database action is required. A failed/cancelled preflight produces no database mutation and only its redacted artifact is retained. Do not rewrite migration history, down-migrate, delete a recovery reference, or fall through to apply. Apply rollback remains rollout 85be's separate decision: prior application version plus an explicit Neon recovery-branch/snapshot restore decision.

## Ambiguity policy

Security, authority, identity, migration history, and data-integrity ambiguity scores below the `/dev` 80% threshold and must stop for human review. No conservative default may broaden credentials, accept an unproven target, weaken a suffix/catalog/grant/count invariant, or connect preflight to apply.

## Human gates

1. **DEV approval:** approve this plan/tasks before any implementation.
2. **Infrastructure approval:** independently create/verify the pinned LOGIN and exact `product-suite-neon-preflight-reader-v1` grant digest, protected `db-preflight-production` environment, required reviewers, signed fresh repo attestation/control-plane source, and recovery reference. Do not reuse `db-migrate-production` authority. This approval must include safe autocommit and transaction denial-probe feasibility.
3. **Preflight dispatch approval:** approve one exact-main SHA and run only the dedicated executor.
4. **Artifact review:** independent reviewer accepts the exact artifact or records FAIL/INCOMPLETE.
5. **Apply approval:** separate lease proof and explicit `db-migrate-production` approval for rollout 85be. Preflight PASS never dispatches or implies apply.
