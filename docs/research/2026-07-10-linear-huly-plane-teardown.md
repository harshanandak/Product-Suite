# Architecture & Logic Teardown — Linear, Huly, Plane, AppFlowy, Teable, NocoDB, Focalboard, OpenProject, Vikunja, Operately

**Date:** 2026-07-10
**Audience:** team building on Hono + Cloudflare Workers, Neon Postgres, Clerk, React 19 / Vite / TanStack SPA.
**Method:** public engineering blogs, talks, docs, README/architecture files and API docs only. No source code was read, copied or paraphrased line-by-line (Plane, AppFlowy and Vikunja are AGPL; Huly is EPL-2.0). AI-generated code wikis (DeepWiki, readmex) were deliberately excluded as sources. Every claim below carries a URL; everything that could not be sourced is quarantined in the final section.

> **Provenance note (2026-07-10):** this file was lost to a cross-session `git clean` and restored from the research agent's original output. Content unchanged apart from this note and the correction in §D.

---

## A. Linear

Primary source: a reverse-engineering study of the Linear Sync Engine (LSE), publicly endorsed by Linear's CTO as *"a pretty awesome (and correct) write-up of our sync engine … probably the best documentation that exists — internally or externally"* ([wzhudev/reverse-linear-sync-engine](https://github.com/wzhudev/reverse-linear-sync-engine)), plus Tuomas Artman's own talks ([Scaling the Linear Sync Engine](https://linear.app/now/scaling-the-linear-sync-engine), [Local-First Conf talk](https://www.youtube.com/watch?v=VLgmjzERT08)).

### A1. The sync engine architecture

Three layers, not one:

1. **Object Pool (in-memory).** Domain entities — `Issue`, `Team`, `Organization`, `Comment` — are *models* with properties and references to other models. Hydrated models live in an Object Pool, "a large map for retrieving models by their **UUIDs**," implemented as a `modelLookup` map on the `SyncClient`. Properties are made observable via **MobX** (`makeObservable`, `@Computed`, `@Action`), so React views re-render automatically on mutation. ([README, Introduction & Ch. 1–2](https://github.com/wzhudev/reverse-linear-sync-engine))
2. **IndexedDB (local durable store).** Two databases: `linear_databases` (metadata about other DBs) and `linear_database_<id>` per workspace, holding models, metadata and a `__transactions` table. ([Ch. 2 takeaway](https://github.com/wzhudev/reverse-linear-sync-engine))
3. **Server + WebSocket delta stream.** Mutations become *transactions* sent to the server, executed there, then rebroadcast to all clients as **delta packets**. ([Introduction](https://github.com/wzhudev/reverse-linear-sync-engine))

The linchpin is the **sync ID**: "the global version number of the database. It helps determine whether the client is up to date." On WebSocket handshake the server returns `{ lastSyncId, lastSequentialSyncId, databaseVersion, userSyncGroups }`; the client compares the server's `lastSyncId` with its own and, on divergence, requests the missing delta packets and applies them. ([Ch. 4](https://github.com/wzhudev/reverse-linear-sync-engine)) The delta endpoint takes `lastSyncId`/`toSyncId` bounds.

### A2. Optimistic updates & conflict resolution

**Server-authoritative, last-writer-wins, with client-side rebase — not CRDT.**

A `TransactionQueue` manages four arrays. New transactions land in `createdTransactions`; a microtask scheduler (`commitCreatedTransactions`) flushes them into `queuedTransactions` and stamps a shared `batchIndex`, so **transactions created in the same event loop batch together**. On enqueue they are persisted to the `__transactions` table, "so if the client closes before these transactions are sent to the server, it can reload them from this table and resend them." Mutations go out as GraphQL. ([Ch. 3](https://github.com/wzhudev/reverse-linear-sync-engine))

When an inbound delta packet conflicts with an in-flight local transaction, LSE calls `rebaseTransactions`: each pending `UpdateTransaction` has its `original` value reset to the server's value and the in-memory model is re-derived — "Following the **last-writer-wins** principle… It is similar to Operational Transformation (OT)." A `completedButUnsyncedTransactions` queue holds transactions whose `syncIdNeededForCompletion` has not yet arrived; they are retired once the delta's `lastSyncId` passes them. ([Ch. 4](https://github.com/wzhudev/reverse-linear-sync-engine))

### A3. Sub-100ms interactions

Because **every read is a local read**: the UI queries the in-memory Object Pool, never the network. Boot picks one of three **bootstrap modes** — `full` (fetch all models from server), `local` (load from IndexedDB, then catch up via deltas), `partial` (fetch a subset). Full bootstrap fires only when no stores are ready, `lastSyncId` is undefined, or models are outdated. ([Ch. 2](https://github.com/wzhudev/reverse-linear-sync-engine))

What is *not* eagerly loaded is governed by a per-model **`loadStrategy`**: only `instant` models hydrate at boot; others hydrate lazily, "meaning its properties can be loaded only when accessed." Lazy loads are served from IndexedDB when possible, otherwise a partial bootstrap: `GET /sync/bootstrap?type=partial&onlyModels=Issue,Attachment&syncGroups=…&firstSyncId=…`. Which models can be fetched cheaply is decided by **partial indexes** plus `coveringPartialIndexValues`, which tell the client whether a given reference collection was already fetched. **Sync groups** scope which deltas a user receives. ([Ch. 2, Ch. 4](https://github.com/wzhudev/reverse-linear-sync-engine))

### A4. ID scheme

Two IDs per issue. Internally, models are keyed by **UUID** in the Object Pool. ([Introduction](https://github.com/wzhudev/reverse-linear-sync-engine)) Externally, the human identifier is `<team identifier>-<number>` (e.g. `ENG-123`); the team identifier is a per-team setting. ([Linear docs, Teams](https://linear.app/docs/teams)) The structural reason it works: **"Issues are tied to teams"** and the team is the numbering scope. ([ibid.](https://linear.app/docs/teams))

Design lesson: the UUID is what the sync engine moves; the human ID is a projection. A UUID minted client-side is what makes offline creation and rebase possible at all.

### A5. Workflow states

Statuses are **team-specific**, ordered, and slotted into **fixed categories** — Backlog, Unstarted, Started, Completed, Canceled, plus reserved *Duplicate* and *Triage*. "Teams can reorder statuses within each status category, but the categories themselves stay in a fixed order," and a team must always retain at least one status per category. Duplicate is system-managed and cannot be renamed. Each team has a **default status** for new issues. ([Linear docs, Issue status](https://linear.app/docs/configuring-workflows))

This is the important modelling decision: **customisable status names over a closed set of semantic categories.** Every rollup, burndown and automation reads the category, never the name.

---

## B. Huly

### B1. The transactor

Huly is **30+ microservices**. The **transactor** (port 3332) is "the core transaction processing engine. Maintains WebSocket connections for real-time updates, processes all data mutations, enforces business logic, and publishes events to the message queue." ([platform/ARCHITECTURE_OVERVIEW.md](https://github.com/hcengineering/platform/blob/develop/ARCHITECTURE_OVERVIEW.md))

*Why it exists*: it centralises the write path. Every mutation is funnelled through one stateful, socket-holding service that can enforce invariants and fan out events. Other services are consumers, not writers.

### B2. Storage

**CockroachDB** is the primary application database, holding "ALL business data including users, workspaces, documents, transactions, and metadata," with MinIO/`datalake` for blobs and Elasticsearch (via the `fulltext` service) for search. Events flow asynchronously Transactor/Workspace → **Redpanda** (Kafka) → consumers. ([ARCHITECTURE_OVERVIEW.md](https://github.com/hcengineering/platform/blob/develop/ARCHITECTURE_OVERVIEW.md); [hulygun](https://github.com/hcengineering/hulygun) is the Kafka→transactor router.) Collaborative rich-text is *not* handled by the transactor: the **collaborator** service (port 3078) does "real-time document collaboration using Y.js CRDT." ([ibid.](https://github.com/hcengineering/platform/blob/develop/ARCHITECTURE_OVERVIEW.md))

So: **transactions for domain objects, CRDT only for prose.** That split is the reusable insight.

### B3. Model / plugin architecture

Documents are addressed by `_class` (and "results will include all subclasses of the target class"), written with `createDoc(class, space, attrs)`, and extended by **mixins** — `createMixin` / `updateMixin` take `{ objectId, objectClass, objectSpace, mixin, attributes }`. ([api-client README](https://github.com/hcengineering/huly.core/blob/main/packages/api-client/README.md)) A `Space` is the containment/permission unit. Plugins declare classes and attach mixins to *existing* classes — that is how a module adds fields to `Issue` without owning `Issue`.

---

## C. Plane

### C1. Data model

`Workspace` → `Project` → work items, with cycles, modules and pages inside the project. "At the top level, workspaces contain everything… Inside workspaces, you create projects… Within projects, you manage work items." ([Core concepts](https://docs.plane.so/introduction/core-concepts))

Both Cycles and Modules are **optional, per-project feature toggles**: "By default, Modules are turned on for all new projects. If you need to turn them on or off later, head to Project settings and toggle the Modules feature" ([Modules](https://docs.plane.so/core-concepts/modules)); same for Cycles via Settings → Features ([Cycles](https://docs.plane.so/core-concepts/cycles)).

### C2. Module vs Cycle — why both

They are **orthogonal axes**, one by *scope*, one by *time*.

- **Cycle = time.** "A set period of time where your team focuses on completing specific tasks… similar to sprints in Agile." Cycles have start/due dates; **by default two cycles cannot have overlapping dates**, and only one cycle is Active at a time unless Parallel Cycles is enabled. States are derived from dates: Active / Upcoming / Completed. ([Cycles](https://docs.plane.so/core-concepts/cycles))
- **Module = scope.** "Smaller, focused projects… track progress on a new feature, a milestone like a marketing campaign, or discrete pieces of your software architecture such as a microservice." Modules carry an **explicit lifecycle state** — Backlog, Planned, In Progress, Paused, Completed, Cancelled — a lead, members, and optional dates. ([Modules](https://docs.plane.so/core-concepts/modules))

The cardinality differs and this is the tell: **a work item can belong to many Modules simultaneously** ("a work item can belong to both a Feature module and a Release module simultaneously") but has *one* Cycle, linked "as a property within any work item." ([Modules](https://docs.plane.so/core-concepts/modules); [Cycles](https://docs.plane.so/core-concepts/cycles)) Cycle is a scalar FK on the issue; Module is a join table.

### C3. Self-host architecture

Deployed as Docker Compose or Kubernetes/Helm ([Self-hosting overview](https://developers.plane.so/self-hosting/overview)). The stateful dependencies are documented explicitly and all three are externalisable: **PostgreSQL**, **Redis**, and **S3-compatible object storage** (default MinIO, with presigned uploads requiring `s3:GetObject` / `s3:PutObject` and a CORS policy). ([Configure external services](https://developers.plane.so/self-hosting/govern/database-and-storage)) Minimum footprint: 2 cores / 4 GB RAM, 8 GB recommended. ([Docker Compose](https://developers.plane.so/self-hosting/methods/docker-compose))

---

## E. AppFlowy

**Field types as a two-part model.** A cell is addressed by `(row_id, field_id)` and stores **opaque raw data**; the `Field` carries a `field_ty` and a **`TypeOption`** which formats it. Reading a cell means: resolve Database → Field → TypeOption (e.g. `DateTypeOption`) → Row → Cell → format. The same raw bytes render differently under different `DateFormat`/`TimeFormat`. ([Database View](https://docs.appflowy.io/docs/documentation/software-contributions/architecture/frontend/database-view))

**Views.** "AppFlowy has three types of views that share the same database. A single database can have multiple views and these views can be converted to each other" — Grid, Board, Calendar "share the same data structs defined in the backend." ([ibid.](https://docs.appflowy.io/docs/documentation/software-contributions/architecture/frontend/database-view)) The split that matters: **fields and rows are shared; layout settings, filters and sorts are per-view.**

**Sync.** AppFlowy Cloud depends on **GoTrue** (auth), **Postgres**, **Redis**, and **MinIO**. ([AppFlowy Cloud Architecture](https://docs.appflowy.io/docs/documentation/appflowy-cloud/architecture)) Collaborative objects are built on the **`collab` crate wrapping `yrs`** (the Rust Yjs port) — documents are a block tree inside a YDoc. ([AppFlowy-Collab](https://github.com/AppFlowy-IO/AppFlowy-Collab))

Concept to take: **`TypeOption` is a per-field-type config blob**, not a column type. Adding a field type never changes the row's storage shape.

## F. Teable

The design bet: **"every table that seems simple on Teable is actually a real database table,"** and "the table structure created in Teable will be completely consistent with the structure in the database, so you can use any standard database tool for data migration and easily query data through SQL statements." ([Postgres-Airtable Fusion](https://blog.teable.io/blog/data-reimagined-postgres-airtable-fusion))

What it buys: no row ceiling ("Airtable's highest limit of 100,000 rows" vs "no upper limit"), a 1M-row test table answering "complex filtering or statistical queries… in about 200 milliseconds," and real indexes. ([ibid.](https://blog.teable.io/blog/data-reimagined-postgres-airtable-fusion))

What it costs — **inferred, not documented** (see Unverified): user-defined fields become **DDL**. Every field add/rename/retype is `ALTER TABLE` on a live table. Teable still needs Formula, Link, Lookup and Rollup fields — computed and cross-table fields that a physical column cannot express by itself and that force a dependency graph outside the schema.

## G. NocoDB

The opposite bet: NocoDB connects to an **external, pre-existing** Postgres/MySQL/SQL Server/Oracle database as a "Data Source," introspecting its schema rather than owning it. Two independent toggles govern the blast radius: **"Allow Data Edit"** and **"Allow Schema Edit"** — the latter lets users "create, modify and delete tables, fields and relationships within the connected datasource from NocoDB UI," and it can be left **off**. ([Connect to a Data source](https://nocodb.com/docs/product-docs/data-sources/connect-to-data-source)) Because the source schema can drift underneath, NocoDB exposes an explicit **Sync Metadata** operation to reconcile. ([Sync with Data source](https://docs.nocodb.com/data-sources/sync-with-data-source))

Pattern to take: **presentation metadata (views, filters, permissions) lives in its own tables and never touches the data schema.** That is what makes read-only mode possible.

## H. Focalboard — negative signal

The repo's own README opens with: **"This repository is currently not maintained. If you're interested in becoming a maintainer please let us know here"**, and "This repository only contains standalone Focalboard." ([README](https://github.com/mattermost-community/focalboard/blob/main/README.md); [Call for Maintainers #5038](https://github.com/mattermost-community/focalboard/issues/5038)) The plugin lives on separately as [mattermost-plugin-boards](https://github.com/mattermost/mattermost-plugin-boards).

Read it as: the **standalone** product died; the version embedded in a product people already opened every day survived. Mattermost never published a post-mortem, so *why* is inference — but the surviving artifact is the integrated one.

## I. OpenProject — one type to rule them all

**"Work packages are items in a project (such as tasks, features, risks, user stories, bugs, change requests)… Work packages have a type, an ID, a subject"** and "Types are the different items a work package can represent, such as task, feature, bug, phase, milestone." ([Work packages](https://www.openproject.org/docs/user-guide/work-packages/)) Admins "can create and manage as many work package types as needed," each with its own color, copied workflow, default description template, and a **`Is milestone`** flag. ([Manage work package types](https://www.openproject.org/docs/system-admin-guide/manage-work-packages/work-package-types/))

So the type is **a row in a `types` table plus a FK on the work package** — not a subclass, not a second table. Everything else (hierarchy, relations, progress rollup, Gantt) is written once against `WorkPackage`.

Two structural consequences documented explicitly:
- Hierarchy is a **single parent FK**: *"Can I set multiple parents for one work package? **No, this is not possible.**"* ([FAQ](https://www.openproject.org/docs/user-guide/work-packages/work-packages-faq/))
- Parent progress is **derived, never stored**: OpenProject "sums up the progress of the children weighted by the Work… of each child," and "**Work manually added to work packages with children is ignored.**" ([ibid.](https://www.openproject.org/docs/user-guide/work-packages/work-packages-faq/))

## J. Vikunja / Operately — one idea each

**Vikunja: parent/child is just another relation kind.** Relations are typed and **auto-inverse** — Subtask↔Parent task, Blocking↔Blocked by, Precedes↔Follows, Duplicate of↔Duplicates, and a symmetric Related. "The linked task will show the opposite relation automatically." Users pick a **default relation type** in settings. ([Task Relations](https://vikunja.io/docs/task-relation-kinds/)) One `task_relations` table with `(task_id, other_task_id, kind)` and an inverse map replaces a parent FK *and* a blocked-by table. The cost: you lose the DB-level guarantee of a single parent.

**Operately: unified status across goals and projects.** Its v1.0 Work Map "gives you a clear, hierarchical view of all ongoing work… with goals and projects organized in a parent-child structure," having "unified statuses for both goals and projects, making it easy to scan all work at a glance." ([Operately v1.0 release notes](https://operately.com/releases/v100/)) Same lesson as Linear's status categories, applied across *entity kinds*.

---

## D. Synthesis — for a Workers + Neon team

### First, a correction to the brief's premise

The Neon serverless driver **does support interactive transactions — over WebSockets, not HTTP**. Neon's own guidance: "**HTTP**: Querying over an HTTP fetch request is faster for single, non-interactive transactions, also referred to as 'one-shot queries'," while WebSockets cover session/interactive use ([Neon serverless driver](https://neon.com/docs/serverless/serverless-driver)). Over HTTP you still get a non-interactive `transaction()` batch — multiple statements, one round trip, atomic. Do not architect around "no transactions."

### What is viable on Workers + Neon

**Viable, unchanged:** Linear's *client-side* half — Object Pool, IndexedDB persistence, transaction queue, lazy hydration by load strategy. Also viable: Linear's monotonic `syncId` (a `BIGSERIAL` on a `sync_actions` table) and a `GET /sync/delta?lastSyncId=…&toSyncId=…` endpoint served by a stateless Worker doing one-shot Neon queries. Also viable: the entire Plane data model and Linear's status-category model (an enum column plus a per-team ordered status table).

**Requires Durable Objects:** the delta *fan-out*. A Worker is stateless and cannot hold the client sockets. Durable Objects exist precisely for this — "Each Durable Object has a globally-unique name, which allows you to send requests to a specific object from anywhere… coordinate between multiple clients," with **WebSocket Hibernation** so idle sockets do not bill for wall-clock compute ([Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)). Shape: one DO per workspace (or per Linear-style *sync group*), holding sockets, broadcasting deltas, and — critically — *not* being the source of truth. Postgres stays authoritative; the DO is a pub/sub relay plus a `lastSyncId` watermark.

**Traps.**
1. **Do not build Huly's transactor.** It is a stateful, socket-holding, single write-path service backed by CockroachDB and Kafka. Recreating it on Workers means making a DO the write bottleneck for a whole workspace.
2. **Do not reach for CRDTs for issue data.** Linear ships LWW + rebase for a full issue tracker; even Huly confines CRDT to Y.js for prose. Field-level LWW on a server-authoritative row is correct and vastly cheaper.
3. **Do not start with full bootstrap + full local mirror.** Linear needed `loadStrategy`, partial indexes and sync groups to keep bootstrap tractable. That machinery is the *end* of the road, not the start.
4. **Do not model Cycle as a many-to-many.** Plane's own default forbids overlapping cycles and one active cycle.

### Top 5 stealable ideas, ranked by impact ÷ cost

| # | Idea | Why it wins | Source |
|---|---|---|---|
| 1 | **Fixed status *categories*, customisable status names** (Backlog/Unstarted/Started/Completed/Canceled + Duplicate/Triage) | Near-zero build cost; every burndown, automation and rollup reads the category, so you never re-derive "is this done?" | [linear.app/docs/configuring-workflows](https://linear.app/docs/configuring-workflows) |
| 2 | **Monotonic workspace `syncId` + `/sync/delta?lastSyncId=…`** | One `BIGSERIAL` column buys resumable catch-up, missed-message detection and offline reconciliation. Works on stateless Workers. | [Ch. 4](https://github.com/wzhudev/reverse-linear-sync-engine) |
| 3 | **Client-minted UUID + persisted transaction queue, batched per event-loop tick** | Delivers the perceived speed. `__transactions` survives a browser close and resends; the microtask `batchIndex` collapses a burst of edits into one round trip. | [Ch. 3](https://github.com/wzhudev/reverse-linear-sync-engine) |
| 4 | **Two-axis planning: scalar Cycle FK on the issue, many-to-many Module join** | Free at the schema level, and it is the exact distinction (time vs scope) users already understand. | [Modules](https://docs.plane.so/core-concepts/modules), [Cycles](https://docs.plane.so/core-concepts/cycles) |
| 5 | **Per-model `loadStrategy` (instant vs lazy) + sync groups scoping the delta stream** | Higher cost, but it is what keeps bootstrap sub-second at scale, and sync groups map 1:1 onto "which Durable Object do I connect to." | [Ch. 2](https://github.com/wzhudev/reverse-linear-sync-engine) |

Deliberately *not* in the top 5: Huly's mixin/plugin model. It is elegant, and it is the right answer only once third parties extend your entities.

### D1. One entity with a type field, or two tables?

**Nobody in this survey ships a two-table task/issue split.** Every product that could have, did not:

| Product | Entity | Type mechanism | Evidence |
|---|---|---|---|
| OpenProject | `WorkPackage` | `type` FK → admin-managed types table | ["Work packages have a **type**, an ID, a subject"](https://www.openproject.org/docs/user-guide/work-packages/) |
| Plane | Work item | **"Every work item in Plane has a type."** Enabling the feature auto-creates `Task` (default) and `Epic` | [Work Item Types](https://docs.plane.so/core-concepts/issues/issue-types) |
| Linear | `Issue` | No type field at all — differentiation is by *status category* and label | [Issue status](https://linear.app/docs/configuring-workflows) |
| Vikunja | `Task` | No type — differentiation via relation kind | [Task Relations](https://vikunja.io/docs/task-relation-kinds/) |
| Huly | `Doc` subclass | `_class` + **mixins** | [api-client](https://github.com/hcengineering/huly.core/blob/main/packages/api-client/README.md) |

The strongest evidence is Plane's: it began with a single `Issue`, and when customers demanded Epics it **added a type field and per-type custom properties** rather than a second table — and made the switch **irreversible**: *"Work Item Types cannot be disabled once turned on for a project."* ([Work Item Types](https://docs.plane.so/core-concepts/issues/issue-types))

Both also converged on **scoped sequential human IDs**: Plane `PROJ-1`; OpenProject instance-wide `#12345` or project-based `PROJ-123`; Linear team-scoped `ENG-123`.

**Recommendation (as written by the research agent):** collapse `work_items` + `tasks` into one table with a `type_id` FK and a per-type property bag.

> **REJECTED in design (§2.6).** This conflates two things. Plane's and OpenProject's lesson is about *work-item types* (bug/feature/epic as data, not an enum) — which we already honor via `work_items.type`. It is **not** an argument for merging checklists into issues: Linear has sub-issues **and** markdown checklists; Jira has sub-tasks **and** checklists. Once `parent_id` exists, hierarchy/rollups/relations are written once against `work_items`; `tasks` joins nothing.

### D2. Is parent/child depth-limited, and is the limit documented?

**No product in this survey documents a maximum hierarchy depth.** What *is* documented is narrower and more useful:

- **OpenProject** — depth: not documented. **Cardinality is**: *"Can I set multiple parents for one work package? No, this is not possible."* One type-level constraint exists: types flagged `Is milestone` **cannot have sub work packages**.
- **Plane** — depth: not documented. Sub-work items may now **cross project boundaries**. ([Changelog, 2026-03-31](https://plane.so/changelog/2026-03-31-vote-on-work-items-link-sub-work-items-across-projects))
- **Linear** — depth: not documented (`linear.app/docs/sub-issues` returns 404). The client computes an `Issue.parents` chain, implying multi-level.
- **Vikunja** — depth: not documented. Parent/child is a *relation kind*, so **there is no single-parent constraint to violate**; the DB cannot stop a cycle.
- **AppFlowy** — depth: not documented. Documents are a **block tree** inside a YDoc.
- **Huly** — not sourced.

**Recommendation:** do not impose a UI depth limit; impose the two invariants everyone else relies on. (1) **Single parent FK** — OpenProject's flat "no" is the cheapest correctness win, and it is what makes a recursive CTE terminate. (2) **Cycle prevention on write.** Then note the operational trap: OpenProject derives parent progress from children and **ignores manually-entered work on parents** — the moment you have a hierarchy, rollup fields must be computed, not stored, or they will disagree.

### D3. Additions to the "what to steal" list

6. **AppFlowy's `TypeOption`** — a per-field-type JSON config attached to the field, with the cell storing opaque raw data. Lets you add field types without a migration.
7. **Shared fields/rows, per-view layout+filters+sorts** — the cheapest way to ship Grid/Board/Calendar over one dataset.
8. **NocoDB's Data Edit / Schema Edit toggles** — keep presentation metadata in your own tables so the data schema stays untouched.
9. **Vikunja's auto-inverse typed relations** — one table, one inverse map, and blocked-by/duplicates/precedes come free.

**New trap: Teable's model on Neon.** Mapping user-defined fields to physical columns means every field edit is `ALTER TABLE`, and DDL cannot be wrapped in an interactive transaction over HTTP, so a multi-step field migration has no rollback boundary — and Workers have a wall-clock budget. If you don't need raw SQL access and unlimited rows, a JSONB property bag keyed by `field_id` (AppFlowy's shape) is strictly cheaper.

---

## Unverified / could not source

1. **Linear's server-side stack.** Which database, how `syncId` is allocated, whether deltas are persisted per workspace or globally. The reverse-engineering study is client-side only.
2. **Whether Linear mints issue UUIDs on the client.** The Object Pool is keyed by UUID and offline creation implies it, but no source states it directly.
3. **The exact rationale for `ENG-123`.** Team-scoped numbering is documented; the reasoning is inferred.
4. **Linear's GraphQL mutation-to-delta latency, delta packet wire format, and how `lastSequentialSyncId` differs from `lastSyncId`.**
5. **Plane's service topology.** Docs name Postgres, Redis and S3/MinIO; the individual containers and whether a broker such as RabbitMQ is used were **not** confirmed.
6. **Whether Plane allows an issue in multiple cycles when Parallel Cycles is enabled.**
7. **Huly's transaction storage shape** (append-only event log vs current-state rows). Event-sourcing is implied by the name `transactor` but never asserted.
8. **Huly's historical MongoDB usage.** Current docs say CockroachDB.
9. **Why Mattermost stopped maintaining standalone Focalboard.** The unmaintained status is documented; no post-mortem or rationale was found. "Integrated survived, standalone didn't" is a reading of the outcome, not a sourced claim about intent.
10. **What actually breaks in Teable's physical-column model.** No Teable doc enumerates the trade-offs. The `ALTER TABLE`-per-field-edit consequence, Postgres's 1600-column ceiling, and the dependency graph needed for Formula/Lookup/Rollup are **inferred from the design**.
11. **AppFlowy's per-view vs shared data boundary.** Whether filters and sorts are per-view or per-database was **not** confirmed from the official page.
12. **Hierarchy depth limits — all products.** Not documented anywhere. Absence of a documented limit is not proof no limit exists in code.
13. **Huly's parent/child model and depth.** Not sourced at all.
14. **Operately and Vikunja beyond the single idea each.**
15. **AppFlowy-Cloud's Redis Streams delta propagation and S3-vs-Postgres tiering by document size.** Widely repeated in AI-generated wikis (DeepWiki), **not** found in `docs.appflowy.io`. Deliberately excluded from the body above.
