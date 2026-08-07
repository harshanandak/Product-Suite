# Collaboration authority contract - decisions

## D1 - Extend the existing conversation contract

`packages/contracts/src/conversation.js` and its JSON/type exports are the shared seam. Extend them instead of creating a new package or competing `collaborationContract`.

## D2 - Stable actors are not runs or provider users

An Actor has a Product-Suite UUID and a tenant-scoped owning reference. A human points to internal `users.id`, never Clerk `sub`. An agent has a stable actor ID distinct from each `agent_runs.id`; events link the run as an owning-domain reference. Services use explicit service actors rather than nullable/system fallbacks.

## D3 - Membership is current ACL state; events are immutable history

Authorization reads one current membership row. Each membership change also appends an audit event, but v1 does not reconstruct ACL from the event log. This keeps the security path direct and fail closed.

## D4 - Sequence is authoritative; timestamps are descriptive

Each conversation allocates sequence numbers transactionally from its own row. Cursor reads use `sequence > after_sequence ORDER BY sequence`. `created_at` never resolves ordering or duplicate delivery.

## D5 - Idempotency is scoped and semantic

The key is unique within a tenant conversation. An exact semantic retry returns the existing event. Reusing the key with different kind, actor context, target, reply, references, or JSONB payload returns `409`; no request hash helper or dependency is needed.

## D6 - Edit, delete, and reply are links, not row mutation

Edits/deletes append an event with `target_event_id`; replies use `reply_to_event_id`. Targets must belong to the same conversation and permitted event kind. Delete is a tombstone; event rows are never updated or removed.

## D7 - Owning domains keep lifecycle authority

Conversation events store typed opaque references and display unresolved links safely. Agent runs, proposals, approvals, schedules, meetings, work items, and canvas documents keep their own state and payloads; no collaboration cascade can delete or recreate them.

## D8 - Compatibility is additive and staged

Keep existing `chat_threads`, `agent_runs.thread_id`, route shapes, and run transcripts during migration. Backfill platform Neon first with deterministic keys and parity checks. Roadmap/meeting/canvas/vendor cutovers and legacy deletion require separate approved lanes.

## D9 - No broker or CloudEvents dependency

CloudEvents informs stable event identity and a metadata/data split, but Product-Suite needs conversation sequence, membership ACL, edits, and domain references that the generic spec does not provide. Use the shape as prior art; add no SDK, broker, or transport authority.

## D10 - PLAN exits at human approval

This branch contains design and TDD artifacts only. Production code, migrations, UI projections, vendor integration, merge, and `gate.plan-approval` mutation are explicitly deferred to authorized later stages.
