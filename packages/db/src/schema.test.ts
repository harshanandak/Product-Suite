import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import * as schema from './schema'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

describe('workboard schema', () => {
  it('defines migration 0021 command persistence and real work-item versions', () => {
    expect(Object.keys(schema.workItems)).toContain('version')
    expect(schema.commandIdempotency).toBeDefined()
    expect(schema.commandAuditEvents).toBeDefined()

    const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'))
    expect(journal.entries.at(-1)?.tag).toBe('0021_command_kernel')
    const migration = readFileSync(join(MIGRATIONS_DIR, '0021_command_kernel.sql'), 'utf8')
    expect(migration).toContain('command_idempotency')
    expect(migration).toContain('command_audit_events')
    expect(migration).toMatch(/work_items[^;]*add column[^;]*version/i)
    expect(migration).toContain('command_idempotency_scope_uniq')
    expect(migration).toContain('command_audit_events_immutable')
    expect(migration).toMatch(/grant select, insert/i)
  })

  it('exports the workboard tables', () => {
    for (const table of [
      'projects',
      'workItems',
      'checks',
      'workItemDependencies',
      'activityEvents',
    ] as const) {
      expect(schema[table]).toBeDefined()
    }
  })

  it('proposals table exposes the decision-corpus + apply columns', () => {
    const cols = Object.keys(schema.proposals)
    for (const c of [
      'id',
      'tenantId',
      'runId',
      'targetType',
      'targetId',
      'operation',
      'payload',
      'riskLevel',
      'status',
      'decidedBy',
      'editedPayload',
      'rejectionReason',
      'targetVersion',
      'modelId',
      'promptVersion',
      'contextRef',
      'actorType',
    ]) {
      expect(cols).toContain(c)
    }
    expect(schema.proposalStatusEnum.enumValues).toEqual([
      'pending',
      'accepted',
      'accepted_with_edits',
      'rejected',
      'superseded',
      'expired',
      'applied',
      'failed',
    ])
    expect(Object.keys(schema.workItems)).toContain('appliedFromProposalId')
  })

  it('agent_runs exposes the transcript column for decision-corpus capture', () => {
    // The full messages+tool-calls array is written at run end (design §13), so a
    // completed run is a self-contained, replayable record of what the agent did.
    expect(Object.keys(schema.agentRuns)).toContain('transcript')
  })

  it('agent_runs exposes the memory_holdout flag (P2 holdout, always false in P1)', () => {
    expect(Object.keys(schema.agentRuns)).toContain('memoryHoldout')
  })

  it('memories exposes the supersession chain + scope + provenance columns', () => {
    const cols = Object.keys(schema.memories)
    for (const c of [
      'id',
      'tenantId',
      'kind',
      'title',
      'body',
      'attrs',
      'rootId',
      'supersedesId',
      'supersededById',
      'changeReason',
      'validFrom',
      'status',
      'waitingOn',
      'reviewAfter',
      'scopeType',
      'scopeId',
      'topics',
      'sourceKind',
      'sourceRunId',
      'sourceProposalId',
      'sourceQuote',
      'createdBy',
      'decidedBy',
      'pinned',
      'priority',
      'enforcement',
    ]) {
      expect(cols).toContain(c)
    }
    expect(schema.memoryKindEnum.enumValues).toEqual(['decision', 'fact', 'rule'])
    expect(schema.memoryStatusEnum.enumValues).toEqual(['active', 'superseded', 'retracted', 'deferred'])
    expect(schema.memoryScopeTypeEnum.enumValues).toEqual(['org', 'project', 'work_item_type', 'work_item'])
    expect(schema.memorySourceKindEnum.enumValues).toEqual([
      'meeting',
      'chat',
      'proposal',
      'manual',
      'import',
    ])
  })

  it('run_memory_attributions is the moat rail (run/memory/tenant/injected_via)', () => {
    const cols = Object.keys(schema.runMemoryAttributions)
    for (const c of ['id', 'runId', 'memoryId', 'tenantId', 'injectedVia', 'rank', 'tokens', 'suppressed']) {
      expect(cols).toContain(c)
    }
    expect(schema.injectedViaEnum.enumValues).toEqual(['pinned', 'retrieved', 'tool'])
  })

  it('memories carries the ORTHOGONAL ownership axis (visibility + owner_user_id)', () => {
    const cols = Object.keys(schema.memories)
    expect(cols).toContain('visibility')
    expect(cols).toContain('ownerUserId')
    // Two values only in v1: a third ('team') would need a group-membership
    // resolver, which is a separate problem.
    expect(schema.memoryVisibilityEnum.enumValues).toEqual(['private', 'org'])

    const byName = new Map(getTableConfig(schema.memories).columns.map((c) => [c.name, c]))
    const visibility = byName.get('visibility')
    // NOT NULL with DEFAULT 'org' is what makes the migration touch ZERO existing rows.
    expect(visibility?.notNull).toBe(true)
    expect(visibility?.default).toBe('org')
    // The owner is nullable (an org memory has none) and lives in the same TEXT key
    // space as created_by/decided_by — Clerk user ids, not uuids.
    expect(byName.get('owner_user_id')?.notNull).toBe(false)
    expect(byName.get('owner_user_id')?.getSQLType()).toBe('text')
  })

  it('the retrieval index covers the visibility predicate (private lane is indexable)', () => {
    const idx = getTableConfig(schema.memories).indexes.find(
      (i) => i.config.name === 'memories_tenant_visibility_scope_idx',
    )
    expect(idx).toBeDefined()
    expect(idx?.config.columns.map((c) => (c as { name: string }).name)).toEqual([
      'tenant_id',
      'status',
      'visibility',
      'owner_user_id',
      'scope_type',
      'scope_id',
    ])
  })

  it('run_memory_attributions records the TIER of every injected memory', () => {
    const cols = Object.keys(schema.runMemoryAttributions)
    // Rec #2: unrecoverable if skipped — ships in the same migration as the axis
    // even while nothing writes private rows, because retrofitting attribution
    // loses the early cohort.
    expect(cols).toContain('visibility')
    expect(cols).toContain('ownerMatched')

    const byName = new Map(getTableConfig(schema.runMemoryAttributions).columns.map((c) => [c.name, c]))
    expect(byName.get('visibility')?.notNull).toBe(true)
    expect(byName.get('visibility')?.default).toBe('org')
    expect(byName.get('owner_matched')?.notNull).toBe(true)
    expect(byName.get('owner_matched')?.default).toBe(false)
  })

  it('the ownership-axis migration is journalled and enforces the biconditional CHECK', () => {
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'))
    const entry = journal.entries.find((e: { tag: string }) => e.tag.endsWith('_memory_ownership_axis'))
    expect(entry).toBeDefined()
    const sql = readFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), 'utf8')
    // DEFAULT 'org' — the no-op-for-existing-rows guarantee.
    expect(sql).toMatch(/add column if not exists "visibility"[^;]*default 'org'[^;]*not null/i)
    expect(sql).toMatch(/add column if not exists "owner_user_id" text/i)
    // The privacy boundary is a DB constraint, not a convention: a private memory
    // MUST have an owner and an org memory MUST NOT.
    expect(sql).toContain('memories_private_requires_owner')
    expect(sql).toMatch(/check\s*\(\s*\("visibility" = 'private'\)\s*=\s*\("owner_user_id" is not null\)\s*\)/i)
    expect(sql).toMatch(/create index if not exists "memories_tenant_visibility_scope_idx"/i)
    // Tier on the attribution rail, same migration.
    expect(sql).toMatch(/alter table "run_memory_attributions" add column if not exists "visibility"/i)
    expect(sql).toMatch(/alter table "run_memory_attributions" add column if not exists "owner_matched"/i)
  })

  it('meeting_promotions is the dedup ledger keyed by the meeting record id', () => {
    const cols = Object.keys(schema.meetingPromotions)
    for (const c of ['meetingRecordId', 'tenantId', 'proposalId', 'createdAt']) {
      expect(cols).toContain(c)
    }

    const config = getTableConfig(schema.meetingPromotions)
    const byName = new Map(config.columns.map((c) => [c.name, c]))
    // The ledger key holds meeting-api's content-derived id — TEXT, never a uuid.
    expect(byName.get('meeting_record_id')?.getSQLType()).toBe('text')
    expect(byName.get('tenant_id')?.getSQLType()).toBe('text')
    expect(byName.get('proposal_id')?.getSQLType()).toBe('uuid')
  })

  it('meeting_promotions dedups per TENANT, not globally', () => {
    const config = getTableConfig(schema.meetingPromotions)
    const unique = config.indexes.filter((idx) => idx.config.unique)
    expect(unique).toHaveLength(1)
    // Composite, and in this order: a content-derived id that collides across
    // tenants must not make one tenant's candidate skip the other's.
    expect(unique[0]?.config.columns.map((c) => (c as { name: string }).name)).toEqual([
      'tenant_id',
      'meeting_record_id',
    ])
  })

  it('meeting_promotions declares the FK to proposals (a ledger row without one is meaningless)', () => {
    const config = getTableConfig(schema.meetingPromotions)
    const fks = config.foreignKeys.map((fk) => fk.reference())
    const toProposals = fks.find((ref) => getTableConfig(ref.foreignTable).name === 'proposals')
    expect(toProposals).toBeDefined()
    expect(toProposals?.columns.map((c) => c.name)).toEqual(['proposal_id'])
    expect(toProposals?.foreignColumns.map((c) => c.name)).toEqual(['id'])
  })

  it('the meeting_promotions migration is journalled (parity)', () => {
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'))
    const entry = journal.entries.find((e: { tag: string }) => e.tag.endsWith('_meeting_promotions'))
    expect(entry).toBeDefined()
    const sql = readFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), 'utf8')
    expect(sql).toContain('meeting_promotions')
    expect(sql).toMatch(/create unique index[^;]*"tenant_id"\s*,\s*"meeting_record_id"/i)
  })

  it('mirrors the @product-suite/contracts enum values exactly', () => {
    expect(schema.phaseEnum.enumValues).toEqual(['plan', 'execute', 'review', 'done'])
    expect(schema.checkStatusEnum.enumValues).toEqual(['todo', 'in_progress', 'completed'])
    expect(schema.priorityEnum.enumValues).toEqual(['critical', 'high', 'medium', 'low'])
    expect(schema.workItemTypeEnum.enumValues).toEqual(['feature', 'bug', 'chore', 'research'])
    expect(schema.workItemSourceEnum.enumValues).toEqual(['manual', 'meeting', 'agent', 'feedback'])
    expect(schema.dependencyRelationshipEnum.enumValues).toEqual(['depends_on', 'blocks', 'complements'])
    expect(schema.activityEventKindEnum.enumValues).toEqual([
      'created',
      'updated',
      'dependency_added',
      'dependency_removed',
    ])
  })
  it('defines the tenant-safe collaboration authority tables', () => {
    expect(schema.collaborationActorKindEnum.enumValues).toEqual(['human', 'agent', 'service'])
    expect(schema.conversationMembershipRoleEnum.enumValues).toEqual(['reader', 'writer', 'admin'])
    expect(schema.conversationEventKindEnum.enumValues).toEqual([
      'message.created',
      'message.edited',
      'message.deleted',
      'membership.added',
      'membership.changed',
      'membership.removed',
    ])
    for (const table of ['collaborationActors', 'conversations', 'conversationMemberships', 'conversationEvents'] as const) {
      expect(schema[table]).toBeDefined()
      expect(Object.keys(schema[table])).toContain('tenantId')
    }
    expect(Object.keys(schema.agentRuns)).toContain('conversationId')
    const agentRunConversation = getTableConfig(schema.agentRuns).foreignKeys
      .map((key) => key.reference())
      .find((reference) => reference.name === 'agent_runs_tenant_conversation_fk')
    expect(agentRunConversation?.columns.map((column) => column.name)).toEqual(['tenant_id', 'conversation_id'])
    expect(agentRunConversation?.foreignColumns.map((column) => column.name)).toEqual(['tenant_id', 'id'])
  })

  it('enforces collaboration sequence, idempotency, and tenant constraints in migration 0018', () => {
    const eventForeignKeys = new Map(
      getTableConfig(schema.conversationEvents).foreignKeys.map((key) => {
        const reference = key.reference()
        return [reference.name, {
          columns: reference.columns.map((column) => column.name),
          foreignColumns: reference.foreignColumns.map((column) => column.name),
        }]
      }),
    )
    expect(eventForeignKeys.get('conversation_events_tenant_reply_fk')).toEqual({
      columns: ['tenant_id', 'conversation_id', 'reply_to_event_id'],
      foreignColumns: ['tenant_id', 'conversation_id', 'id'],
    })
    expect(eventForeignKeys.get('conversation_events_tenant_target_fk')).toEqual({
      columns: ['tenant_id', 'conversation_id', 'target_event_id'],
      foreignColumns: ['tenant_id', 'conversation_id', 'id'],
    })

    const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'))
    const entry = journal.entries.find((e: { tag: string }) => e.tag.endsWith('_collaboration_fabric'))
    expect(entry).toBeDefined()
    const migration = readFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), 'utf8')
    expect(migration).toContain('conversation_events_tenant_conversation_sequence_uniq')
    expect(migration).toContain('conversation_events_tenant_conversation_idempotency_uniq')
    expect(migration).toContain('conversation_memberships_tenant_conversation_actor_uniq')
    expect(migration).toContain('conversation_events_immutable')
    expect(migration).toMatch(/before update or delete on "conversation_events"/i)
    expect(migration).toMatch(/conversation_events_tenant_conversation_fk[^\n]*on delete restrict/i)
    expect(migration).toMatch(/foreign key \("tenant_id","conversation_id"\)/i)
    expect(migration).toMatch(/foreign key \("tenant_id","actor_id"\)/i)
    expect(migration).toMatch(/foreign key \("tenant_id","conversation_id","reply_to_event_id"\)/i)
    expect(migration).toMatch(/foreign key \("tenant_id","conversation_id","target_event_id"\)/i)
    expect(migration).toContain('conversation_events_payload_size_check')
    expect(migration).toContain('conversation_events_references_size_check')
    expect(migration).not.toContain('conversation_events_tenant_conversation_cursor_idx')
    expect(migration).toMatch(/alter table "agent_runs" add column if not exists "conversation_id" uuid/i)
    expect(migration).toMatch(/agent_runs_tenant_conversation_fk[^\n]*foreign key \("tenant_id","conversation_id"\)[^\n]*on delete restrict/i)
    expect(migration).not.toMatch(/drop table|drop column/i)
  })

  it('exports the complete canonical Meeting and identity model', () => {
    for (const table of [
      'users',
      'tenants',
      'meetings',
      'transcriptSegments',
      'summaries',
      'chatMessages',
      'jobs',
      'meetingState',
      'chapterSummaries',
      'decisions',
      'actionItems',
      'openQuestions',
      'audioAssets',
      'agentInvocations',
      'agentResponses',
      'meetingLinks',
      'userAuthIdentities',
      'organizationMemberships',
      'organizationInvitations',
    ] as const) {
      expect(schema[table]).toBeDefined()
    }
    expect(Object.keys(schema.meetings)).toEqual(expect.arrayContaining([
      'tenantId',
      'visibility',
      'tags',
      'participantLabels',
      'primaryLanguage',
      'buddyMode',
    ]))
    expect(Object.keys(schema.chapterSummaries)).toEqual(expect.arrayContaining([
      'embedding',
      'windowLabel',
      'boundarySource',
    ]))
    expect(Object.keys(schema.organizationInvitations)).toEqual(expect.arrayContaining([
      'tokenHash',
      'expiresAt',
      'acceptedAt',
    ]))
  })
})
