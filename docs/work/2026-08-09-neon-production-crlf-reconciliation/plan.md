# Neon production CRLF reconciliation

- Date: 2026-08-09
- Status: PLAN only; Critical; implementation requires a separate human approval
- Forge issue: `774a178d-0fb5-4767-8e51-26e3186fe347`
- Planning base: `9c38161b21fb88eaee6ffe50f55e9f43259ef86d`

## Purpose

Make the protected production migration preflight recognize the exact historical bytes already recorded in Neon's `drizzle.__drizzle_migrations` without changing production rows, migration SQL, or database objects. Neon remains the sole live Postgres authority.

## Proven cause and selected approach

The observed 18-row production journal is an exact ordered vector: migrations `0000` through `0016` were hashed from CRLF bytes and `0017` from LF bytes. The current runner canonicalizes SQL to LF before hashing, so 15 legitimate CRLF hashes are reported as unknown. Every observed hash maps uniquely to a Git-reachable migration blob; there is no evidence of an unknown migration.

Extend the validation-only historical manifest with one immutable `original-production` ordered vector containing tag, filename, observed SHA-256, line-ending variant, Git blob OID, and source commit. The checker must reproduce each hash from the cited blob bytes and reject any missing, reordered, duplicated, mixed, non-unique, or extra entry. The runner may translate a database hash to a tag only through this validated exact vector; it must not accept arbitrary CRLF/LF alternatives or normalize observed journal hashes.

## Exact provenance vector

The source for historical `0000` and `0004` is commit `341caeb0072f6642ce9b2172c1d092f91bcd3265`; all other blobs are present at planning base `9c38161b21fb88eaee6ffe50f55e9f43259ef86d`.

| Tag | File | Bytes | Observed SHA-256 | Blob OID |
|---|---|---|---|---|
| 0000 | `0000_stale_jamie_braddock.sql` | CRLF | `da63f59c785b78d0896d21880821f12d0cf306f5b6f6ce5e890d525de269d507` | `abcd85f41a46142669bdb6567c0c60600b431ba1` |
| 0001 | `0001_dear_the_enforcers.sql` | CRLF | `66c78756b0c967113d4b6aa44f3f3a233bd55702465ff73052b8fd0f7cf45f7f` | `93d6f6e7554aaf829211ff6e5946199ed3db59e7` |
| 0002 | `0002_polite_orphan.sql` | CRLF | `d258edd36bd2c50a5bb8c52868494e50b3ab65bf525c50b717c6714384e870d2` | `6d30e4febad868f447b1e37e74932fe07e4bd158` |
| 0003 | `0003_tranquil_tattoo.sql` | CRLF | `ae5da2c02c82bc8f8ee812edafd70889a4cbfc985fa70e7cb3746392d5e2615c` | `7c0188c9117034b41ad7745c9711aeec1ddc2266` |
| 0004 | `0004_minor_lockheed.sql` | CRLF | `1d73a91952aa4f1b1ce184777ae39484fb876d2bad72d21bc3a428bba6d60ac7` | `2889d9fc4459dac1fa576c51fc2a1baf60131415` |
| 0005 | `0005_rename_tasks_to_checks.sql` | CRLF | `8fa959937b555b0383ca769ef783582e4cb53236bff363bdcf3d404c3cbd9423` | `8ad031b8876ea1eca0da5fa591afb3102a7b6ed8` |
| 0006 | `0006_provenance_foundation.sql` | CRLF | `e44ecd32b0605c8101db8991414d8b9422808973a55bde3317c2bb8a6cc9fe0d` | `e0f99e292b448b1bd7f60593c5ed932257b013a3` |
| 0007 | `0007_proposals.sql` | CRLF | `d85b60d49d5fff3097779a5e41c14ecef249be795dec00f2f92b0501e96257da` | `5225d1736e6fb004be3e11147599338accf74791` |
| 0008 | `0008_agent_transcript.sql` | CRLF | `a6cb10ac13d30c7e5ddc92d7bb234f827cf32108349f73cc5e09cca330cd893a` | `5d2745e7d82e28c4e9fc3d7ea13638d75dd98439` |
| 0009 | `0009_chat_threads.sql` | CRLF | `90d55e2c964f432c3d48444fc29e185ba75ffee088b1698ad9a52c6868cfcea8` | `8080f9d511fcbcf1e3ae8911377401f5542dc8d0` |
| 0010 | `0010_memory_brain.sql` | CRLF | `d8670a928886af28824f29123648d29e72a2bb0b0dac9c158c0741b72d5c1a97` | `ddec25029424ef32644782f061f2f8877e99c5c7` |
| 0011 | `0011_memory_source_proposal_uniq.sql` | CRLF | `e73544e73377fd4a88c6be656a8b798486d0f3e26678cb5fc6f3c0ec7ea1e664` | `11c5d58d063880449cb15a774b96207d62bbe5a5` |
| 0012 | `0012_proposals_reflected_at.sql` | CRLF | `d702cfa2b6d0baad7aa59b12ad2de14b4e0cdc52dee639b43bf601d4cc4c2917` | `ce5224eb4b91e7b630590608985cc764fbad305e` |
| 0013 | `0013_knowledge_base.sql` | CRLF | `11d6d1de67ce9511a76e3393e7be21534a16bc52f1a5bd1b5aaa2da6f740e2a6` | `00d87c48666e90099d37b19a8e6d8d7c264980eb` |
| 0014 | `0014_work_item_applied_from_proposal_partial.sql` | CRLF | `b4803d3d3b7d87fbc82cd46c99050749289aaf091874cb1d61b5e11dda3cebd7` | `e5fa5fda15614d9f397f0a64b0c9b51e27f918c1` |
| 0015 | `0015_meeting_promotions.sql` | CRLF | `793ba3d11c86a5476f54ddf6b59fb223ffa9ff8374d6112ecce508f43bb696e1` | `713d190228777d7630f4d24dd98afda69757bf34` |
| 0016 | `0016_memory_ownership_axis.sql` | CRLF | `3fca12b63918ba93a23e0e21d5a3fad69396f727b816dce193aca7c8d717e0f1` | `51919343d72e2a29b38d724646c1cd446403d7d4` |
| 0017 | `0017_proposal_target_snapshot.sql` | LF | `503f779a56bb4a8ee1124904109efd15e2221ceae6f8ebc7de92e13452d41c36` | `06e2cbf274766d37e322c85179bf8fa606c15316` |

## Scope and constraints

In scope: manifest schema/data, historical-artifact checker, parity validation, runner hash-to-tag resolution, unit/fixture tests, independent review, and a repeat read-only protected preflight.

Out of scope: editing any migration SQL or Git history; updating/deleting/inserting production journal rows; applying migrations; changing schema/data/roles; weakening exact-count/order/timestamp/hash, tenant, auth, or human gates; accepting per-file line-ending permutations; supporting any vector not proven above.

## Acceptance

1. The manifest records all 18 entries in this exact order with the stated byte variant, observed hash, blob OID, and source SHA.
2. Offline validation reproduces every hash from Git blob bytes and proves a single complete vector; mutations to any field, order, cardinality, source, or bytes fail closed.
3. The runner maps the exact production vector to tags `0000`-`0017` without changing LF canonical hashes used for new migrations, and unknown/mixed/partial/duplicate histories remain rejected.
4. Existing repaired-bootstrap behavior and production environment pinning remain green.
5. An independent reviewer confirms the mapping and no-write boundary.
6. Only after a fresh exact-main commit and explicit human approval, the protected read-only preflight returns recognized `original-production` history with count 18 and floor `0017`; no migration apply follows from this issue.

## Rollout and rollback

Land manifest/checker tests first, runner consumption second, then full DB-contract validation. The runtime change is validation-only until the separately approved preflight. Rollback is `git revert` of the reconciliation commits; because there are no SQL, journal, or database mutations, rollback requires no data operation. A failed protected preflight blocks all later migration work and the code is reverted or corrected through a new reviewed PR.

## STOP conditions

Stop immediately if any observed hash is missing, non-unique, not reproducible from its cited blob, out of order, or paired with an unverified tag/timestamp; if live count/floor differs from 18/`0017`; if the base or vector changes; if verification would require credentials outside the protected environment; if a solution requires SQL/history rewrite; or if independent review/human approval is absent. Ambiguity is Critical and fails closed.

## Security and ambiguity

No secrets or database URLs enter fixtures, logs, manifest, or evidence. The controller reads production credentials only inside the existing protected environment and runs verification, never PR code with elevated trust. Any design gap below 80% confidence stops for human decision; no implementation is authorized by this plan commit.
