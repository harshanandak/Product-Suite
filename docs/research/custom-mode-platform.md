# Custom Mode internal-application platform research

Date: 2026-08-07  
Forge issue: `13307553-549e-4377-81ef-d0a7856f59d5`  
Base: `origin/main` at `a88f97b397942561628c6b0f47dfff71c7af9342`  
Decision fed: [Custom Mode platform plan](../work/2026-08-07-custom-mode-platform/plan.md)

## Research question

How can Product-Suite let a person or agent build a governed internal application inside the
workspace without forcing the current MVP to implement a low-code platform, and which contracts
must today's blocks, database, permissions, and agent operations preserve so that later expansion
does not require a rewrite?

Workflow Automation is a separate product. It may consume declared Custom Mode events and invoke
declared actions, but it does not own app layout, blocks, data schemas, or app permissions.

## Verified current state

| Area | Current evidence | Consequence |
| --- | --- | --- |
| Platform database | `packages/db` uses Drizzle and `@neondatabase/serverless`; `createDb` creates a Neon HTTP client ([package](../../packages/db/package.json), [client](../../packages/db/src/index.ts)). | New Custom Mode authority belongs in the shared Neon Postgres schema. |
| Split legacy | `apps/roadmap-web` still has active Supabase auth, storage, realtime, and data clients. | Treat Supabase as a Roadmap compatibility boundary, not a new Custom Mode dependency. |
| Tenancy | The shared database already has `tenants`, `users`, `user_auth_identities`, and `organization_memberships`; platform queries derive tenant scope from the caller ([tenant resolver](../../apps/platform-api/src/auth/tenant-scope.ts)). | Reuse identity and tenancy; do not create Custom Mode users or workspaces. |
| Authorization | The shared resolver checks active membership but does not make the membership role a first-class capability input. Neon access uses a privileged server connection and application predicates rather than platform-table RLS. | Role-aware capability evaluation and structural tenant constraints are prerequisites for publishing apps. |
| Provenance | Workboard writes share human/agent/system/import attribution, authorizing-human, and run references ([schema](../../packages/db/src/schema.ts)). | Reuse provenance for app, schema, record, and release mutations. |
| Runs and proposals | `agent_runs` and tenant-scoped `proposals` already exist, but apply dispatch supports only current work-item and memory operations. | Add typed Custom Mode commands later; do not create a second agent or approval system. |
| Artifacts | A canonical Neon artifact/revision ledger is planned but is not on this base. Existing BlockSuite documents and Supabase resources are not a general platform artifact model. | `AppDefinition` should align with the artifact envelope, but the plan must not pretend that persistence already exists. |
| Canvas boundary | `packages/ui-canvas` abstracts document identity, bytes, metadata, and realtime connections without importing an editor. | Preserve this provider-neutral seam, but add a separate product-owned block contract. |
| Product shell | `BoardId` and active-board routing currently hardcode Home, Workboard, Meetings, and Canvas ([registry](../../apps/platform-web/src/shell/boards.ts)). | Custom apps need a runtime route and app-defined inner navigation; never add a route per block. |
| Blocks | No shared block registry, schema version, data binding, semantic command, permission, migration, fallback, export, or budget contract exists. | Current blocks are not yet safe building units for Custom Mode. |

## Options considered

### A. Embed or fork an existing low-code platform

Appsmith, Budibase, ToolJet, Directus, Retool, and similar systems demonstrate useful product
patterns, but embedding one would introduce a second identity, authorization, datasource,
deployment, billing, and extension authority. Licensing also varies across Apache-2.0, AGPL,
GPL, BSL, and source-available terms. This is rejected as the foundation.

### B. Treat an editor framework as the app platform

BlockSuite, AFFiNE, AppFlowy, TipTap, React Flow, Mermaid, and chart/PDF libraries solve parts of
editing or rendering. None supplies Product-Suite's app schema, governed records, permissions,
releases, semantic agent operations, or command authority. This is rejected as the platform
model. The selected document/canvas editor remains an adapter behind Product-Suite contracts.

### C. Product-owned declarative app platform

Own the normalized app definition, block manifest, schema lifecycle, capability evaluation,
draft/release history, and semantic operations. Reuse trusted Product-Suite blocks and renderers.
Add sandboxed executable extensions only after declarative limits are measured. This is selected.

## Patterns worth adopting

| Source | Adopt | Avoid |
| --- | --- | --- |
| [Notion blocks](https://developers.notion.com/reference/block) | Stable IDs, typed blocks, explicit API versions, capability-scoped integration. | UI/API gaps and unsupported blocks that disappear or become uneditable. |
| [Airtable Interfaces](https://support.airtable.com/docs/interface-designer-permissions) | Separate the underlying data from audience-specific interfaces and roles. | Making the interface itself the only portable representation. |
| [Appsmith](https://docs.appsmith.com/) | Git/import/export and rollback as projections of app state. | Embedding the full runtime and authority stack. |
| [Directus permissions](https://docs.directus.io/reference/system/permissions) | Resource, action, field, filter, validation, and preset concepts. | Depending on its source-available licensed server as our control plane. |
| [BlockSuite schema](https://blocksuite.io/guide/block-schema) | Versioned block schemas and explicit parent/child constraints. | Treating an editor's Yjs schema as app/data/permission authority. |
| [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview) | Portable sandboxed interactive previews in compatible agent hosts. | Using MCP Apps as canonical persistence or authorization. |
| [Workers for Platforms](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/how-workers-for-platforms-works/) | A later isolated runtime for explicitly permitted customer code. | Paying the runtime, rollout, egress, and security cost before code extensions are demanded. |

## Database findings

### Reuse

- Shared tenant, user, membership, team, project, provenance, run, and proposal identities.
- Drizzle schema and ordered SQL migration chain in `packages/db`.
- Real-Neon branch database-contract harness for applying the full chain and testing tenant
  isolation.
- Neon branches for isolated schema and destructive-query validation. Neon documents branches
  as isolated copy-on-write clones suitable for migration and query testing:
  <https://neon.com/docs/introduction/branching>.

### Do not reuse

- Roadmap Supabase tables as new platform authority.
- Editor/Yjs documents for operational records.
- One physical SQL table per user entity.
- Generic EAV field/value tables before analytics demand proves them necessary.
- Client-supplied tenant IDs or user-controlled SQL identifiers.

### Selected first storage shape

Use relational ownership/version columns plus bounded JSONB at the flexible boundary:

1. `custom_apps`: identity, tenant/team ownership, mutable draft definition, optimistic draft
   revision, and current published version.
2. `custom_app_versions`: immutable published snapshots, normalized definition, manifest lock,
   content hash, provenance, and release metadata.
3. `custom_records`: tenant/app/entity identity, schema version, bounded JSONB data, optimistic
   record version, provenance, archive state, and list indexes.

PostgreSQL recommends predictable JSON structures and warns that updating a JSON document locks
the whole row. Therefore the app draft is capped and treated as one reviewable unit, while
operational records are separate rows: <https://www.postgresql.org/docs/current/datatype-json.html>.
Start without a catch-all GIN index; add targeted expression or generated-column indexes only
for measured filters and sorts.

### Authorization finding

RLS can later add defense in depth, but it is not sufficient by declaration. PostgreSQL notes
that table owners normally bypass row policies and that enabling RLS without a policy produces
default deny: <https://www.postgresql.org/docs/current/ddl-rowsecurity.html>. The current Neon
HTTP service connection and application-scoped identity require a deliberate per-request database
identity design before RLS can become a reliable second guard.

## Block compatibility findings

Every persisted block needs, at minimum:

- immutable instance ID, workspace/app/page scope, namespaced kind, schema version, and revision;
- runtime-decoded props separated from data bindings and transient view state;
- deterministic migrations and lossless unknown-block preservation;
- named semantic commands with input schemas and required capabilities;
- server-enforced authorization for bound data and commands;
- structured loading, empty, invalid, unavailable, and permission-denied states;
- accessible name, reading order, keyboard/focus behavior, and live status announcements;
- deterministic text/JSON fallback and declared optional exporters;
- collaboration mode and conflict policy without putting permissions in Yjs;
- payload, node, row, attachment, and renderer-loading budgets.

React Flow, Mermaid, Recharts, PDF, and document editors remain renderers. Their runtime objects,
DOM output, generated HTML, and provider identifiers are never canonical block state.

## Agent editing findings

Raw JSON Patch, raw SQL, and raw Yjs updates are unsuitable public authoring contracts. Agents
need stable semantic operations with `expectedRevision`, idempotency, dry-run, normalized diff,
policy simulation, and explicit confirmation for destructive or privilege-expanding changes.

Minimum operation families:

```text
app.get / app.validate / app.diff
page.add / page.rename / page.move
block.add / block.configure / block.move / block.remove
entity.add / field.add / field.rename / relation.add
binding.set
permission.grant / permission.revoke / permission.simulate
release.preview / release.publish / release.rollback
```

External Codex, Claude Code, or other clients edit a file projection, but import always follows:

```text
parse -> normalize -> validate -> diff -> authorize -> draft -> preview -> publish
```

They never write production tables or published definitions directly.

## Known unknowns

- Whether simultaneous multi-user visual app building is valuable enough to justify CRDT state.
- Which custom field types and query operators are required by the first three real internal apps.
- Whether row/field policies need a small condition vocabulary in v1 or can begin with role and
  ownership presets.
- Which block engine wins the separate document/canvas acceptance spike.
- Whether executable customer code is ever necessary after trusted blocks and typed actions.

These unknowns do not block the compatibility contracts in the plan.
