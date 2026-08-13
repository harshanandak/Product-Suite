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

## Deferred deliberately

- Third-party executable modules, marketplace, and module migrations.
- Generic CRUD/runtime engines.
- Full mobile canvas and offline-first editing.
- Early infrastructure cutover or provider retirement.
