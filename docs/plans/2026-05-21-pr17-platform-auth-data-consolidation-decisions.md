# PR17 Platform Auth And Data Consolidation Decisions

Feature: `pr17-platform-auth-data-consolidation`
Beads: `product-suite-do6`
Date: 2026-05-21
Status: active

## Decisions

- Use one public Product Suite domain and platform shell for Meeting, Roadmap, Canvas, Agents, and Settings.
- Use Clerk as the canonical user-facing auth, organization, invitation, and account-management provider.
- Use one Supabase Postgres project as the physical platform database while keeping logical module ownership by schema/table group.
- Treat the current empty user/project data state as an assumption that every cutover PR must verify with row-count evidence before destructive changes.
- Keep internal platform user/workspace IDs separate from Clerk IDs so domain services are not coupled directly to provider identifiers.
- Require PR19 to define the exact Clerk JWT/RLS claim contract, Supabase exposed-schema policy, migration owner, generated-type drift gate, and Alembic retirement path before Meeting cutover.
- Require PR21 to generate a route ownership matrix and auth redirect contract before moving Meeting and Roadmap into the single shell.
- Move event identity and core conversion telemetry contracts earlier than PR23 so product experiments can be measured during shell rollout.

## Open Decisions For Follow-Up PRs

- Whether Roadmap tables remain in `public` through launch or move into a `roadmap` schema before launch.
- Whether Meeting API keeps Alembic as read-only history after cutover or fully moves to Supabase SQL migrations.
- Whether browser modules use Clerk-authenticated Supabase clients at launch or go through backend APIs until RLS coverage is proven.
- Which module becomes the default landing page after login.
