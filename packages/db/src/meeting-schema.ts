import { sql } from 'drizzle-orm'
import {
  check,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

/**
 * The meeting and identity tables already present in the Neon `public` schema.
 *
 * These are deliberately modeled separately from the workboard tables in
 * `schema.ts`: the model is one Drizzle plane, while this split keeps the
 * historical Meeting ownership boundary visible to reviewers.  The migration
 * checkpoint is additive and does not backfill or rewrite any of these rows.
 */

const vector = customType<{ data: number[]; driverData: string }>({
  dataType: () => 'vector(1536)',
  toDriver: (value) => `[${value.join(',')}]`,
  fromDriver: (value) => String(value).slice(1, -1).split(',').filter(Boolean).map(Number),
})

const textArray = () => text().array().notNull().default(sql`'{}'`)
const jsonArray = (name: string) => jsonb(name).notNull().default(sql`'[]'::jsonb`)

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text('name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    emailUnique: unique('users_email_key').on(table.email),
    emailSearch: index('idx_users_email').on(sql`lower(${table.email})`),
  }),
)

export const tenants = pgTable(
  'tenants',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({ slugUnique: unique('tenants_slug_key').on(table.slug) }),
)

export const meetings = pgTable(
  'meetings',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id'),
    title: text('title').notNull(),
    status: text('status').notNull(),
    engine: text('engine').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    durationSeconds: integer('duration_seconds').notNull().default(0),
    segmentCount: integer('segment_count').notNull().default(0),
    tenantId: text('tenant_id'),
    visibility: text('visibility').notNull().default('private'),
    projectName: text('project_name'),
    tags: textArray(),
    participantLabels: text('participant_labels').array().notNull().default(sql`'{}'`),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    primaryLanguage: text('primary_language').notNull().default('unknown'),
    buddyMode: text('buddy_mode').notNull().default('addressable'),
  },
)

export const transcriptSegments = pgTable(
  'transcript_segments',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id'),
    meetingId: text('meeting_id').notNull(),
    speakerLabel: text('speaker_label').notNull(),
    text: text('text').notNull(),
    timestampStart: doublePrecision('timestamp_start').notNull().default(0),
    timestampEnd: doublePrecision('timestamp_end').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    languageCode: text('language_code').notNull().default('unknown'),
    translatedText: text('translated_text'),
    tenantId: text('tenant_id'),
  },
)

export const summaries = pgTable(
  'summaries',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id'),
    meetingId: text('meeting_id').notNull(),
    summaryText: text('summary_text').notNull(),
    actionItems: text('action_items').array().notNull().default(sql`'{}'`),
    keyTopics: text('key_topics').array().notNull().default(sql`'{}'`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    tenantId: text('tenant_id'),
  },
  (table) => ({
    meetingUnique: unique('summaries_meeting_id_key').on(table.meetingId),
    byMeeting: index('idx_summaries_meeting_id').on(table.meetingId),
  }),
)

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id'),
    meetingId: text('meeting_id').notNull(),
    role: text('role').notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    tenantId: text('tenant_id'),
  },
)

export const jobs = pgTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id').notNull(),
    meetingId: text('meeting_id'),
    jobType: text('job_type').notNull(),
    status: text('status').notNull(),
    stage: text('stage').notNull(),
    elapsedMs: integer('elapsed_ms').notNull().default(0),
    error: text('error'),
    retryCount: integer('retry_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    tenantId: text('tenant_id'),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    result: jsonb('result').notNull().default(sql`'{}'::jsonb`),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    idempotencyKey: text('idempotency_key'),
  },
  (table) => ({
    byOwnerCreated: index('idx_jobs_owner_created_at').on(table.ownerUserId, table.createdAt),
    byMeetingStatusScheduled: index('idx_jobs_meeting_status_scheduled_at').on(
      table.meetingId,
      table.status,
      table.scheduledAt,
    ),
    idempotencyUnique: uniqueIndex('idx_jobs_idempotency_key')
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
  }),
)

export const meetingState = pgTable('meeting_state', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  meetingId: text('meeting_id').notNull(),
  windowStart: doublePrecision('window_start').notNull().default(0),
  windowEnd: doublePrecision('window_end').notNull().default(0),
  currentTopic: text('current_topic'),
  currentGoal: text('current_goal'),
  summaryBullets: jsonArray('summary_bullets'),
  decisionsForming: jsonArray('decisions_forming'),
  blockers: jsonArray('blockers'),
  openQuestions: jsonArray('open_questions'),
  activeActionItems: jsonArray('active_action_items'),
  confidence: doublePrecision('confidence').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const chapterSummaries = pgTable(
  'chapter_summaries',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    meetingId: text('meeting_id').notNull(),
    chapterIndex: integer('chapter_index').notNull(),
    windowStart: doublePrecision('window_start').notNull().default(0),
    windowEnd: doublePrecision('window_end').notNull().default(0),
    title: text('title'),
    summaryText: text('summary_text').notNull(),
    decisions: jsonArray('decisions'),
    actionItems: jsonArray('action_items'),
    openQuestions: jsonArray('open_questions'),
    referenceRefs: jsonArray('reference_refs'),
    embedding: vector('embedding'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    windowLabel: text('window_label'),
    boundarySource: text('boundary_source'),
  },
)

const intelligenceColumns = {
  confidence: doublePrecision('confidence').notNull().default(0),
  promotionReason: text('promotion_reason'),
  sourceWindowStart: doublePrecision('source_window_start'),
  sourceWindowEnd: doublePrecision('source_window_end'),
}

export const decisions = pgTable('decisions', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  meetingId: text('meeting_id').notNull(),
  chapterSummaryId: text('chapter_summary_id'),
  text: text('text').notNull(),
  status: text('status').notNull().default('open'),
  ownerUserId: text('owner_user_id'),
  evidenceRefs: jsonArray('evidence_refs'),
  recordOrigin: text('record_origin').notNull().default('generated'),
  reviewStatus: text('review_status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  ...intelligenceColumns,
})

export const actionItems = pgTable('action_items', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  meetingId: text('meeting_id').notNull(),
  chapterSummaryId: text('chapter_summary_id'),
  text: text('text').notNull(),
  status: text('status').notNull().default('open'),
  ownerUserId: text('owner_user_id'),
  dueAt: timestamp('due_at', { withTimezone: true }),
  evidenceRefs: jsonArray('evidence_refs'),
  recordOrigin: text('record_origin').notNull().default('generated'),
  reviewStatus: text('review_status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  ...intelligenceColumns,
})

export const openQuestions = pgTable('open_questions', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  meetingId: text('meeting_id').notNull(),
  chapterSummaryId: text('chapter_summary_id'),
  text: text('text').notNull(),
  status: text('status').notNull().default('open'),
  evidenceRefs: jsonArray('evidence_refs'),
  recordOrigin: text('record_origin').notNull().default('generated'),
  reviewStatus: text('review_status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  ...intelligenceColumns,
})

export const audioAssets = pgTable('audio_assets', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  meetingId: text('meeting_id').notNull(),
  storagePath: text('storage_path').notNull(),
  kind: text('kind').notNull(),
  mimeType: text('mime_type').notNull(),
  durationMs: integer('duration_ms').notNull().default(0),
  retentionExpiresAt: timestamp('retention_expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const agentInvocations = pgTable('agent_invocations', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  meetingId: text('meeting_id').notNull(),
  speakerLabel: text('speaker_label'),
  triggerText: text('trigger_text').notNull(),
  detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
  status: text('status').notNull().default('captured'),
})

export const agentResponses = pgTable('agent_responses', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  meetingId: text('meeting_id').notNull(),
  invocationId: text('invocation_id'),
  responseText: text('response_text').notNull(),
  responseAudioAssetId: text('response_audio_asset_id'),
  sourceKind: text('source_kind').notNull().default('meeting'),
  toolRefs: jsonArray('tool_refs'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const meetingLinks = pgTable('meeting_links', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  meetingId: text('meeting_id').notNull(),
  linkedMeetingId: text('linked_meeting_id').notNull(),
  reason: text('reason').notNull(),
  score: doublePrecision('score').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const userAuthIdentities = pgTable(
  'user_auth_identities',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    provider: text('provider').notNull(),
    providerUserId: text('provider_user_id').notNull(),
    providerEmail: text('provider_email'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    providerIdentityUnique: unique('user_auth_identities_provider_provider_user_id_key').on(
      table.provider,
      table.providerUserId,
    ),
    byUser: index('idx_user_auth_identities_user_id').on(table.userId),
  }),
)

export const organizationMemberships = pgTable(
  'organization_memberships',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    role: text('role').notNull().default('member'),
    status: text('status').notNull().default('active'),
    invitedByUserId: text('invited_by_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    canonicalRole: check(
      'organization_memberships_role_canonical',
      sql`${table.role} in ('viewer', 'member', 'admin', 'owner')`,
    ),
    tenantUserUnique: unique('organization_memberships_tenant_id_user_id_key').on(table.tenantId, table.userId),
    byTenantUser: index('idx_org_memberships_tenant_user').on(table.tenantId, table.userId),
  }),
)

export const organizationInvitations = pgTable(
  'organization_invitations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    email: text('email').notNull(),
    role: text('role').notNull().default('member'),
    tokenHash: text('token_hash').notNull(),
    status: text('status').notNull().default('pending'),
    invitedByUserId: text('invited_by_user_id'),
    acceptedByUserId: text('accepted_by_user_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    tokenUnique: unique('organization_invitations_token_hash_key').on(table.tokenHash),
    byTenantEmailStatus: index('idx_org_invites_tenant_email_status').on(table.tenantId, table.email, table.status),
    pendingUnique: uniqueIndex('idx_org_invites_tenant_email_pending')
      .on(table.tenantId, table.email)
      .where(sql`${table.status} = 'pending'`),
  }),
)

export const meetingTables = {
  users,
  tenants,
  meetings,
  transcriptSegments,
  summaries,
  chatMessages,
  jobs,
  meetingState,
  chapterSummaries,
  decisions,
  actionItems,
  openQuestions,
  audioAssets,
  agentInvocations,
  agentResponses,
  meetingLinks,
  userAuthIdentities,
  organizationMemberships,
  organizationInvitations,
} as const
