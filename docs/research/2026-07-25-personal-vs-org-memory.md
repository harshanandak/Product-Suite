# Personal-vs-Org Dual-Tier Agent Memory — Competitive Teardown & Design Input

**Date:** 2026-07-25
**For:** Product-Suite memory brain (P1 access authority + personal tier design)
**Evidence labels:** `[verified]` = read in the vendor's/author's primary doc · `[claim]` = vendor marketing or a search excerpt I did not read in full · `[reasoning]` = my inference

---

## 0. Verdict on the thesis

The thesis holds, but not for the reason it looks like. Almost every system in the market has **exactly one** tier and treats the other as out of scope:

| System | Personal tier | Org tier | Personal→org promotion |
|---|---|---|---|
| Mem0 | `user_id` scoping | `agent_id`/`app_id` namespaces, no org semantics | none |
| Letta | per-agent blocks | shared blocks (`block_ids`) | manual attach, no gate |
| Zep/Graphiti | user graph | group graph (`group_id`) | none (dev copies data) |
| ChatGPT Business | yes | **explicitly refused** | none — "not transferable" |
| Claude Team/Ent | per-project | per-project only | none (isolation is the feature) |
| Dust | private agent memory | Company Data space (documents, not memory) | none |
| M365 Copilot | mailbox-stored memory | permission-aware Graph index | none |
| Glean / Slack AI / Notion AI | — (no memory tier) | ACL-mirroring retrieval | n/a |
| Collaborative Memory (Accenture, 2505.18279) | private tier | shared tier | **policy-automated, no human gate** |
| Org Memory for Agentic BPE (SAP, 2607.03228) | — | curated org tier | **human-gated, but no personal tier to promote from** |

`[reasoning]` The moat is not "have two tiers." Two tiers is a `WHERE` clause. The moat is the **governed promotion path between them**: the only two systems that model tiered memory rigorously each solved half of it. Accenture built the tiers + policies + provenance but let policies decide sharing automatically. SAP built the human review gate and the conflict curator but their memory has no personal tier at all — and their paper *poses our question as future work*: "This raises the question of who is allowed to access, approve, and change which parts of the memory." `[verified]`

We already have the review gate (Review Inbox), the provenance rail, and the supersession chain. We are one column and one flow away from being the only system with a **review-gated personal→org promotion path**.

---

## Part 1 — Teardowns

### 1.1 Mem0 — closest OSS prior art, and the sharpest scoping lesson

`[verified]` (docs.mem0.ai/platform/features/entity-scoped-memory) Mem0 scopes with four flat identifier columns, not a hierarchy:

| Dimension | Field | Purpose |
|---|---|---|
| User | `user_id` | persistent persona/account |
| Agent | `agent_id` | distinct agent persona |
| App | `app_id` | product surface |
| Session | `run_id` | short-lived flow/thread |

Mechanics that matter to us:
- Writes accept **any combination**; absent fields default to `NULL`.
- **Implicit null scoping**: passing only `{"user_id": "alice"}` restricts results to rows where `agent_id`, `app_id`, `run_id` are all `NULL`. Broader joins require explicit wildcards `"*"` or lists. `[verified]`
- The docs call out the resulting footgun by name: a memory written with only `user_id="alice"` is **invisible** to a search for `{"AND":[{"user_id":"alice"},{"agent_id":"bot"}]}` because the stored `agent_id` is `NULL`, not `"bot"`. `[verified]`
- At least one identifier is required; the server rejects an unscoped write. `[claim]`
- `org_id`/`project_id` exist but as **project-level configuration** returned by `client.project.get()`, not as per-write scoping keys. `[verified]` — i.e. Mem0 has no organizational memory tier in the retrieval path.

`[verified]` (docs.mem0.ai/core-concepts/memory-types) Mem0's concept page *does* name "Organizational memory: shared context available to multiple agents or teams" as a key term, and describes a three-step pipeline **Capture → Promote → Retrieve** where retrieval "ranks user memories first, then session notes, then raw history." But "Promote" means conversation→session→user *durability* promotion, **not** personal→org *visibility* promotion. The org tier is vocabulary, not schema.

`[claim]` Mem0's consolidation loop historically ran a second LLM pass emitting `ADD` / `UPDATE` / `DELETE` / `NOOP` against the most-similar existing memories; the current algorithm is described as single-pass ADD-only with hybrid (semantic + keyword + entity) retrieval. There is an open issue titled "ADD-only architecture doesn't implement conflict resolution for semantically similar memories."

**Gap to exploit:** flat null-defaulting scope columns give silent-miss retrieval bugs, and there is no tier concept, no visibility authority, no promotion.

### 1.2 Letta (MemGPT) — sharing as attachment, no authority model

`[verified]` (docs.letta.com) A memory block = `label` + `description` + `value` + `limit` (a **character** limit), rendered into the prompt as XML `<memory_blocks>` with live `chars_current`/`chars_limit` metadata the model can see. Blocks are always in context — no retrieval step.

`[verified]` Sharing is literal object sharing: `client.blocks.create(...)` then pass the same `block_ids` to multiple agents (or `client.agents.blocks.attach(agent_id, block_id)`). One agent's update is immediately visible to all attached agents. Documented uses include "share read-only policies across all agents from a central source" and parent agents watching subagent result blocks.

`[reasoning]` This is the cleanest *mechanism* for an org tier (a shared row, not a copy) and the weakest *governance*: attachment is the only access decision, there is no per-viewer trimming, no provenance on who wrote what into a shared block, and a shared block is a mutable free-text blob — so a bad write silently rewrites org truth for every agent with no supersession history. Our `root_id`/`supersedes_id` chain is strictly stronger.

### 1.3 Zep / Graphiti — namespacing ≠ authorization

`[verified]` (help.getzep.com/graphiti/core-concepts/graph-namespacing) Graphiti namespaces via `group_id` on episodes and fact triples; queries are scoped by passing `group_ids`. Namespacing creates "isolated graph environments within one Graphiti instance," pitched for multi-tenancy, test/prod separation, and domain-specific graphs.

`[verified]` (Zep v2 cookbook, "Share Memory Across Users Using Group Graphs" + concepts) A **user graph** is tied to a `user_id`; a **group graph** is "just like a user graph, except it is not tied to a specific user" — an arbitrary graph usable as memory for a group of users. The documented pattern is exactly our two-tier read: *"when your chatbot responds, it could utilize a memory context string from both that user's graph as well as from the product group graph."* The motivating example is org-level product knowledge you don't want redundantly copied into every user graph.

`[verified]` Temporal machinery worth stealing conceptually: **fact invalidation** stores the time a fact became invalid on the edge, and the Context Block carries valid/invalid dates so the model sees *when* a fact stopped being true.

`[reasoning]` Critical limitation: `group_id` is a **partition key, not a permission**. Nothing in the namespacing model checks whether the asking user may read that group. Any caller who can name the `group_id` reads it. Zep therefore gives us the read-blend pattern to copy and nothing at all for the access-authority layer.

### 1.4 Glean — the reference implementation of ACL-mirroring retrieval

`[verified]` (docs.glean.com/administration/platform/mcp/security) "Every search, chat, and document retrieval call enforces per-document and per-object permissions based on Glean's Knowledge Graph (connector-sourced ACLs, groups, roles, sharing settings)." And: the MCP server "introduce[s] **no new permission model** … All access is user-scoped and permission-aware, enforcing the same ACLs, group memberships, and sharing rules as the Glean UI and APIs." Auth is OAuth with per-user tokens scoped to `SEARCH`/`CHAT`/`DOCUMENTS`/`TOOLS`; fallback tokens are tied to a specific user and tenant.

`[verified]` (glean.com/blog/secure-generative-ai…) The hard part is mirroring *foreign* permission models faithfully. Glean enumerates the edge cases: documents that become public only once a user has visited them (certain GDrive behavior), **time-limited/temporary access permissions** that require staying in sync, and documents that expose only "allowed criteria"/"disallowed criteria" rather than a flattened user list.

`[claim]` Third-party analysis describes the order of operations as retrieve-candidates-then-trim: the Knowledge Graph retrieves potentially relevant snippets, filters that set through the user's permissions, and only the surviving set reaches the LLM — "the LLM cannot leak information it never receives."

`[reasoning]` Two transferable principles: (a) **one permission model, no second one for AI** — the AI surface must not be able to widen access; (b) trimming must happen **before** the model sees text, because post-hoc filtering of a generated answer is not a security boundary. Both are already the right shape for our P1 fail-closed design. Glean has no memory tier at all — it retrieves documents, so it never faces "whose derived belief wins."

### 1.5 Microsoft 365 Copilot — the only shipped personal+org blend, and its failure mode

`[verified]` (learn.microsoft.com/copilot/microsoft-365/microsoft-365-copilot-architecture) "Operating inside the Microsoft 365 service boundary doesn't grant Copilot tenant-wide visibility. Data access is always scoped to the signed-in user's permissions." Flow: user prompt → **grounding** against Microsoft Graph in the user's tenant → grounded prompt to the LLM → response. "Copilot only accesses data that an individual user is authorized to access… Copilot doesn't access data that the user doesn't have permission to access." Named controls: Restricted SharePoint Search (RSS), SharePoint Advanced Management (SAM), Microsoft Purview.

`[verified]` (learn.microsoft.com/microsoft-365/copilot/copilot-personalization-memory) The **personal tier's storage location is the killer design decision**: "Memories, which include saved memories, details inferred from chat history and custom instructions, are stored in the **user's Exchange mailbox in a hidden folder**. Thus, memories follow the same security and compliance policies as other mailbox data, such as Customer Lockbox and encryption at rest." Retention policies/labels apply to memories. The tenant switch is **Enhanced personalization**, default **ON**, settable via Graph (`enhancedPersonalizationSetting`); when off, users cannot re-enable custom instructions / saved memories / chat history.

`[reasoning]` Storing personal memory *inside the user's own permission domain* means the privacy floor is inherited rather than re-implemented — there is no separate ACL for memory to get wrong, and eDiscovery/retention/legal hold come free. That is the single best idea in this teardown, and it argues for our personal tier being *ownership-keyed and inheriting the user's visibility*, not a parallel permission system.

**Failure mode — oversharing.** `[verified]` Microsoft ships a deployment blueprint whose **first of three pillars is literally "Remediate oversharing,"** powered by Purview and SharePoint Advanced Management (bundled with the Copilot license). `[claim]` Third-party analyses characterize it as: Copilot creates no new permission gaps but makes years of permission sprawl — broad sharing links, broken inheritance, "Everyone except external users" sites — instantly discoverable via plain-language prompts; vendor figures cite ~16% of business-critical data overshared, ~802k exposed files per org, 150–300 overshared sites per tenant.

`[reasoning]` The lesson is not "ACL-mirroring is wrong." It is that **correct-by-permissions is not the same as correct-by-intent**, and retrieval quality amplifies latent misconfiguration. For us: a promoted memory must record *who authorized the widening* and be revocable, because "technically readable" will eventually be wrong.

### 1.6 ChatGPT memory — a deliberate refusal to build an org tier

`[verified]` (help.openai.com/en/articles/8590148 — Memory FAQ) Memory draws on chats, files, and connected apps; a user-editable **memory summary** (editable by typing corrections or highlighting text); and a **"memories in sources"** affordance — a book icon under a response reveals which memories/custom instructions/chats personalized it, and tapping a memory opens *an explanation of why it was used*. Deleting a fact requires deleting **every source** it appears in (chats, archived chats, files, summary, connected apps). Turning memory back on can re-derive memories from remaining history. OpenAI names the problem the old system had: memories went stale and could **contradict one another** ("training for a marathon" vs "sprained my ankle").

`[verified]` (help.openai.com/en/articles/9295112 — Memory FAQ, Business version) The org stance is explicit:
> "**Can I share memories from my account with other members of my workspace? No.** Memories are: tied to each individual account. Not transferable to other users, even within the same Business workspace."

Also: merging a personal account into a Business workspace migrates all conversations and memories and is **irreversible** (personal workspace permanently deleted); workspace deactivation preserves memories, workspace deletion destroys them; workspace owners can disable memory workspace-wide, which **deletes members' existing saved memories**.

`[reasoning]` This is the clearest competitive gap in the report. The largest deployed memory system in the world, on its business tier, has decided personal memory is non-shareable. Its per-response "why was this memory used" explanation is nonetheless the UX bar for attribution — and it's the affordance our promotion flow needs to borrow, because a user will only consent to promote what they can see being used.

### 1.7 Claude memory — isolation *as* the safety feature

`[verified]` (claude.com/blog/memory, 2025-09-11 + Oct 23 update) Memory is optional, remembers team processes/client needs/project details, and: "**If you use projects, Claude creates a separate memory for each project.** This ensures that your product launch planning stays separate from client work, and confidential discussions remain separate from general operations. These project boundaries help you and your teams manage complex, concurrent initiatives without mixing unrelated details, **serving as a safety guardrail**." Shipped Team/Enterprise first, then Pro/Max; Enterprise admins can disable org-wide; Incognito chats never save to memory.

`[reasoning]` Anthropic frames non-blending as the product benefit. That's defensible for a chat assistant and inadequate for an agent that executes work: strict per-project isolation means an org-wide policy ("never commit to main") must be re-taught in every project, which is exactly the "knowledge silos and rule duplicates" failure SAP's paper names. `[verified]` Our scope cascade (org→project→work_item_type→work_item) already beats this — a rule written at org scope reaches every project. Adding a personal tier must **not** regress into Claude's isolation model.

### 1.8 Dust.tt — closest to our shape, no bridge between the halves

`[verified]` (docs.dust.tt/docs/agent-memory) "Memories are **private to each user** and only you can view and manage your memories with each agent. Memories persist until manually deleted, and **each agent maintains separate memory spaces for complete isolation** of your data." The agent decides what to store; users can say "remember that…"; memories are browsable and deletable per item in the agent drawer.

`[claim]` (docs.dust.tt/docs/data, access-controls) Spaces are containers: **open** spaces (all workspace members) and **restricted** spaces (designated users); every workspace has a default **Company Data** space that cannot be modified or restricted.

`[reasoning]` Dust has both halves in one product — private per-user agent memory *and* a governed org knowledge space — and no path between them. The org side is documents, the personal side is memory, and never the twain. This is the single closest competitor to what we're building and the promotion path is precisely what's missing.

### 1.9 Notion AI / Slack AI — workspace-only, permission-mirroring

`[claim]` (notion.com/help/enterprise-search-security-and-privacy-practices) Notion Enterprise Search respects existing permissions in the workspace *and* in connected apps (Slack, Drive, GitHub, Jira, Teams, SharePoint, OneDrive), surfacing only what the asking user can access; SOC 2 Type 2 / ISO 27001 / GDPR, zero data retention for enterprise.

`[claim]` (slack.com/help/articles/28310650165907 + slack.engineering) Slack's AI features "only use Slack data that members have access to at the time of request and won't display or use data from private channels or DMs they aren't a part of"; AI search "will never surface any results that Slack's regular search would not"; the requesting user's ACL constrains what the LLM receives. Implementation notes describe private-channel memberships being **queried at request time** rather than denormalized into the index (to avoid materializing every member id), while DMs/MPDMs — small, static membership — are indexed with member ids.

`[reasoning]` Two useful architecture points: (a) "AI must never surface what normal search wouldn't" is a testable invariant we should adopt verbatim for memory retrieval — *a memory retrieval must never surface what a scoped list query wouldn't*; (b) the hybrid ACL strategy (denormalize small stable memberships, resolve large volatile ones at query time) is the right performance answer for our fail-closed filter. Neither product has a memory tier — they retrieve messages/pages — so neither faces conflict or promotion.

### 1.10 Academic — the two halves of our design, published separately

**A. Collaborative Memory** — Rezazadeh, Li, Lou, Zhao, Wei, Bao (Accenture Center for Advanced AI), arXiv **2505.18279**, 23 May 2025. `[verified]`
- Two tiers: `M_private` (fragments visible only to the originating user) and `M_shared` (selectively shared fragments).
- Permissions modeled as **time-evolving bipartite graphs**: user↔agent and agent↔resource. Asymmetric by design.
- Every fragment carries **immutable provenance** — contributing agents, accessed resources, timestamps — explicitly "to support **retrospective permission checks**."
- **Read policy** `π_read^{u,a,t}` projects existing fragments into *filtered, transformed views* per requester and time.
- **Two write policies**: `π_write/private` (retention in private tier) and `π_write/shared` (whether/how to share, applying context-aware transformations — **anonymization and redaction**).
- Retrieval: fragments are LLM-generated key-value pairs; cosine similarity over embeddings with **separate top-k per tier**.
- Results: fully collaborative memory cut resource usage up to **61%** at 50% query overlap and 59% at 75% overlap vs isolated memory, at maintained accuracy; policies provably adhered to under permission changes; full auditability.

`[reasoning]` This is our architecture, one year early, with one omission: sharing is decided by an **automated write policy**, not a human. Their redaction/anonymization transform is the piece we don't have and should steal — promotion is not a visibility flip, it's a *rewrite* (strip the person, keep the rule).

**B. Organizational Memory for Agentic Business Process Execution** — Kirchdorfer, Rebmann, Warmuth, Kampik, Heilker, Berg (SAP Signavio), arXiv **2607.03228**, 03 Jul 2026. `[verified]`
- Thesis: prompt-level or per-agent-retrieval knowledge "does not scale in enterprises, as it gives rise to **knowledge silos and rule duplicates**, and makes consistent updates and learning across agents difficult." Answer: "a shared, **governed**, agent-consumable reference layer."
- Unit = **process atom**: `Name`, `Source` (reference to the input artifact), `Content` = {**Applicability** (process/activity/role/org-unit/business-object/precondition), **Action** (the rule/constraint), **Purpose** (why it exists)}. Explicitly: unification into plain text is insufficient without decomposition; one atom = exactly one rule.
- Requirements: R1 heterogeneous sources · R2 agent-consumable decomposed representation · R3 **conflict detection/resolution** (worked example: an SOP allowing deviations below EUR 250 vs a plant-specific policy with a lower threshold) · R4 **traceability to source artifacts** · R5 **context-specific retrieval** · R7 targeted updates as policies change.
- Curation: source-specific extractors → candidate atoms → a **Global Curator** (read access to existing memory) runs (i) isolation quality checks (meaningful name, clear scope, single rule) and (ii) relation checks against existing memory (duplicate / overlap / conflict) → emits a **contextualized group of atom changes** (add/remove/modify).
- **Human gate:** "a **Human expert** reviews the changes, checks the atoms and their sources, and decides if changes should be applied. They may **accept the proposal, modify individual atoms, reject individual changes, or resolve conflicts differently than suggested by the curator**." Domain-split review: finance approves cost-center rules, procurement/compliance approve theirs.
- Consumption: the agent emits a **context request** describing process/activity/role/org-unit/input data/case state; a Retriever returns only applicable atoms (tag filtering, semantic search, rule matching, or LLM selection), because "simply providing all potentially relevant documentation… increases latency, introduces irrelevant information, and may distract the agent."
- Open problem they name and do not solve: **"who is allowed to access, approve, and change which parts of the memory."**
- Limitations they state: one synthetic procurement process, small PDF-only corpus; generalization to overlapping/conflicting real policies not demonstrated.

`[reasoning]` We already have (2)-shaped atoms (`title` + `body` + `attrs.applies_when`), (4) traceability (`source_kind`/`source_run_id`/`source_proposal_id`/`source_quote`), and the human gate (Review Inbox). We are missing their **Global Curator** — a pre-review pass that clusters candidates and *diffs them against existing memory* so the reviewer sees "this duplicates X / conflicts with Y" instead of a naked proposal. That is the highest-leverage upgrade to our existing inbox regardless of tiering.

**C. Promotion patterns generally.** `[claim]` Practitioner write-ups converge on the same loop: post-task summarizer extracts learnings → **human review gates the commit to long-term memory** → a memory-write agent persists approved entries; the gate is framed as the pragmatic defense against **memory poisoning**, "reducing contamination risk at the write boundary rather than retrospectively." `[reasoning]` No system I found publishes a **personal→org promotion** flow with per-item review, provenance-preserving redaction, and revocation. That is genuinely open ground.

---

## Part 2 — Design patterns extracted

### 2.1 Schema: how to represent tier

Our current `memories` table (`packages/db/src/schema.ts:488`) `[verified]` has:
`tenant_id`, `kind`, `title`, `body`, `attrs`, `root_id`/`supersedes_id`/`superseded_by_id`/`change_reason`, `valid_from`, `status`, `scope_type` (`org|project|work_item_type|work_item`), `scope_id`, `topics[]`, `source_kind`, `source_run_id`, `source_proposal_id`, `source_quote`, `created_by`, `decided_by`, `pinned`, `priority`, `enforcement`, `embed_model`.

Note precisely what's absent: **no owner column and no visibility column.** `created_by`/`decided_by` are *audit* text fields, and the index `memories_tenant_scope_idx` is `(tenant_id, status, scope_type, scope_id)` — every active memory at a scope is returned to every asker in that tenant.

Three candidate representations:

**(a) Separate store for personal memory.** Rejected. `[reasoning]` It duplicates retrieval, ranking, supersession, attribution, and the fenced-injection renderer; it makes cross-tier dedup and conflict detection a join across stores; and promotion becomes a copy (losing the supersession chain that makes revocation coherent). Copilot's mailbox-colocation looks like this pattern but isn't — it's a *storage-location* choice under one retrieval path.

**(b) New `scope_type = 'user'` + `scope_id = user_id`.** Tempting because it costs one enum value and zero new columns. **Rejected as the primary mechanism.** `[reasoning]` It conflates two orthogonal axes. Scope answers *"what is this about"* (org / project / work item) and cascades; tier answers *"who may see it."* Collapsing them makes "my personal note about project X" unrepresentable — you must choose between `scope=project:X` (loses privacy) and `scope=user:me` (loses the project cascade). Mem0's flat null-defaulting columns are the cautionary tale: because scope keys double as filter keys, the documented common failure is *silently retrieving nothing*.

**(c) Recommended — orthogonal ownership axis, two nullable columns:**
```
visibility     memory_visibility NOT NULL DEFAULT 'org'   -- enum: 'private' | 'org'
owner_user_id  text NULL                                   -- NOT NULL iff visibility='private'
```
with a CHECK enforcing the biconditional (`(visibility='private') = (owner_user_id IS NOT NULL)`), and the retrieval index extended to `(tenant_id, status, visibility, owner_user_id, scope_type, scope_id)`.

Why this shape: `[reasoning]`
- A private memory keeps its real scope, so `scope=project:X, visibility=private, owner=alice` cascades correctly *for Alice* — the thing (b) can't express.
- Promotion is `UPDATE visibility='org', owner_user_id=NULL` **as a new row in the supersession chain** (`supersedes_id` → the private row, `change_reason` = the promotion rationale, `decided_by` = the approver). The private original stays `status='superseded'`, so the audit trail shows *exactly* what was widened, by whom, and from whose private note — and demotion is another link in the same chain rather than a delete.
- `DEFAULT 'org'` makes the migration a no-op for every existing row.
- Two enum values only. Resist `'team'`/`'project-visible'` in v1: the moment visibility has more than two values you need a group-membership resolver, which is the Glean problem (mirroring foreign permission models, temporary access, non-flattened allow-lists) and a P2 in its own right.
- The `enforcement` (`advisory|hard`) and `pinned`/`priority` columns must be **ignored for private memories in other users' runs** by construction, since they can't be retrieved at all — no extra work, but worth an explicit test.

**Explicitly do NOT** implement tier as a `topics[]` tag or an `attrs` key. `[reasoning]` A privacy boundary carried in a nullable JSONB field or a free-text array fails open on every code path that forgets it. Our own P1 principle is fail-closed; that requires a NOT NULL column the query planner can index and a CHECK the database enforces.

### 2.2 Retrieval blending and conflict

Ordering: **personal-first for preference/style, org-first for policy/authority.** `[reasoning]` This falls out of `kind`, which we already have:

| kind | Winner on conflict | Rationale |
|---|---|---|
| `rule` | **org wins** | Rules are policy. A private rule cannot silently override org policy — that is privilege laundering in the opposite direction (a user quietly weakening a gate for their own runs). Surface the private rule as a *flagged divergence*, don't apply it over an org `hard` rule. |
| `decision` | **org wins**, private annotates | Decisions are collective records. A private dissent is context, not the record. |
| `fact` | **most recent valid wins**, tie → org | Facts are time-truthed; this is Zep's fact-invalidation model `[verified]` and our `valid_from`/supersession chain already implements it. |
| preference/style (today: `fact` with a preference topic) | **personal wins** | Nobody's org has an opinion on whether Alice wants terse diffs. |

Blend mechanics, borrowing Collaborative Memory's separate-top-k `[verified]`: run **two retrievals** (private-owned, org) rather than one query over a union. Reasons: `[reasoning]` (i) a single blended similarity ranking lets a chatty private note starve a load-bearing org rule; (ii) separate lanes make the token split a policy knob instead of an emergent property of embeddings; (iii) it makes the fail-closed test trivial — assert the private lane returns zero rows for a non-owner.

Conflict must be **surfaced, not silently resolved.** `[reasoning]` When a retrieved private memory contradicts a retrieved org memory on the same subject, the correct behavior is to inject both with an explicit marker (`[your note diverges from org policy: …]`) and log the divergence as a promotion/supersession candidate. Silent resolution destroys the signal that org memory is stale — which, per SAP's R3/R7 `[verified]`, is the main thing you want memory to tell you. This is also our cheapest source of high-quality promotion candidates: *a private note that repeatedly contradicts org memory is either a policy bug or an unpromoted improvement.*

Attribution: our `run_memory_attributions` rail (`injected_via` ∈ `pinned|retrieved|tool`, plus `suppressed` for holdout) `[verified]` needs the tier recorded per injected row so we can answer "which tier moved the outcome" — see 2.6.

### 2.3 Promotion and demotion flows

**Personal → org (the moat flow).** Design it as a *proposal*, which means it rides the machinery we already have: `proposals` → Review Inbox → `apply.ts` → `memories` with `source_proposal_id` (already uniquely indexed, partial on NOT NULL) `[verified]`.

1. **Trigger** (three sources, all cheap):
   - user-initiated ("promote this");
   - **divergence-triggered** — the private-vs-org conflict from 2.2;
   - **recurrence-triggered** — N different users hold semantically equivalent private memories. `[reasoning]` This is the strongest signal in the system and only a dual-tier design can even compute it: *k independent people privately learned the same thing* is precisely an unwritten org rule. No competitor can produce this signal, because none has both tiers under one retrieval path.
2. **Redaction transform** — do not promote the private row's text. Generate a candidate org atom that strips person-specific and third-party content and keeps applicability/action/purpose. This is Collaborative Memory's `π_write/shared` with anonymization/redaction `[verified]`, and SAP's atom shape `[verified]`. The reviewer sees private original and proposed org text **side by side**.
3. **Curator pass before review** (SAP's Global Curator `[verified]`): dedup/overlap/conflict-check the candidate against existing org memory and present the verdict with the proposal — "duplicates M-421", "conflicts with M-88 (threshold)", "novel". `[reasoning]` Without this, promotion volume degrades the inbox into a rubber stamp, which is how a review gate becomes theater.
4. **Two consents, not one.** The **owner** consents to disclosure (this is my private note; it may be widened) and an **org approver** consents to authority (this becomes policy). `[reasoning]` Collapsing them is the design error that produces both failure modes: owner-only → a user unilaterally writes org policy; approver-only → the org reads a private note without consent. Mechanically: `created_by` = the owner who released it, `decided_by` = the approver, and the promoted row is a **new** row superseding the private one.
5. **Result:** promoted org row (`visibility='org'`, `owner_user_id=NULL`, `supersedes_id`→private row, `change_reason`, `source_kind` preserved), private row `status='superseded'`.

**Org → personal.** Two distinct things, and only one is worth building now:
- **Personal annotation on an org memory** (worth building, cheap): a private child memory pointing at the org row (`attrs.annotates` = org memory id, or a nullable `annotates_id`) — "org says X; on my team it's really X'." `[reasoning]` This is where divergence signal is *born*; it turns private dissent into structured data instead of ambient frustration, and it is the natural inbox feed. **Never** let an annotation weaken a `hard`-enforcement org rule (2.2).
- **Demotion** (defer): an org memory narrowed back to private. `[reasoning]` Almost always the right action is `retract` with a `change_reason` (which we already support) rather than un-publishing into one person's private tier, because other users' runs already consumed it. Model demotion as retraction-plus-optional-private-fork.

**Revocation is the promotion flow's real test.** `[reasoning]` Because promotion produces a *chain link* rather than a mutation, "un-promote" is expressible and auditable. Combined with Collaborative Memory's immutable provenance for **retrospective permission checks** `[verified]`, we can answer the question every enterprise buyer asks and nobody currently answers: *"Alice left / that project ended — what of hers is now org knowledge, and what did it influence?"* Our attribution rail already stores the runs, so this is a join, not a new subsystem.

### 2.4 Privacy floor integration (with the P1 access-authority design)

Non-negotiable invariants, adapted from Glean and Slack `[verified]`/`[claim]`:
1. **No new permission model for memory.** Memory retrieval resolves the *same* authority as the rest of the product. Corollary (Glean's own words: MCP "introduces no new permission model") `[verified]`: the memory tool surface must not be able to read anything a scoped list query couldn't.
2. **Slack's invariant, restated for us:** *memory retrieval must never surface what a permission-scoped query wouldn't.* This is a property test, not a doc sentence — assert it for retrieval, for the `search_memory` tool, and for injection rendering.
3. **Trim before the model, never after.** `[claim]`/`[reasoning]` The private lane is filtered in SQL by `owner_user_id = :asker`, so unauthorized text never reaches the context builder. Filtering an already-generated answer is not a boundary.
4. **Fail closed on unknown asker.** No asker identity → **org lane only, private lane empty**. Never "no filter."
5. **Inherit, don't invent, for storage.** `[reasoning]` Copilot's mailbox colocation `[verified]` is the ideal we approximate: personal memories should be governed by the same retention/export/deletion the user's own data is. Concretely: user deletion must cascade or force-resolve `owner_user_id` — a private memory outliving its owner with a dangling owner id is a fail-open bug, so make it `ON DELETE` explicit rather than incidental.
6. **Meeting-derived content is the sharp edge.** `[reasoning]` A meeting has *multiple* participants, so a "personal" extraction from a meeting is not the extractor's private property — the other speakers' words are in it. Rule: meeting-sourced memories default to the **visibility of the meeting's participant set**, i.e. `visibility='org'` scoped to the project when the meeting is a project meeting, and `private` only when the content is the owner's own commitment/preference. Attributed quotes from other participants must never be promoted into org memory without the `source_quote` provenance we already store — that field is what makes the review defensible. Our existing `meeting_promotions` table (content-derived `meeting_record_id`, composite-unique per tenant) `[verified]` already establishes promote-once semantics for meeting content; the personal tier must reuse that idempotency, not invent a parallel one.
7. **Oversharing is a product risk, not just a config risk.** `[verified]` Microsoft dedicates a blueprint pillar to remediating it. `[reasoning]` Our equivalent: a promotion audit view (what got widened, by whom, when, and what it influenced) shipped *with* the promotion feature, not after.

### 2.5 Injection budgeting

Today we budget the rules lane separately from decisions/facts (`DEFAULT_RULES_TOKEN_BUDGET`, ordered `pinned desc, priority desc, valid_from desc, created_at desc`, capped by `MAX_CANDIDATES`) `[verified]` — the right architecture already.

Recommendation `[reasoning]`: add a **third lane** rather than sharing a pool.
- **Org rules** — unchanged budget. Never let personal memory reduce policy visibility; that's the privilege-laundering risk in token form.
- **Org decisions/facts** — unchanged.
- **Personal** — its own small floor-and-ceiling: roughly **10–20% of the memory budget**, hard-capped, own fenced block (`<your_context>` distinct from `<team_rules>`).

Rationale for a *floor and a ceiling*: `[reasoning]` a floor guarantees the personal tier is actually felt (otherwise it measures as worthless and gets cut); a ceiling guarantees it can never crowd out org policy. Letta's blocks make the cost model explicit — `chars_limit` per block, visible to the model `[verified]` — which is the right instinct: budget is per-lane and legible, not global and emergent.

Sequencing inside the prompt: org rules → org decisions/facts → personal, with personal last. `[reasoning]` Recency-in-context favors the tail for *preferences* (tone, format), while rules benefit from the stable header position; this also means a personal block that gets truncated degrades the least important lane first. SAP's warning applies to both lanes: dumping all potentially relevant knowledge "increases latency, introduces irrelevant information, and may distract the agent" `[verified]`.

Also: label the tier **in the rendered block**. `[reasoning]` The model should know "this is your preference" vs "this is team policy" so it can resolve conflicts the way 2.2 specifies rather than averaging them. And per ChatGPT's sources affordance `[verified]`, the user should be able to see which tier personalized a response — that visibility is a precondition for them trusting the promote button.

### 2.6 Measurement — extending the holdout to prove personal-tier value separately

Our rail: one `run_memory_attributions` row per injected memory, written deterministically post-retrieval (no model in the loop → causal), with `suppressed` recording what *would* have injected under holdout `[verified]`.

Extension `[reasoning]`:
1. **Record tier per attribution row** (`visibility` + whether `owner_user_id` matched the asker). Without this, the personal tier's effect is unrecoverable from existing data — do this in the same migration as the schema change, even if the personal tier ships later, because retrofitting attribution loses the early cohort.
2. **Three-arm holdout, not two.** Independent suppression: `{org on, personal on}`, `{org on, personal off}`, `{org off, personal on}`, `{both off}` — a 2×2 factorial at 10% each rather than one 10% arm. This is the only way to detect **interaction**: the plausible outcome is that personal memory helps *most* where org memory is thin and adds noise where org memory is strong, and a single-arm holdout averages that to zero. `[reasoning]`
3. **Promotion as its own measured object.** Per promoted memory, track: runs influenced before promotion (owner only) vs after (all users), and outcome deltas. `[reasoning]` "Promotion lift" is a metric no competitor can compute, and it's the number that sells the moat: *this org's agents got N% better because one person's private lesson became policy.*
4. **Divergence rate as a leading indicator.** Count private-vs-org conflicts per org per week. `[reasoning]` Rising divergence = stale org memory. This is a *health metric for the org tier derived from the personal tier* — the clearest possible articulation of why the balance is the moat, and a natural dashboard/inbox feed.
5. **Guard the obvious confound.** Personal memory correlates with user tenure and engagement. Randomize suppression **per run within user**, never per user, or the personal-tier arm just measures who your power users are. `[reasoning]`

---

## Part 3 — Ranked recommendations

Ranked by moat value ÷ build cost, on top of what exists today.

**1. Two-column ownership axis + fail-closed dual-lane retrieval.** Add `visibility` (`private|org`, default `org`) + `owner_user_id` with the biconditional CHECK; extend the retrieval index; split retrieval into two lanes with the private lane filtered by `owner_user_id = :asker` and **empty when asker is unknown**. Migration is a no-op for existing rows.
*Exploits:* Mem0's absent tier concept and its null-scoping footgun `[verified]`; Zep's `group_id`-as-partition-not-permission `[reasoning]`; Claude's forced choice between isolation and sharing `[verified]`.
*Why first:* every other item depends on it, and it is the P1 access-authority work rather than a detour from it — the private lane is the strictest case of "retrieval scoped to the asking user's visibility."

**2. Tier-aware attribution (same migration).** Record tier + owner-match on every `run_memory_attributions` row.
*Exploits:* nobody publishes per-tier causal attribution; ChatGPT shows *which* memory was used but not tiered effect `[verified]`.
*Why this high:* it costs a column and is unrecoverable if skipped. Ship it with #1 even if the personal tier is dark.

**3. The Global Curator pass on the Review Inbox.** Before a proposal reaches a human, diff it against existing memory: quality checks in isolation (single rule, clear applicability, meaningful name) + relation checks (duplicate / overlap / conflict, naming the specific colliding memory). Present the verdict inline.
*Exploits:* SAP's architecture, published but unshipped in any product `[verified]`; Mem0's open conflict-resolution gap `[claim]`.
*Why:* this is the only item that pays off **even if the personal tier slips**, and without it promotion volume turns our review gate into a rubber stamp — which would forfeit the propose-only moat we already have.

**4. Divergence detection + personal annotations on org memories.** Nullable `annotates_id` (private child → org parent); detect and log private-vs-org contradictions; inject both with an explicit divergence marker; never let an annotation weaken a `hard` org rule.
*Exploits:* Dust has both halves and no bridge `[verified]`; ChatGPT names contradiction as its known failure and solves it only *within* one user's memory `[verified]`.
*Why:* it manufactures promotion candidates as a byproduct of normal work — the answer to the capture-friction problem — and converts "org memory is stale" from anecdote into a metric.

**5. Review-gated promotion flow with redaction and two consents.** Owner consents to disclosure, org approver consents to authority; promotion emits a new row superseding the private one with `change_reason` + `decided_by`; the reviewer sees private original vs redacted candidate side by side; reuse `proposals`/`source_proposal_id` and `meeting_promotions`-style promote-once idempotency.
*Exploits:* Collaborative Memory automates sharing with no human gate `[verified]`; SAP has the gate but no personal tier `[verified]`; ChatGPT explicitly refuses transfer `[verified]`; Claude ships isolation as the feature `[verified]`. **This is the moat item.**
*Cost:* the highest of the set — hence rank 5, after its prerequisites and after the curator that keeps it from degrading.

**6. Recurrence-triggered promotion candidates.** When k users independently hold semantically equivalent private memories, auto-propose an org rule (never auto-apply), showing the k private originals as evidence.
*Exploits:* structurally impossible for any single-tier system, and for Zep/Letta (no cross-namespace similarity under one authority) `[reasoning]`.
*Why not higher:* needs pgvector over the private lane and a k-threshold tuned on real volume, so it wants #1/#4 in production first. But this is the demo that makes the moat obvious in one screenshot.

**7. Three-lane injection budget with per-lane floor/ceiling and tier labels in the fenced block.** Personal ~10–20% of memory budget, hard-capped, own fence, rendered last, explicitly labeled.
*Exploits:* Letta's per-block char limits are explicit but ungoverned across tiers `[verified]`; SAP's over-retrieval warning `[verified]`.
*Why:* small, and it's what makes the personal tier *feel* present without ever letting it dilute policy.

**8. 2×2 factorial holdout + promotion-lift and divergence-rate metrics; plus a promotion audit view ("what of X's is now org knowledge, and what did it influence").**
*Exploits:* Copilot's oversharing remediation is a separate blueprint bolted on after the fact `[verified]`; Collaborative Memory has provenance for retrospective checks but no product surface `[verified]`.
*Why last:* it needs promotion volume to measure. But the audit view must ship **with** #5, not after — a widening feature without a widening ledger is the Copilot mistake.

### The cheapest v1 slice (ship this first)

**`visibility` + `owner_user_id` + the CHECK + the extended index + dual-lane retrieval with a fail-closed empty private lane + tier recorded on attribution rows.** No UI, no promotion, no redaction, no curator.

Why this is the right cut `[reasoning]`:
- It is a strict subset of the already-filed P1 access-authority work, not competing scope — the private lane is simply the strictest visibility case, and building it forces the fail-closed retrieval path to be correct for a case where the blast radius of a bug is obvious.
- The migration touches zero existing rows (`DEFAULT 'org'`), so it cannot regress the current org tier.
- It ships with tests, not features: the two invariants worth having in CI from day one are *(a) a non-owner's retrieval returns zero private rows* and *(b) memory retrieval surfaces nothing a permission-scoped list query wouldn't* (Slack's invariant, restated).
- It makes #2 free and #4/#5/#6 possible, and it is honestly measurable before any of them exist.
- Given `memories` currently has **0 rows** in the PS store, this is the cheapest moment this migration will ever be — no backfill, no ambiguity about which existing rows were "really" personal. Ship it before capture starts producing volume.

---

## Sources

**Primary docs read**
- Mem0 — [Entity-Scoped Memory](https://docs.mem0.ai/platform/features/entity-scoped-memory) · [Memory Types](https://docs.mem0.ai/core-concepts/memory-types) · [Add Memories API](https://docs.mem0.ai/api-reference/memory/add-memories)
- Letta — [Memory blocks (core memory)](https://docs.letta.com/guides/agents/memory-blocks) · [Shared memory](https://docs.letta.com/guides/agents/multi-agent-shared-memory)
- Zep / Graphiti — [Graph Namespacing](https://help.getzep.com/graphiti/core-concepts/graph-namespacing) · [Key Concepts](https://help.getzep.com/concepts) · [Adding Episodes](https://help.getzep.com/graphiti/core-concepts/adding-episodes) · [Share Memory Across Users Using Group Graphs](https://help.getzep.com/v2/cookbook/how-to-share-memory-across-users-using-group-graphs)
- Glean — [MCP Security, Data Flow, and Permissions](https://docs.glean.com/administration/platform/mcp/security) · [Secure generative AI requires the right permissions structure](https://www.glean.com/blog/secure-generative-ai-for-the-enterprise-requires-the-right-permissions-structure)
- Microsoft — [M365 Copilot architecture and how it works](https://learn.microsoft.com/en-us/copilot/microsoft-365/microsoft-365-copilot-architecture) · [Manage Copilot personalization and memory](https://learn.microsoft.com/en-us/microsoft-365/copilot/copilot-personalization-memory) · [Secure and govern M365 Copilot: foundational deployment guidance](https://learn.microsoft.com/en-us/copilot/microsoft-365/microsoft-365-copilot-blueprint-oversharing)
- OpenAI — [Memory FAQ](https://help.openai.com/en/articles/8590148-memory-faq) · [Memory FAQ (Business version)](https://help.openai.com/en/articles/9295112-memory-faq-business-version)
- Anthropic — [Bringing memory to Claude](https://claude.com/blog/memory)
- Dust — [Agent Memory](https://docs.dust.tt/docs/agent-memory)
- arXiv — [Collaborative Memory: Multi-User Memory Sharing in LLM Agents with Dynamic Access Control (2505.18279)](https://arxiv.org/abs/2505.18279) · [Organizational Memory for Agentic Business Process Execution (2607.03228)](https://arxiv.org/html/2607.03228v1)

**Secondary / not read in full (labeled `[claim]` above)**
- [Dust — Spaces management](https://docs.dust.tt/docs/data) · [Dust — Access Controls and Permissions](https://docs.dust.tt/docs/access-controls-and-permissions)
- [Slack — Security for AI features](https://slack.com/help/articles/28310650165907-Security-for-AI-features-in-Slack) · [Slack Engineering — How we built enterprise search to be secure and private](https://slack.engineering/how-we-built-enterprise-search-to-be-secure-and-private/)
- [Notion — Enterprise Search security & privacy practices](https://www.notion.com/help/enterprise-search-security-and-privacy-practices)
- [Knostic — Glean Secures LLM Search. Who Stops Oversharing?](https://www.knostic.ai/blog/glean-data-security) · [EPC Group — How Copilot exposes overshared SharePoint data](https://www.epcgroup.net/copilot-sharepoint-permissions-oversharing-fix-2026)
- [mem0ai/mem0 issue #4896 — ADD-only architecture doesn't implement conflict resolution](https://github.com/mem0ai/mem0/issues/4896)

**Our own code (verified in-repo)**
- `packages/db/src/schema.ts:488` — `memories` table; `run_memory_attributions`; `meeting_promotions` (content-derived id, composite-unique per tenant); enums `memory_kind`, `memory_status`, `memory_scope_type`, `memory_source_kind`, `memory_enforcement`, `injected_via`
- `retrieveRulesForContext` — scope cascade + separate `DEFAULT_RULES_TOKEN_BUDGET` rules lane, ordered `pinned desc, priority desc, valid_from desc, created_at desc`
