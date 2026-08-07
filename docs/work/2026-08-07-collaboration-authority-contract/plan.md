# Collaboration authority contract

## Feature

- Slug: `collaboration-authority-contract`
- Date: 2026-08-07
- Forge issue: `2086343b-db19-4b13-a50f-c5e36c213b20`
- Classification: Critical
- Status: planned; awaiting `gate.plan-approval`

## Purpose

Define one Product-Suite-owned collaboration authority for stable actors, conversations, memberships, and immutable conversation events. Chat, canvas, and meeting surfaces can later project the same ordered event stream without making a UI, realtime transport, RTC provider, agent run, proposal, approval, or schedule store canonical.

## Success criteria

1. `@product-suite/contracts` exposes one language-neutral `conversationContract` covering `Actor`, `Conversation`, `Membership`, `ConversationEvent`, typed owning-domain references, ACL roles, lifecycle states, event kinds, and cursor semantics; JS, JSON, and TypeScript declarations have a drift test.
2. Shared Postgres has additive, tenant-bound tables for the four entities. Product-Suite IDs are stable UUIDs; provider and owning-domain IDs are references, never primary identity.
3. Every read and write derives the caller actor server-side, verifies an active tenant and conversation membership, and denies unknown, disabled, removed, or cross-tenant actors without revealing resource existence.
4. Event append is immutable, strictly ordered by per-conversation `sequence`, and idempotent within a conversation. A duplicate key with the same semantic request returns the original event; reuse with different content returns a conflict.
5. Edits and deletes append events that target an earlier message event; replies use an explicit `reply_to_event_id`. No event row is updated or physically deleted.
6. Events carry typed references to owning-domain records such as `agent_run`, `proposal`, `approval`, `schedule`, `meeting`, `work_item`, or `canvas_document`; those domains retain their own lifecycle and payload authority.
7. Conformance tests cover duplicate delivery, concurrent ordering, reconnect from an exclusive sequence cursor, unauthorized reads/writes, actor disable/removal, edit/delete/reply validation, and reference round trips.
8. Existing platform `chat_threads` data has an additive, idempotent compatibility path. Existing route shapes can remain stable while their backing authority moves; roadmap, meeting, canvas, RTC, realtime, and vendor cutovers remain separate issues.

## Out of scope

- UI projections, workboard changes, omnipresent chat, canvas/BlockSuite integration, meeting connector work, RTC, presence transport, and realtime vendor selection.
- Moving agent-run transcripts, proposals, approvals, schedules, meeting records, work items, or canvas documents into collaboration tables.
- A generic event bus, broker, outbox, search index, reactions, attachments, retention policy, or notification system.
- Cross-database roadmap/meeting cutover. This plan defines the import/reference contract only; dependent projection lanes perform their own cutovers.
- Replacing the existing provenance columns across unrelated write tables.

## Constraints

- Extend the existing `packages/contracts/src/conversation.js`; do not create a second collaboration contract package.
- Shared Postgres and platform API are the authority. A transport adapter can deliver events but cannot assign identity, ordering, membership, or authorization.
- `tenant_id` is mandatory on every row and every repository predicate. Tenant membership alone does not grant conversation access.
- Actor identity is server-derived from verified human, agent-run, or service context. Request bodies cannot select `actor_id`.
- Human actor ownership points to the current internal `users.id`; it never stores a Clerk subject as canonical identity.
- Agent actors are stable identities distinct from `agent_runs.id`. An event can reference the run that caused it without turning the run into the actor.
- Migrations are additive and fail closed. The provisional migration name is `0018_collaboration_fabric.sql`; `/dev` must re-read the live journal and renumber before RED if another branch has occupied `0018`.
- No hook, test, lint, migration parity, authorization, or security bypass.

## Approach selected

### Selected: append-only collaboration authority plus current-state membership

Add four Drizzle-owned tables in shared Postgres:

| Entity | Authority and key invariants |
| --- | --- |
| `collaboration_actors` | UUID `id`; `tenant_id`; `kind` = `human | agent | service`; required `owning_domain` + `owning_id`; `disabled_at`; unique `(tenant_id, owning_domain, owning_id)`. Profile rendering stays with the owning domain. |
| `conversations` | UUID `id`; `tenant_id`; `title`; `status` = `active | archived`; optional typed `subject_ref`; `created_by_actor_id`; monotonic `next_sequence`; optional `legacy_source` + `legacy_id` with a tenant-scoped unique key. |
| `conversation_memberships` | UUID `id`; tenant-bound FKs to conversation and actor; `role` = `reader | writer | admin`; `status` = `active | removed`; author/timestamps; unique `(tenant_id, conversation_id, actor_id)`. This is the current ACL projection. |
| `conversation_events` | UUID `id`; tenant-bound conversation and author actor; `sequence`; `idempotency_key`; closed `kind`; JSON payload; optional `reply_to_event_id` and `target_event_id`; typed `references`; server timestamp. Unique `(tenant_id, conversation_id, sequence)` and `(tenant_id, conversation_id, idempotency_key)`. Rows are immutable. |

Use composite tenant keys/FKs in SQL so a row cannot connect entities from different tenants even if application code is wrong. The repository still includes `tenant_id` and active membership in every query because DB integrity is not authorization.

The append transaction performs, in order:

1. resolve the verified caller to one active stable actor in the requested tenant;
2. load an active conversation membership with sufficient role (`reader`, `writer`, or `admin` by operation);
3. look up `(tenant_id, conversation_id, idempotency_key)` and return it only when event kind, actor, targets, references, and JSONB payload equal the request; otherwise return `409`;
4. validate reply/target events belong to the same conversation and that the event kind permits the selected link;
5. atomically increment `conversations.next_sequence` and use the returned value;
6. insert the immutable event and commit.

Postgres row updates serialize sequence allocation; a losing idempotency race rolls back its sequence update. Reconnect reads use `sequence > after_sequence ORDER BY sequence ASC`, never timestamps. CloudEvents is prior art for stable event identity and typed source/subject/data, but the implementation does not add its SDK or transport envelope.

### Rejected alternatives

1. **Promote an existing `chat_threads` store as canonical.** Rejected: roadmap Supabase, platform Neon, and meeting each use incompatible thread/message semantics and IDs. Picking one preserves the split and couples authority to a projection.
2. **Fully event-source membership and conversation metadata.** Rejected for v1: reconstructing ACL before every authorization check adds risk and latency. Current-state rows plus an immutable audit event for each membership change are smaller and fail closed.
3. **Adopt a broker/realtime vendor as the event authority.** Rejected: delivery infrastructure cannot own durable Product-Suite identity, ACL, ordering, or idempotency.

## Edge cases and required behavior

- No internal user mapping, no actor row, disabled actor, inactive tenant membership, removed conversation membership, ambiguous tenant, or foreign ID: deny. Reads return `404` for foreign/unknown resources; malformed input returns `400`; insufficient role returns `403` only after the caller is known to be a member.
- Duplicate delivery: same key and same semantic request returns the original ID and sequence. Same key with changed content, target, author context, or references returns `409`.
- Concurrent appends: committed events receive unique increasing sequences. Consumers may see a prefix and resume after the last sequence; they never sort by `created_at`.
- Edit/delete: target must be a non-deleted `message.created` or its latest edit in the same conversation. Deleting appends a tombstone; repeated delete with a new key is a conflict. History remains auditable.
- Reply/threading: `reply_to_event_id` must resolve to a message event in the same conversation. No cross-conversation links.
- Actor lifecycle: disabling an actor immediately blocks new reads/writes; prior authorship remains intact. Removing membership blocks access but preserves events.
- Owning reference deletion: collaboration keeps the opaque reference and renders it unresolved; it does not cascade-delete events or recreate owning-domain state.
- Archived conversation: readable by active members, but only an admin can unarchive; ordinary event appends are denied while archived.
- Payloads and references have bounded sizes; secrets, raw auth tokens, and vendor transport payloads are rejected from event data.

## Migration and compatibility strategy

1. **Contract first.** Land the extended contract and fixtures before schema/API work so all later tests share one vocabulary.
2. **Additive schema.** Create the four tables and nullable `agent_runs.conversation_id`; keep `chat_threads` and `agent_runs.thread_id` unchanged. No rename, drop, or cross-database operation.
3. **Idempotent platform backfill.** For platform Neon `chat_threads`, reuse each UUID as `conversations.id`, stamp `legacy_source='platform.chat_threads'`, and derive human actor/membership rows from distinct linked `agent_runs.triggered_by`. Convert only version-1 transcript deltas into ordered events using deterministic keys `legacy:agent_run:<run_id>:message:<message_id-or-index>` and an `agent_run` reference. Unknown actors create no permissive membership; such rows remain inaccessible until reconciled.
4. **Shadow verification.** Compare thread counts, reconstructed message counts/order, tenant boundaries, and run references. The backfill is repeatable and supports dry-run; mismatches stop cutover.
5. **Stable API compatibility.** Add `/api/conversations` as the canonical surface. The existing `/api/agent/threads` route may delegate to it while preserving its response contract, and agent chat links new runs through `conversation_id`. Do not delete legacy data in this issue.
6. **Later projection cutovers.** Roadmap and meeting importers submit their existing source IDs as legacy references and receive Product-Suite UUIDs. Their UI/vendor lanes switch reads only after their own parity gate. Legacy stores become read-only and are removed only in separately approved migrations.

## Technical research

### Existing code to extend

- `packages/contracts/src/conversation.js:1` and `packages/contracts/contracts/conversation.json:1` already define the shared conversation key map; extend them and their drift test rather than adding a parallel contract.
- `packages/db/src/schema.ts:18-40` defines shared Neon, internal user mapping, and mandatory tenant scoping. `packages/db/src/schema.ts:86-149` defines the current platform `chat_threads`/`agent_runs` compatibility seam.
- `apps/platform-api/src/auth/tenant-scope.ts:5-42` is the fail-closed Clerk-to-internal-user/tenant resolver to reuse.
- `apps/platform-api/src/agent/threads-repository.ts:112-184` demonstrates tenant-scoped repository reads and foreign-ID invisibility; its history currently derives from run transcripts and is the cutover seam.
- `apps/platform-api/src/routes/agent-threads.ts:9-83` and `apps/platform-api/src/app.ts:22-52` show the Hono route/auth registration pattern.
- `packages/db/src/schema.test.ts:1-223` and `packages/contracts/src/work-items.test.ts:1-140` show migration assertions and independent JS/JSON/TypeScript drift guards.
- `docs/architecture/schema-domain-ownership.md:10-19,65-78` records the current split authorities; `docs/design/2026-07-12-actor-provenance-design.md:20-80` requires server-derived actor scope and preserves run authority.

### Primary-source findings

- OWASP recommends least privilege, deny by default, permission validation on every request, non-guessable/inaccessible IDs, safe failure, logging, and dedicated authorization tests. The plan applies that at both tenant and conversation membership boundaries: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- PostgreSQL row locks/updates serialize conflicting writers until transaction end, which supports a single per-conversation sequence allocator without a new distributed lock: https://www.postgresql.org/docs/17/explicit-locking.html
- CloudEvents requires stable event identity and treats retransmission with the same source/id as a duplicate; it also separates context attributes from event data. This is used as envelope prior art only: https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md

### OWASP Top 10 pass

| Category | Applies | Planned mitigation |
| --- | --- | --- |
| A01 Broken Access Control | Yes | Server-derived actor; active tenant + actor + conversation membership on every request; role matrix; composite tenant keys; foreign IDs hidden; negative conformance tests. |
| A02 Cryptographic Failures | Limited | No tokens/secrets in payloads; HTTPS/auth middleware remain required; references are IDs, not credentials. |
| A03 Injection | Yes | Parameterized SQL only; closed event kinds/roles; Zod request validation; no client-provided SQL/order fields. |
| A04 Insecure Design | Yes | Deny-first ACL, immutable audit events, bounded payloads, idempotency conflict behavior, owning-domain authority boundaries. |
| A05 Security Misconfiguration | Yes | No public/browser direct table access; platform API is the write path; migration asserts constraints and indexes. |
| A06 Vulnerable Components | No new exposure | Add no dependency; use installed Hono, Zod, Drizzle, Vitest, and PostgreSQL primitives. |
| A07 Identification/Auth Failures | Yes | Reuse Clerk verification and internal user mapping; agent/service actor comes only from verified server context; disabled actors fail closed. |
| A08 Data/Software Integrity | Yes | Immutable events, unique idempotency keys, target validation, deterministic backfill keys, drift/conformance fixtures. |
| A09 Logging/Monitoring | Yes | Record stable actor/event/reference IDs and denied operation codes; never log payload bodies, tokens, or secrets. |
| A10 SSRF | No direct path | Collaboration accepts opaque references, not fetchable URLs; no server-side fetch is added. |

## TDD scenarios

1. Contract drift: change any actor/event field or enum in JS without matching JSON and TypeScript; the contract test fails.
2. Tenant/ACL failure: a valid tenant member without active conversation membership cannot read or append; a foreign conversation returns `404`; disabled/removed actors remain denied.
3. Idempotency: two identical deliveries produce one event and the same sequence; changed payload with the same key returns `409`.
4. Ordering/reconnect: concurrent appends yield distinct increasing sequences; `after_sequence=N` returns only `N+1...` in ascending order.
5. Edit/delete/reply: valid same-conversation targets append new events; cross-conversation, missing, already-deleted, or wrong-kind targets fail without mutation.
6. Owning references: run/proposal/approval/schedule IDs round-trip unchanged and deleting the owning record does not delete the conversation event.
7. Backfill: dry-run and two applied runs produce identical counts/IDs; a v0 transcript is skipped, v1 deltas preserve deterministic order, and unresolved users receive no access.

## Ambiguity policy

Use the `/dev` seven-dimension decision rubric. At or above 80% confidence, take the conservative choice and record it in `decisions.md`. Below 80%, stop and ask. Any ambiguity involving tenant isolation, actor derivation, event immutability, idempotency, data migration, or owning-domain authority is automatically blocking regardless of score.
