# Work-item provenance correction and detail module

**Status:** Proposed - implementation requires `gate.plan-approval`
**Classification:** Simple bug fix, explicitly planned at the user's request
**Forge issue:** `163c617a-2ec7-4ffc-8575-eea4085f8e4f`
**Base:** `95bccc436b45cc4710cb46029a12de13a5935389`

## Outcome

An accepted agent proposal must produce a work item whose source is honestly `agent`, while preserving the existing proposal, actor, authorizing-human, and run attribution. The work-item detail screen must show a compact, tenant-safe provenance module with a working link to the applied proposal, run context when it still exists, and the approving human when resolvable.

## Success criteria

1. Agent-proposal creates and updates persist `source = 'agent'`; ordinary human creates remain `manual`, and meeting-created items remain `meeting`.
2. The existing `work_items.applied_from_proposal_id`, `actor_type`, `actor_id`, `on_behalf_of`, and `run_id` fields remain the work-item authority. Existing proposal `decided_by`/`decided_at` and `agent_runs` records supply optional review/run context. No migration or new table is added.
3. `GET /api/work-items` returns an optional provenance read model without exposing a proposal, run, or user from another tenant.
4. The detail screen shows the source plus, when available, the applied proposal link, agent/run context, approver, and approval time. Missing legacy references or deleted actors/runs render explicit unavailable/ID fallbacks and never crash.
5. Tests prove agent create/update, manual preservation, tenant isolation, legacy nulls, and deleted actor/run behavior; the live agent-proposal E2E proves persisted and rendered provenance.

## Scope boundaries

In scope:

- Correct source stamping only on the existing accepted-agent-proposal write path.
- Additive optional fields on the existing shared `WorkItem` read contract.
- Tenant-scoped joins in the existing work-items API list read.
- A small provenance block in `WorkItemDetailScreen` and focused tests.
- Reuse and extend the current `moat-loop.spec.ts` DB probe.
- Preserve the meeting-origin path by publishing each meeting proposal and its `meeting_promotions` ledger row atomically in the existing transaction.

Out of scope:

- Schema or migration changes.
- Collaboration schema, event bus, workflow automation, workboard redesign, unrelated meeting behavior, canvas work, or dependency changes.
- A new proposal/run/approval authority, service, endpoint, or activity-event type.
- Backfilling historical rows or relabeling meeting/manual records by inference.

## Existing authority and data flow

```text
accepted proposal
  -> proposals.applyProposal
  -> existing createWorkItem/updateWorkItem command
  -> work_items.source + actor_type/actor_id/on_behalf_of/run_id
  -> optional applied_from_proposal_id
  -> tenant-scoped GET /api/work-items projection
  -> WorkItemDetailScreen provenance module
  -> /w/:workspace/inbox?proposal=:id (existing any-status lookup)
```

The apply path already constructs an agent `ActorContext` from `proposal.run_id` and the approver and passes it through the domain command. `recordWrite` already stamps the four provenance columns. The defect is limited to `source`: create defaults it to `manual`, and update does not set it. The list route currently selects only display fields and drops all durable provenance fields.

## Design

### 1. Correct source at the server command boundary

- Proposal application explicitly supplies the trusted provenance source `agent`; it must not accept source authority from an HTTP payload.
- Create passes `source: 'agent'` into the existing create command.
- Update adds a narrow server-only context override (for example, `provenanceSource`) to `updateWorkItem`; the SQL writes that value when present and otherwise preserves `current.source`. `WorkItemPatch` continues to exclude `source`, so human/client updates cannot spoof provenance.
- Existing actor/run/on-behalf-of stamping and proposal exactly-once behavior remain unchanged.

### 2. Add an optional tenant-safe read projection

Add an optional `provenance` object to the shared `WorkItem` contract. It is read-only and contains only the fields the detail UI needs: applied proposal id, proposal availability, actor type/id, authorizing-human id, run id/summary, approver id/name, and approval time. All nullable historical relationships stay nullable. `proposal_available` is derived from the tenant-scoped proposal join, while the durable proposal id remains available for audit fallback.

The existing work-items list query remains the sole read request. It selects the work item's stored provenance and uses `LEFT JOIN`s constrained by the work item's tenant:

- proposal: `p.id = wi.applied_from_proposal_id AND p.tenant_id = wi.tenant_id`;
- run: `ar.id = wi.run_id AND ar.tenant_id = wi.tenant_id`;
- approver display: resolve `p.decided_by` only through a membership for `wi.tenant_id` (membership may be inactive so former members remain attributable).

The projection is present when the work item carries meaningful stored provenance. Missing joined rows produce partial data rather than suppressing the durable IDs. A cross-tenant or dangling reference is treated as unavailable, never followed.

### 3. Render a compact provenance module

Keep the existing Source property and add a compact Provenance section to the Overview tab only when `row.provenance` is present. It uses the existing workspace route and proposal search parameter for `Review in Inbox`; the Inbox already fetches one proposal in any status through `GET /api/proposals/:id`, so applied links remain valid.

Rendering rules:

- proposal id present and tenant-scoped proposal available: link to `/w/$workspace/inbox?proposal=<id>`;
- proposal id present but unavailable: show the durable short id without a link;
- run present: show summary when available and a short stable id fallback otherwise;
- approver present: show tenant-resolved name, otherwise a short stable id;
- referenced user/run deleted or tenant-invalid: show `Unavailable` without a link or fabricated name;
- legacy/manual item with no stored provenance: retain the Source row and omit the module.

### 4. E2E decision

Do not port or cherry-pick the preserved `meeting-e2e` staged patch. Its `db-provenance.e2e.ts` change only rewrites comments, its README edit is meeting-specific, and its `.forge/config.yaml` edit removes unrelated merge configuration. None proves this defect.

The useful mechanism already exists unchanged on this branch: `readWorkItemAppliedFrom` plus `moat-loop.spec.ts`. Extend that current helper to read the work item's source/actor/run/proposal decision fields and extend the live agent-create flow to open the work-item detail and assert the new module and proposal link. This supersedes the staged patch without modifying or unstaging the preserved worktree.

## Edge cases and failure behavior

- **Manual work item:** no proposal provenance module; source remains manual through ordinary edits.
- **Meeting item:** meeting source remains meeting; this change does not reinterpret its proposal actor.
- **Legacy applied item:** nullable proposal/run/actor fields render partial provenance or `Unavailable`; no backfill.
- **Deleted run:** `work_items.run_id` may be null because the FK is `ON DELETE SET NULL`; proposal/work-item IDs remain visible and the UI says run unavailable.
- **Deleted or former approver:** resolve only through the item's tenant; fall back to the stable stored id or `Unavailable`.
- **Cross-tenant corrupted reference:** joins do not resolve it, no foreign label/summary leaks, and the stored local IDs can be shown only as unavailable identifiers.
- **Agent update:** corrects source and current actor/run attribution but does not invent `applied_from_proposal_id`, which is the create-idempotency pointer by existing schema design.
- **Missing proposal:** retain work-item actor/run facts; omit the Inbox link and approval facts.

## Security and architecture checks

- OWASP A01: bind tenant scope on every proposal/run/user relationship; request payload never supplies tenant or provenance authority.
- OWASP A04: fail closed on dangling or cross-tenant relationships and use explicit partial states.
- OWASP A09: source labels and attribution must reflect the actual command actor; no invented human/agent identity.
- Preserve architecture contracts `data.neon.v1`, `auth.capability.v1`, `command.v1`, and `run.v1`: one Neon authority, server authorization, one validated command path, and provider-neutral run identity.
- DRY: reuse the existing WorkItem contract/repository seam, proposal any-status deep link, actor columns, and E2E DB helper.
- KISS/YAGNI: no schema, backfill, new endpoint, event type, component library, or external dependency.

## Verification plan

Implementation must show RED, GREEN, and REFACTOR evidence for each task in `tasks.md`. Focused gates:

```powershell
bun test apps/platform-api/src/proposals/apply.test.ts apps/platform-api/src/domain/work-items.test.ts
bun run --cwd apps/platform-api test -- src/meeting/ingest.test.ts
bun test apps/platform-api/src/routes/work-items.test.ts packages/contracts/src/work-items.test.ts
bun test apps/platform-web/src/boards/workboard/detail/WorkItemDetailScreen.test.tsx
bun run --cwd apps/platform-web typecheck
```

Run the live `moat-loop.spec.ts` only when its documented Clerk, application, OpenRouter, and optional `DATABASE_URL` prerequisites are available; missing DB evidence is INCOMPLETE, not PASS. `/validate` owns the full affected-suite and lint/type gates after implementation approval.

## Approval checkpoint

This plan stops at `gate.plan-approval`. Approval authorizes only the implementation tasks below; it does not authorize push, PR, merge, schema work, or any excluded platform redesign.
