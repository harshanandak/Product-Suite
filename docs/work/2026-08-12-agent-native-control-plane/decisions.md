# Agent-native control plane decisions

## Locked

1. One public Platform API; web, agents, and modules are clients.
2. API and domain commands, never DOM automation, are the mutation authority.
3. Canonical roles are exactly `viewer/member/admin/owner`; no legacy aliases because
   there is no production data.
4. Capability context ships before the generalized command kernel.
5. Initial command verticals are work-item create/update and proposal apply.
6. Modules are first-party, manifest-only, and non-executable for MVP.
7. Command UX precedes module expansion so permissions and approvals are a product
   experience, not backend plumbing.
8. Meeting delivery remains behind its separate human Neon gate.
9. Cloudflare cutover and legacy retirement follow product parity and rollback proof.
10. One autonomous owner per medium PR; the orchestrator never co-leads the branch.
11. Pre-PR CodeRabbit CLI and batched feedback replace repeated reviewer cycles.
12. The requested 10-minute exact-head stable-green window remains the merge handoff
    rule.
13. CP1 is one medium PR with one owner and four sequential tasks (4-7).
14. CP1 owns canonical migration `0021`; it preserves and advances the exact
    `0018`/`0019`/`0020` topology, harness, evidence, and readiness contracts without
    production apply, compatibility, or backfill work.
15. `work-item.create` and `work-item.update` require server-derived CP0 `edit`, are
    non-sensitive for direct authenticated humans, reject client delegation, and are
    the only direct work-item command verticals.
16. Agent-proposed writes execute only through `proposal.apply`, whose command,
    capability, approval, snapshot, expected version, preview hash, tenant, actor,
    and proposing-agent provenance are derived and bound server-side from the stored
    accepted/approved proposal.
17. Cross-tenant is `404`; known insufficient capability is `403`; stale version,
    preview drift, and idempotency changed-input are `409`; same-input replay returns
    the original terminal result. Domain mutation, CAS, idempotency, and audit are one
    transaction using the existing domain command as mutation authority.

## Deferred deliberately

- Third-party executable modules, marketplace, and module migrations.
- Generic CRUD/runtime engines.
- Full mobile canvas and offline-first editing.
- Early infrastructure cutover or provider retirement.
