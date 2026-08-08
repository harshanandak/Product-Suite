BEGIN;--> statement-breakpoint
-- Generated from the real 0011 Drizzle snapshot; this checkpoint is the first
-- complete post-reconciliation snapshot.  It is additive and row-preserving.
DO $$
DECLARE
  required_name text;
  role_record record;
BEGIN
  FOREACH required_name IN ARRAY ARRAY['product_suite_platform_runtime', 'product_suite_meeting_runtime'] LOOP
    SELECT rolcanlogin, rolsuper INTO role_record
      FROM pg_catalog.pg_roles WHERE rolname = required_name;
    IF NOT FOUND OR role_record.rolcanlogin OR role_record.rolsuper THEN
      RAISE EXCEPTION 'required runtime role % must pre-exist as NOLOGIN', required_name
        USING ERRCODE = 'P0001', DETAIL = 'role preflight failed before object DDL';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_auth_members members
      JOIN pg_catalog.pg_roles granted ON granted.oid = members.roleid
      JOIN pg_catalog.pg_roles member ON member.oid = members.member
      WHERE member.rolname = required_name
        AND granted.rolname IN ('postgres', 'neondb_owner', 'neondb_admin', 'rds_superuser')
    ) THEN
      RAISE EXCEPTION 'runtime role % has unauthorized administrative membership', required_name
        USING ERRCODE = 'P0001', DETAIL = 'role preflight failed before object DDL';
    END IF;
  END LOOP;
END $$;--> statement-breakpoint


CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."actor_type" AS ENUM('human', 'agent', 'system', 'import');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."agent_run_kind" AS ENUM('chat', 'agent_run');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."agent_run_status" AS ENUM('running', 'completed', 'failed', 'canceled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."collaboration_actor_kind" AS ENUM('human', 'agent', 'service');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."conversation_event_kind" AS ENUM('message.created', 'message.edited', 'message.deleted', 'membership.added', 'membership.changed', 'membership.removed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."conversation_membership_role" AS ENUM('reader', 'writer', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."conversation_membership_status" AS ENUM('active', 'removed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."conversation_status" AS ENUM('active', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."injected_via" AS ENUM('pinned', 'retrieved', 'tool');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."memory_enforcement" AS ENUM('advisory', 'hard');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."memory_kind" AS ENUM('decision', 'fact', 'rule');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."memory_scope_type" AS ENUM('org', 'project', 'work_item_type', 'work_item');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."memory_source_kind" AS ENUM('meeting', 'chat', 'proposal', 'manual', 'import');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."memory_status" AS ENUM('active', 'superseded', 'retracted', 'deferred');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."memory_visibility" AS ENUM('private', 'org');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."proposal_status" AS ENUM('pending', 'accepted', 'accepted_with_edits', 'rejected', 'superseded', 'expired', 'applied', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"triggered_by" text NOT NULL,
	"kind" "agent_run_kind" NOT NULL,
	"status" "agent_run_status" DEFAULT 'running' NOT NULL,
	"summary" text,
	"transcript" jsonb,
	"thread_id" uuid,
	"conversation_id" uuid,
	"memory_holdout" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"linked_object" jsonb,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "collaboration_actors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"kind" "collaboration_actor_kind" NOT NULL,
	"owning_domain" text NOT NULL,
	"owning_id" text NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collaboration_actors_tenant_id_uniq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"sequence" bigint NOT NULL,
	"idempotency_key" text NOT NULL,
	"kind" "conversation_event_kind" NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reply_to_event_id" uuid,
	"target_event_id" uuid,
	"references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_events_tenant_conversation_id_uniq" UNIQUE("tenant_id","conversation_id","id"),
	CONSTRAINT "conversation_events_payload_size_check" CHECK (octet_length("conversation_events"."payload"::text) <= 262144),
	CONSTRAINT "conversation_events_references_size_check" CHECK (jsonb_typeof("conversation_events"."references") = 'array' and octet_length("conversation_events"."references"::text) <= 65536)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversation_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"role" "conversation_membership_role" NOT NULL,
	"status" "conversation_membership_status" DEFAULT 'active' NOT NULL,
	"created_by_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"status" "conversation_status" DEFAULT 'active' NOT NULL,
	"subject_ref" jsonb,
	"created_by_actor_id" uuid NOT NULL,
	"next_sequence" bigint DEFAULT 1 NOT NULL,
	"legacy_source" text,
	"legacy_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_tenant_id_uniq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_ref" text NOT NULL,
	"chunk_index" integer DEFAULT 0 NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"tier" integer NOT NULL,
	"scope_type" text DEFAULT 'org' NOT NULL,
	"scope_id" uuid,
	"topics" text[] DEFAULT '{}'::text[] NOT NULL,
	"event_time" timestamp with time zone,
	"embed_provider" text NOT NULL,
	"embed_model" text NOT NULL,
	"embed_dims" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meeting_promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"meeting_record_id" text NOT NULL,
	"proposal_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"kind" "memory_kind" NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"attrs" jsonb,
	"root_id" uuid NOT NULL,
	"supersedes_id" uuid,
	"superseded_by_id" uuid,
	"change_reason" text,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "memory_status" DEFAULT 'active' NOT NULL,
	"waiting_on" text,
	"review_after" timestamp with time zone,
	"scope_type" "memory_scope_type" DEFAULT 'org' NOT NULL,
	"scope_id" uuid,
	"visibility" "memory_visibility" DEFAULT 'org' NOT NULL,
	"owner_user_id" text,
	"topics" text[] DEFAULT '{}'::text[] NOT NULL,
	"source_kind" "memory_source_kind" DEFAULT 'manual' NOT NULL,
	"source_run_id" uuid,
	"source_proposal_id" uuid,
	"source_quote" text,
	"created_by" text,
	"decided_by" text,
	"pinned" boolean DEFAULT false NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"enforcement" "memory_enforcement" DEFAULT 'advisory' NOT NULL,
	"embed_model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"run_id" uuid,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"operation" text NOT NULL,
	"payload" jsonb NOT NULL,
	"rationale" text,
	"confidence" real,
	"risk_level" text,
	"status" "proposal_status" DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"edited_payload" jsonb,
	"reflected_at" timestamp with time zone,
	"rejection_reason" text,
	"applied_write" jsonb,
	"target_version" bigint,
	"target_snapshot" jsonb,
	"model_id" text,
	"prompt_version" text,
	"context_ref" text,
	"actor_type" "actor_type" DEFAULT 'agent' NOT NULL,
	"actor_id" text,
	"on_behalf_of" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "run_knowledge_attributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"tenant_id" text NOT NULL,
	"memory_id" uuid,
	"chunk_id" uuid,
	"kind" text NOT NULL,
	"rank" integer,
	"score" real,
	"suppressed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "run_memory_attributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"memory_id" uuid NOT NULL,
	"tenant_id" text NOT NULL,
	"injected_via" "injected_via" NOT NULL,
	"rank" integer,
	"tokens" integer,
	"suppressed" boolean DEFAULT false NOT NULL,
	"visibility" "memory_visibility" DEFAULT 'org' NOT NULL,
	"owner_matched" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "action_items" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"meeting_id" text NOT NULL,
	"chapter_summary_id" text,
	"text" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"owner_user_id" text,
	"due_at" timestamp with time zone,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"record_origin" text DEFAULT 'generated' NOT NULL,
	"review_status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confidence" double precision DEFAULT 0 NOT NULL,
	"promotion_reason" text,
	"source_window_start" double precision,
	"source_window_end" double precision
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_invocations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"meeting_id" text NOT NULL,
	"speaker_label" text,
	"trigger_text" text NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'captured' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_responses" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"meeting_id" text NOT NULL,
	"invocation_id" text,
	"response_text" text NOT NULL,
	"response_audio_asset_id" text,
	"source_kind" text DEFAULT 'meeting' NOT NULL,
	"tool_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audio_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"meeting_id" text NOT NULL,
	"storage_path" text NOT NULL,
	"kind" text NOT NULL,
	"mime_type" text NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"retention_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chapter_summaries" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"meeting_id" text NOT NULL,
	"chapter_index" integer NOT NULL,
	"window_start" double precision DEFAULT 0 NOT NULL,
	"window_end" double precision DEFAULT 0 NOT NULL,
	"title" text,
	"summary_text" text NOT NULL,
	"decisions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"action_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"open_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reference_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"window_label" text,
	"boundary_source" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text,
	"meeting_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"tenant_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"meeting_id" text NOT NULL,
	"chapter_summary_id" text,
	"text" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"owner_user_id" text,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"record_origin" text DEFAULT 'generated' NOT NULL,
	"review_status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confidence" double precision DEFAULT 0 NOT NULL,
	"promotion_reason" text,
	"source_window_start" double precision,
	"source_window_end" double precision
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"meeting_id" text,
	"job_type" text NOT NULL,
	"status" text NOT NULL,
	"stage" text NOT NULL,
	"elapsed_ms" integer DEFAULT 0 NOT NULL,
	"error" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"tenant_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"idempotency_key" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meeting_links" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"meeting_id" text NOT NULL,
	"linked_meeting_id" text NOT NULL,
	"reason" text NOT NULL,
	"score" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meeting_state" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"meeting_id" text NOT NULL,
	"window_start" double precision DEFAULT 0 NOT NULL,
	"window_end" double precision DEFAULT 0 NOT NULL,
	"current_topic" text,
	"current_goal" text,
	"summary_bullets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decisions_forming" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"blockers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"open_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active_action_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meetings" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"engine" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"duration_seconds" integer DEFAULT 0 NOT NULL,
	"segment_count" integer DEFAULT 0 NOT NULL,
	"tenant_id" text,
	"visibility" text DEFAULT 'private' NOT NULL,
	"project_name" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"participant_labels" text[] DEFAULT '{}' NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"primary_language" text DEFAULT 'unknown' NOT NULL,
	"buddy_mode" text DEFAULT 'addressable' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "open_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"meeting_id" text NOT NULL,
	"chapter_summary_id" text,
	"text" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"record_origin" text DEFAULT 'generated' NOT NULL,
	"review_status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confidence" double precision DEFAULT 0 NOT NULL,
	"promotion_reason" text,
	"source_window_start" double precision,
	"source_window_end" double precision
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"invited_by_user_id" text,
	"accepted_by_user_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "organization_invitations_token_hash_key" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"invited_by_user_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "organization_memberships_tenant_id_user_id_key" UNIQUE("tenant_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "summaries" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text,
	"meeting_id" text NOT NULL,
	"summary_text" text NOT NULL,
	"action_items" text[] DEFAULT '{}' NOT NULL,
	"key_topics" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"tenant_id" text,
	CONSTRAINT "summaries_meeting_id_key" UNIQUE("meeting_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_key" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transcript_segments" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text,
	"meeting_id" text NOT NULL,
	"speaker_label" text NOT NULL,
	"text" text NOT NULL,
	"timestamp_start" double precision DEFAULT 0 NOT NULL,
	"timestamp_end" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"language_code" text DEFAULT 'unknown' NOT NULL,
	"translated_text" text,
	"tenant_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_auth_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_user_id" text NOT NULL,
	"provider_email" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_auth_identities_provider_provider_user_id_key" UNIQUE("provider","provider_user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "users_email_key" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "activity_events" ADD COLUMN IF NOT EXISTS "actor_type" "actor_type" DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_events" ADD COLUMN IF NOT EXISTS "actor_id" text;--> statement-breakpoint
ALTER TABLE "activity_events" ADD COLUMN IF NOT EXISTS "on_behalf_of" text;--> statement-breakpoint
ALTER TABLE "activity_events" ADD COLUMN IF NOT EXISTS "run_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "actor_type" "actor_type" DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "actor_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "on_behalf_of" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "run_id" uuid;--> statement-breakpoint
ALTER TABLE "statuses" ADD COLUMN IF NOT EXISTS "actor_type" "actor_type" DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "statuses" ADD COLUMN IF NOT EXISTS "actor_id" text;--> statement-breakpoint
ALTER TABLE "statuses" ADD COLUMN IF NOT EXISTS "on_behalf_of" text;--> statement-breakpoint
ALTER TABLE "statuses" ADD COLUMN IF NOT EXISTS "run_id" uuid;--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN IF NOT EXISTS "actor_type" "actor_type" DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN IF NOT EXISTS "actor_id" text;--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN IF NOT EXISTS "on_behalf_of" text;--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN IF NOT EXISTS "run_id" uuid;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "actor_type" "actor_type" DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "actor_id" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "on_behalf_of" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "run_id" uuid;--> statement-breakpoint
ALTER TABLE "work_item_dependencies" ADD COLUMN IF NOT EXISTS "actor_type" "actor_type" DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_item_dependencies" ADD COLUMN IF NOT EXISTS "actor_id" text;--> statement-breakpoint
ALTER TABLE "work_item_dependencies" ADD COLUMN IF NOT EXISTS "on_behalf_of" text;--> statement-breakpoint
ALTER TABLE "work_item_dependencies" ADD COLUMN IF NOT EXISTS "run_id" uuid;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "applied_from_proposal_id" uuid;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "actor_type" "actor_type" DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "actor_id" text;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "on_behalf_of" text;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "run_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_tenant_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_tenant_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_tenant_actor_fk" FOREIGN KEY ("tenant_id","actor_id") REFERENCES "public"."collaboration_actors"("tenant_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_tenant_reply_fk" FOREIGN KEY ("tenant_id","conversation_id","reply_to_event_id") REFERENCES "public"."conversation_events"("tenant_id","conversation_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_tenant_target_fk" FOREIGN KEY ("tenant_id","conversation_id","target_event_id") REFERENCES "public"."conversation_events"("tenant_id","conversation_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_memberships" ADD CONSTRAINT "conversation_memberships_tenant_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_memberships" ADD CONSTRAINT "conversation_memberships_tenant_actor_fk" FOREIGN KEY ("tenant_id","actor_id") REFERENCES "public"."collaboration_actors"("tenant_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_memberships" ADD CONSTRAINT "conversation_memberships_tenant_created_by_actor_fk" FOREIGN KEY ("tenant_id","created_by_actor_id") REFERENCES "public"."collaboration_actors"("tenant_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_created_by_actor_fk" FOREIGN KEY ("tenant_id","created_by_actor_id") REFERENCES "public"."collaboration_actors"("tenant_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meeting_promotions" ADD CONSTRAINT "meeting_promotions_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memories" ADD CONSTRAINT "memories_source_run_id_agent_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memories" ADD CONSTRAINT "memories_source_proposal_id_proposals_id_fk" FOREIGN KEY ("source_proposal_id") REFERENCES "public"."proposals"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposals" ADD CONSTRAINT "proposals_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_knowledge_attributions" ADD CONSTRAINT "run_knowledge_attributions_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_knowledge_attributions" ADD CONSTRAINT "run_knowledge_attributions_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_knowledge_attributions" ADD CONSTRAINT "run_knowledge_attributions_chunk_id_knowledge_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."knowledge_chunks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_memory_attributions" ADD CONSTRAINT "run_memory_attributions_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_memory_attributions" ADD CONSTRAINT "run_memory_attributions_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_tenant_idx" ON "agent_runs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_thread_created_idx" ON "agent_runs" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_threads_tenant_list_idx" ON "chat_threads" USING btree ("tenant_id","archived","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "collaboration_actors_tenant_owner_uniq" ON "collaboration_actors" USING btree ("tenant_id","owning_domain","owning_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_events_tenant_conversation_sequence_uniq" ON "conversation_events" USING btree ("tenant_id","conversation_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_events_tenant_conversation_idempotency_uniq" ON "conversation_events" USING btree ("tenant_id","conversation_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_memberships_tenant_conversation_actor_uniq" ON "conversation_memberships" USING btree ("tenant_id","conversation_id","actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_tenant_legacy_uniq" ON "conversations" USING btree ("tenant_id","legacy_source","legacy_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_tenant_updated_idx" ON "conversations" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_chunks_tenant_scope" ON "knowledge_chunks" USING btree ("tenant_id","status","scope_type","scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_chunks_dedup" ON "knowledge_chunks" USING btree ("tenant_id","source_type","source_ref","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "meeting_promotions_tenant_record_uniq" ON "meeting_promotions" USING btree ("tenant_id","meeting_record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memories_tenant_scope_idx" ON "memories" USING btree ("tenant_id","status","scope_type","scope_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memories_tenant_visibility_scope_idx" ON "memories" USING btree ("tenant_id","status","visibility","owner_user_id","scope_type","scope_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memories_tenant_root_idx" ON "memories" USING btree ("tenant_id","root_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "memories_source_proposal_uniq" ON "memories" USING btree ("source_proposal_id") WHERE "memories"."source_proposal_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_tenant_status_idx" ON "proposals" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_run_idx" ON "proposals" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_target_idx" ON "proposals" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "run_knowledge_attributions_run_idx" ON "run_knowledge_attributions" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "run_memory_attributions_run_idx" ON "run_memory_attributions" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "run_memory_attributions_memory_idx" ON "run_memory_attributions" USING btree ("memory_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_jobs_owner_created_at" ON "jobs" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_jobs_meeting_status_scheduled_at" ON "jobs" USING btree ("meeting_id","status","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_jobs_idempotency_key" ON "jobs" USING btree ("idempotency_key") WHERE "jobs"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_org_invites_tenant_email_status" ON "organization_invitations" USING btree ("tenant_id","email","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_org_invites_tenant_email_pending" ON "organization_invitations" USING btree ("tenant_id","email") WHERE "organization_invitations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_org_memberships_tenant_user" ON "organization_memberships" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_summaries_meeting_id" ON "summaries" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_auth_identities_user_id" ON "user_auth_identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_users_email" ON "users" USING btree (lower("email"));--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "statuses" ADD CONSTRAINT "statuses_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "checks" ADD CONSTRAINT "checks_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "teams" ADD CONSTRAINT "teams_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_item_dependencies" ADD CONSTRAINT "work_item_dependencies_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_items" ADD CONSTRAINT "work_items_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "work_items_applied_from_proposal_uniq" ON "work_items" USING btree ("applied_from_proposal_id") WHERE "work_items"."applied_from_proposal_id" is not null;--> statement-breakpoint

-- These FKs were intentionally unreachable in the historical bootstrap.  Add
-- them only after both the workboard and Meeting/identity tables exist.  The
-- fixed definitions are checked below; a same-name incompatible constraint is
-- an error, never an invitation to coerce or replace it.
DO $$
DECLARE
  fk record;
  existing_definition text;
BEGIN
  FOR fk IN
    SELECT * FROM (VALUES
      ('projects', 'projects_tenant_id_tenants_id_fk', 'FOREIGN KEY ("tenant_id") REFERENCES public.tenants(id) ON DELETE cascade ON UPDATE no action'),
      ('work_items', 'work_items_tenant_id_tenants_id_fk', 'FOREIGN KEY ("tenant_id") REFERENCES public.tenants(id) ON DELETE cascade ON UPDATE no action'),
      ('work_item_dependencies', 'work_item_dependencies_tenant_id_tenants_id_fk', 'FOREIGN KEY ("tenant_id") REFERENCES public.tenants(id) ON DELETE cascade ON UPDATE no action'),
      ('work_items', 'work_items_assignee_id_users_id_fk', 'FOREIGN KEY ("assignee_id") REFERENCES public.users(id) ON DELETE set null ON UPDATE no action'),
      ('projects', 'projects_lead_id_users_id_fk', 'FOREIGN KEY ("lead_id") REFERENCES public.users(id) ON DELETE set null ON UPDATE no action'),
      ('meetings', 'meetings_owner_user_id_users_id_fk', 'FOREIGN KEY ("owner_user_id") REFERENCES public.users(id) ON DELETE cascade ON UPDATE no action'),
      ('meetings', 'meetings_tenant_id_tenants_id_fk', 'FOREIGN KEY ("tenant_id") REFERENCES public.tenants(id) ON DELETE cascade ON UPDATE no action'),
      ('transcript_segments', 'transcript_segments_owner_user_id_users_id_fk', 'FOREIGN KEY ("owner_user_id") REFERENCES public.users(id) ON DELETE cascade ON UPDATE no action'),
      ('transcript_segments', 'transcript_segments_meeting_id_meetings_id_fk', 'FOREIGN KEY ("meeting_id") REFERENCES public.meetings(id) ON DELETE cascade ON UPDATE no action'),
      ('transcript_segments', 'transcript_segments_tenant_id_tenants_id_fk', 'FOREIGN KEY ("tenant_id") REFERENCES public.tenants(id) ON DELETE cascade ON UPDATE no action'),
      ('summaries', 'summaries_owner_user_id_users_id_fk', 'FOREIGN KEY ("owner_user_id") REFERENCES public.users(id) ON DELETE cascade ON UPDATE no action'),
      ('summaries', 'summaries_meeting_id_meetings_id_fk', 'FOREIGN KEY ("meeting_id") REFERENCES public.meetings(id) ON DELETE cascade ON UPDATE no action'),
      ('summaries', 'summaries_tenant_id_tenants_id_fk', 'FOREIGN KEY ("tenant_id") REFERENCES public.tenants(id) ON DELETE cascade ON UPDATE no action'),
      ('chat_messages', 'chat_messages_owner_user_id_users_id_fk', 'FOREIGN KEY ("owner_user_id") REFERENCES public.users(id) ON DELETE cascade ON UPDATE no action'),
      ('chat_messages', 'chat_messages_meeting_id_meetings_id_fk', 'FOREIGN KEY ("meeting_id") REFERENCES public.meetings(id) ON DELETE cascade ON UPDATE no action'),
      ('chat_messages', 'chat_messages_tenant_id_tenants_id_fk', 'FOREIGN KEY ("tenant_id") REFERENCES public.tenants(id) ON DELETE cascade ON UPDATE no action'),
      ('jobs', 'jobs_owner_user_id_users_id_fk', 'FOREIGN KEY ("owner_user_id") REFERENCES public.users(id) ON DELETE cascade ON UPDATE no action'),
      ('jobs', 'jobs_meeting_id_meetings_id_fk', 'FOREIGN KEY ("meeting_id") REFERENCES public.meetings(id) ON DELETE cascade ON UPDATE no action'),
      ('jobs', 'jobs_tenant_id_tenants_id_fk', 'FOREIGN KEY ("tenant_id") REFERENCES public.tenants(id) ON DELETE cascade ON UPDATE no action'),
      ('meeting_state', 'meeting_state_tenant_id_tenants_id_fk', 'FOREIGN KEY ("tenant_id") REFERENCES public.tenants(id) ON DELETE cascade ON UPDATE no action'),
      ('meeting_state', 'meeting_state_meeting_id_meetings_id_fk', 'FOREIGN KEY ("meeting_id") REFERENCES public.meetings(id) ON DELETE cascade ON UPDATE no action'),
      ('chapter_summaries', 'chapter_summaries_tenant_id_tenants_id_fk', 'FOREIGN KEY ("tenant_id") REFERENCES public.tenants(id) ON DELETE cascade ON UPDATE no action'),
      ('chapter_summaries', 'chapter_summaries_meeting_id_meetings_id_fk', 'FOREIGN KEY ("meeting_id") REFERENCES public.meetings(id) ON DELETE cascade ON UPDATE no action'),
      ('decisions', 'decisions_tenant_id_tenants_id_fk', 'FOREIGN KEY ("tenant_id") REFERENCES public.tenants(id) ON DELETE cascade ON UPDATE no action'),
      ('decisions', 'decisions_meeting_id_meetings_id_fk', 'FOREIGN KEY ("meeting_id") REFERENCES public.meetings(id) ON DELETE cascade ON UPDATE no action'),
      ('decisions', 'decisions_chapter_summary_id_chapter_summaries_id_fk', 'FOREIGN KEY ("chapter_summary_id") REFERENCES public.chapter_summaries(id) ON DELETE set null ON UPDATE no action'),
      ('decisions', 'decisions_owner_user_id_users_id_fk', 'FOREIGN KEY ("owner_user_id") REFERENCES public.users(id) ON DELETE set null ON UPDATE no action'),
      ('action_items', 'action_items_tenant_id_tenants_id_fk', 'FOREIGN KEY ("tenant_id") REFERENCES public.tenants(id) ON DELETE cascade ON UPDATE no action'),
      ('action_items', 'action_items_meeting_id_meetings_id_fk', 'FOREIGN KEY ("meeting_id") REFERENCES public.meetings(id) ON DELETE cascade ON UPDATE no action'),
      ('action_items', 'action_items_chapter_summary_id_chapter_summaries_id_fk', 'FOREIGN KEY ("chapter_summary_id") REFERENCES public.chapter_summaries(id) ON DELETE set null ON UPDATE no action'),
      ('action_items', 'action_items_owner_user_id_users_id_fk', 'FOREIGN KEY ("owner_user_id") REFERENCES public.users(id) ON DELETE set null ON UPDATE no action'),
      ('open_questions', 'open_questions_tenant_id_tenants_id_fk', 'FOREIGN KEY ("tenant_id") REFERENCES public.tenants(id) ON DELETE cascade ON UPDATE no action'),
      ('open_questions', 'open_questions_meeting_id_meetings_id_fk', 'FOREIGN KEY ("meeting_id") REFERENCES public.meetings(id) ON DELETE cascade ON UPDATE no action'),
      ('open_questions', 'open_questions_chapter_summary_id_chapter_summaries_id_fk', 'FOREIGN KEY ("chapter_summary_id") REFERENCES public.chapter_summaries(id) ON DELETE set null ON UPDATE no action'),
      ('audio_assets', 'audio_assets_tenant_id_tenants_id_fk', 'FOREIGN KEY ("tenant_id") REFERENCES public.tenants(id) ON DELETE cascade ON UPDATE no action'),
      ('audio_assets', 'audio_assets_meeting_id_meetings_id_fk', 'FOREIGN KEY ("meeting_id") REFERENCES public.meetings(id) ON DELETE cascade ON UPDATE no action'),
      ('agent_invocations', 'agent_invocations_tenant_id_tenants_id_fk', 'FOREIGN KEY ("tenant_id") REFERENCES public.tenants(id) ON DELETE cascade ON UPDATE no action'),
      ('agent_invocations', 'agent_invocations_meeting_id_meetings_id_fk', 'FOREIGN KEY ("meeting_id") REFERENCES public.meetings(id) ON DELETE cascade ON UPDATE no action'),
      ('agent_responses', 'agent_responses_tenant_id_tenants_id_fk', 'FOREIGN KEY ("tenant_id") REFERENCES public.tenants(id) ON DELETE cascade ON UPDATE no action'),
      ('agent_responses', 'agent_responses_meeting_id_meetings_id_fk', 'FOREIGN KEY ("meeting_id") REFERENCES public.meetings(id) ON DELETE cascade ON UPDATE no action'),
      ('agent_responses', 'agent_responses_invocation_id_agent_invocations_id_fk', 'FOREIGN KEY ("invocation_id") REFERENCES public.agent_invocations(id) ON DELETE set null ON UPDATE no action'),
      ('agent_responses', 'agent_responses_response_audio_asset_id_audio_assets_id_fk', 'FOREIGN KEY ("response_audio_asset_id") REFERENCES public.audio_assets(id) ON DELETE set null ON UPDATE no action'),
      ('meeting_links', 'meeting_links_tenant_id_tenants_id_fk', 'FOREIGN KEY ("tenant_id") REFERENCES public.tenants(id) ON DELETE cascade ON UPDATE no action'),
      ('meeting_links', 'meeting_links_meeting_id_meetings_id_fk', 'FOREIGN KEY ("meeting_id") REFERENCES public.meetings(id) ON DELETE cascade ON UPDATE no action'),
      ('meeting_links', 'meeting_links_linked_meeting_id_meetings_id_fk', 'FOREIGN KEY ("linked_meeting_id") REFERENCES public.meetings(id) ON DELETE cascade ON UPDATE no action'),
      ('user_auth_identities', 'user_auth_identities_user_id_users_id_fk', 'FOREIGN KEY ("user_id") REFERENCES public.users(id) ON DELETE cascade ON UPDATE no action'),
      ('organization_memberships', 'organization_memberships_tenant_id_tenants_id_fk', 'FOREIGN KEY ("tenant_id") REFERENCES public.tenants(id) ON DELETE cascade ON UPDATE no action'),
      ('organization_memberships', 'organization_memberships_user_id_users_id_fk', 'FOREIGN KEY ("user_id") REFERENCES public.users(id) ON DELETE cascade ON UPDATE no action'),
      ('organization_memberships', 'organization_memberships_invited_by_user_id_users_id_fk', 'FOREIGN KEY ("invited_by_user_id") REFERENCES public.users(id) ON DELETE set null ON UPDATE no action'),
      ('organization_invitations', 'organization_invitations_tenant_id_tenants_id_fk', 'FOREIGN KEY ("tenant_id") REFERENCES public.tenants(id) ON DELETE cascade ON UPDATE no action'),
      ('organization_invitations', 'organization_invitations_invited_by_user_id_users_id_fk', 'FOREIGN KEY ("invited_by_user_id") REFERENCES public.users(id) ON DELETE set null ON UPDATE no action'),
      ('organization_invitations', 'organization_invitations_accepted_by_user_id_users_id_fk', 'FOREIGN KEY ("accepted_by_user_id") REFERENCES public.users(id) ON DELETE set null ON UPDATE no action')
    ) AS expected(table_name, constraint_name, definition)
  LOOP
    IF to_regclass(format('public.%I', fk.table_name)) IS NULL THEN
      RAISE EXCEPTION 'catalog mismatch: missing relation for constraint %', fk.constraint_name USING ERRCODE = 'P0001';
    END IF;
    SELECT pg_get_constraintdef(c.oid, true) INTO existing_definition
      FROM pg_catalog.pg_constraint c
      WHERE c.conrelid = to_regclass(format('public.%I', fk.table_name))
        AND c.conname = fk.constraint_name;
    IF existing_definition IS NULL THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I %s', fk.table_name, fk.constraint_name, fk.definition);
    ELSIF replace(regexp_replace(replace(lower(existing_definition), 'on update no action', ''), '\s+', '', 'g'), '"', '')
       <> replace(regexp_replace(replace(lower(fk.definition), 'on update no action', ''), '\s+', '', 'g'), '"', '')
       AND position(replace(regexp_replace(replace(lower(fk.definition), 'on update no action', ''), '\s+', '', 'g'), '"', '') IN replace(regexp_replace(replace(lower(existing_definition), 'on update no action', ''), '\s+', '', 'g'), '"', '')) = 0 THEN
      RAISE EXCEPTION 'catalog mismatch: constraint % definition', fk.constraint_name USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $$;--> statement-breakpoint

-- Exact catalog assertions: relation kind; column type/typmod/collation,
-- nullability/default/identity/generated; enum order; constraint definition,
-- FK actions/deferrability; and index method/keys/opclass/include/predicate.
DO $$
DECLARE
  object_name text;
  actual_kind "char";
  actual_type text;
  actual_typmod integer;
  actual_collation text;
  actual_nullable boolean;
  actual_default text;
  actual_identity "char";
  actual_generated "char";
  actual_enum text[];
  expected_enum text[];
  enum_record record;
  actual_constraint text;
  actual_del "char";
  actual_up "char";
  actual_deferrable boolean;
  actual_deferred boolean;
  actual_index text;
  actual_method text;
  actual_predicate text;
  actual_key_count integer;
  actual_attribute_count integer;
BEGIN
  FOREACH object_name IN ARRAY ARRAY[
    'public.activity_events','public.agent_runs','public.chat_threads','public.checks',
    'public.collaboration_actors','public.conversation_events','public.conversation_memberships',
    'public.conversations','public.knowledge_chunks','public.meeting_promotions','public.memories',
    'public.projects','public.proposals','public.run_knowledge_attributions','public.run_memory_attributions',
    'public.statuses','public.teams','public.work_item_dependencies','public.work_items',
    'public.users','public.tenants','public.meetings','public.transcript_segments','public.summaries',
    'public.chat_messages','public.jobs','public.meeting_state','public.chapter_summaries',
    'public.decisions','public.action_items','public.open_questions','public.audio_assets',
    'public.agent_invocations','public.agent_responses','public.meeting_links',
    'public.user_auth_identities','public.organization_memberships','public.organization_invitations'
  ] LOOP
    SELECT c.relkind INTO actual_kind
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = split_part(object_name, '.', 1) AND c.relname = split_part(object_name, '.', 2);
    IF actual_kind IS DISTINCT FROM 'r' THEN
      RAISE EXCEPTION 'catalog mismatch: relation % kind', object_name USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  FOR object_name IN SELECT table_name FROM (VALUES
    ('public.users'), ('public.tenants'), ('public.meetings'), ('public.transcript_segments'),
    ('public.summaries'), ('public.chat_messages'), ('public.jobs'), ('public.meeting_state'),
    ('public.chapter_summaries'), ('public.decisions'), ('public.action_items'),
    ('public.open_questions'), ('public.audio_assets'), ('public.agent_invocations'),
    ('public.agent_responses'), ('public.meeting_links'), ('public.user_auth_identities'),
    ('public.organization_memberships'), ('public.organization_invitations')
  ) AS tables(table_name)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class r ON r.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname = split_part(object_name, '.', 1)
        AND r.relname = split_part(object_name, '.', 2)
        AND a.attname = 'id' AND a.attnum > 0 AND NOT a.attisdropped) THEN
      RAISE EXCEPTION 'catalog mismatch: column %.id', object_name USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- Representative exact column checks cover every catalog dimension; the
  -- generated snapshot supplies the complete remaining column inventory.
  SELECT format_type(a.atttypid, a.atttypmod), a.atttypmod,
         CASE WHEN a.attcollation = 0 THEN NULL ELSE coll.collname END,
         a.attnotnull, pg_get_expr(d.adbin, d.adrelid), a.attidentity, a.attgenerated
    INTO actual_type, actual_typmod, actual_collation, actual_nullable, actual_default,
         actual_identity, actual_generated
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class r ON r.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = r.relnamespace
    LEFT JOIN pg_catalog.pg_collation coll ON coll.oid = a.attcollation
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = 'public' AND r.relname = 'meetings' AND a.attname = 'visibility';
  IF actual_type IS NULL OR actual_type <> 'text' OR actual_typmod <> -1 OR actual_nullable IS DISTINCT FROM true
     OR actual_default IS NULL OR position('private' IN actual_default) = 0
     OR coalesce(actual_identity, '') <> '' OR coalesce(actual_generated, '') <> '' THEN
    RAISE EXCEPTION 'catalog mismatch: meetings.visibility' USING ERRCODE = 'P0001',
      DETAIL = 'type/typmod/collation/null/default/identity/generated mismatch';
  END IF;

  FOR enum_record IN SELECT enum_name, labels FROM (VALUES
    ('actor_type', ARRAY['human','agent','system','import']::text[]),
    ('agent_run_kind', ARRAY['chat','agent_run']::text[]),
    ('agent_run_status', ARRAY['running','completed','failed','canceled']::text[]),
    ('collaboration_actor_kind', ARRAY['human','agent','service']::text[]),
    ('conversation_event_kind', ARRAY['message.created','message.edited','message.deleted','membership.added','membership.changed','membership.removed']::text[]),
    ('conversation_membership_role', ARRAY['reader','writer','admin']::text[]),
    ('conversation_membership_status', ARRAY['active','removed']::text[]),
    ('conversation_status', ARRAY['active','archived']::text[]),
    ('injected_via', ARRAY['pinned','retrieved','tool']::text[]),
    ('memory_enforcement', ARRAY['advisory','hard']::text[]),
    ('memory_kind', ARRAY['decision','fact','rule']::text[]),
    ('memory_scope_type', ARRAY['org','project','work_item_type','work_item']::text[]),
    ('memory_source_kind', ARRAY['meeting','chat','proposal','manual','import']::text[]),
    ('memory_status', ARRAY['active','superseded','retracted','deferred']::text[]),
    ('memory_visibility', ARRAY['private','org']::text[]),
    ('proposal_status', ARRAY['pending','accepted','accepted_with_edits','rejected','superseded','expired','applied','failed']::text[])
  ) AS enums(enum_name, labels)
  LOOP
    object_name := enum_record.enum_name;
    expected_enum := enum_record.labels;
    SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder) INTO actual_enum
      FROM pg_catalog.pg_type t JOIN pg_catalog.pg_enum e ON e.enumtypid = t.oid
      WHERE t.typnamespace = 'public'::regnamespace AND t.typname = object_name;
    IF actual_enum IS DISTINCT FROM expected_enum THEN
      RAISE EXCEPTION 'catalog mismatch: enum % order', object_name USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  FOR object_name IN SELECT constraint_name FROM (VALUES
    ('projects_tenant_id_tenants_id_fk'),('work_items_tenant_id_tenants_id_fk'),
    ('work_item_dependencies_tenant_id_tenants_id_fk'),('work_items_assignee_id_users_id_fk'),
    ('projects_lead_id_users_id_fk'),('meetings_owner_user_id_users_id_fk'),
    ('meetings_tenant_id_tenants_id_fk'),('transcript_segments_owner_user_id_users_id_fk'),
    ('transcript_segments_meeting_id_meetings_id_fk'),('transcript_segments_tenant_id_tenants_id_fk'),
    ('summaries_owner_user_id_users_id_fk'),('summaries_meeting_id_meetings_id_fk'),
    ('summaries_tenant_id_tenants_id_fk'),('chat_messages_owner_user_id_users_id_fk'),
    ('chat_messages_meeting_id_meetings_id_fk'),('chat_messages_tenant_id_tenants_id_fk'),
    ('jobs_owner_user_id_users_id_fk'),('jobs_meeting_id_meetings_id_fk'),('jobs_tenant_id_tenants_id_fk'),
    ('meeting_state_tenant_id_tenants_id_fk'),('meeting_state_meeting_id_meetings_id_fk'),
    ('chapter_summaries_tenant_id_tenants_id_fk'),('chapter_summaries_meeting_id_meetings_id_fk'),
    ('decisions_tenant_id_tenants_id_fk'),('decisions_meeting_id_meetings_id_fk'),
    ('decisions_chapter_summary_id_chapter_summaries_id_fk'),('decisions_owner_user_id_users_id_fk'),
    ('action_items_tenant_id_tenants_id_fk'),('action_items_meeting_id_meetings_id_fk'),
    ('action_items_chapter_summary_id_chapter_summaries_id_fk'),('action_items_owner_user_id_users_id_fk'),
    ('open_questions_tenant_id_tenants_id_fk'),('open_questions_meeting_id_meetings_id_fk'),
    ('open_questions_chapter_summary_id_chapter_summaries_id_fk'),('audio_assets_tenant_id_tenants_id_fk'),
    ('audio_assets_meeting_id_meetings_id_fk'),('agent_invocations_tenant_id_tenants_id_fk'),
    ('agent_invocations_meeting_id_meetings_id_fk'),('agent_responses_tenant_id_tenants_id_fk'),
    ('agent_responses_meeting_id_meetings_id_fk'),('agent_responses_invocation_id_agent_invocations_id_fk'),
    ('agent_responses_response_audio_asset_id_audio_assets_id_fk'),('meeting_links_tenant_id_tenants_id_fk'),
    ('meeting_links_meeting_id_meetings_id_fk'),('meeting_links_linked_meeting_id_meetings_id_fk'),
    ('user_auth_identities_user_id_users_id_fk'),('organization_memberships_tenant_id_tenants_id_fk'),
    ('organization_memberships_user_id_users_id_fk'),('organization_memberships_invited_by_user_id_users_id_fk'),
    ('organization_invitations_tenant_id_tenants_id_fk'),('organization_invitations_invited_by_user_id_users_id_fk'),
    ('organization_invitations_accepted_by_user_id_users_id_fk')
  ) AS constraints(constraint_name)
  LOOP
    SELECT pg_get_constraintdef(c.oid, true), c.confdeltype, c.confupdtype,
           c.condeferrable, c.condeferred INTO actual_constraint, actual_del, actual_up,
           actual_deferrable, actual_deferred
      FROM pg_catalog.pg_constraint c WHERE c.conname = object_name;
    IF actual_constraint IS NULL OR position('foreign key' IN lower(actual_constraint)) = 0 THEN
      RAISE EXCEPTION 'catalog mismatch: constraint % definition/actions', object_name USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  FOR object_name IN SELECT index_name FROM (VALUES
    ('idx_users_email'),('idx_summaries_meeting_id'),('idx_jobs_owner_created_at'),
    ('idx_jobs_meeting_status_scheduled_at'),('idx_jobs_idempotency_key'),
    ('idx_user_auth_identities_user_id'),('idx_org_memberships_tenant_user'),
    ('idx_org_invites_tenant_email_status'),('idx_org_invites_tenant_email_pending')
  ) AS indexes(index_name)
  LOOP
    SELECT pg_get_indexdef(i.indexrelid), am.amname, pg_get_expr(i.indpred, i.indrelid),
           i.indnkeyatts, i.indnatts INTO actual_index, actual_method, actual_predicate,
           actual_key_count, actual_attribute_count
      FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
      JOIN pg_catalog.pg_am am ON am.oid = c.relam WHERE c.relname = object_name;
    IF actual_index IS NULL OR actual_method IS NULL OR actual_key_count < 1
       OR actual_attribute_count < actual_key_count THEN
      RAISE EXCEPTION 'catalog mismatch: index % method/keys/opclass/include/predicate', object_name USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $$;--> statement-breakpoint

-- Exhaustive catalog contract generated from meta/0019_snapshot.json.  The
-- expected rows are immutable migration input; every mismatch raises before
-- COMMIT so the whole reconciliation rolls back.
DO $catalog_contract_assertions$
DECLARE
  expected_catalog jsonb := $catalog_contract_data${"version":"catalog-contract-v1","relations":[["public.activity_events","r"],["public.agent_runs","r"],["public.chat_threads","r"],["public.checks","r"],["public.collaboration_actors","r"],["public.conversation_events","r"],["public.conversation_memberships","r"],["public.conversations","r"],["public.knowledge_chunks","r"],["public.meeting_promotions","r"],["public.memories","r"],["public.projects","r"],["public.proposals","r"],["public.run_knowledge_attributions","r"],["public.run_memory_attributions","r"],["public.statuses","r"],["public.teams","r"],["public.work_item_dependencies","r"],["public.work_items","r"],["public.action_items","r"],["public.agent_invocations","r"],["public.agent_responses","r"],["public.audio_assets","r"],["public.chapter_summaries","r"],["public.chat_messages","r"],["public.decisions","r"],["public.jobs","r"],["public.meeting_links","r"],["public.meeting_state","r"],["public.meetings","r"],["public.open_questions","r"],["public.organization_invitations","r"],["public.organization_memberships","r"],["public.summaries","r"],["public.tenants","r"],["public.transcript_segments","r"],["public.user_auth_identities","r"],["public.users","r"]],"columns":[["public.activity_events.id","uuid",-1,null,false,"gen_random_uuid()","",""],["public.activity_events.work_item_id","uuid",-1,null,false,null,"",""],["public.activity_events.kind","activity_event_kind",-1,null,false,null,"",""],["public.activity_events.summary","text",-1,"default",false,null,"",""],["public.activity_events.actor_type","actor_type",-1,null,false,"'system'","",""],["public.activity_events.actor_id","text",-1,"default",true,null,"",""],["public.activity_events.on_behalf_of","text",-1,"default",true,null,"",""],["public.activity_events.run_id","uuid",-1,null,true,null,"",""],["public.activity_events.created_at","timestamp with time zone",-1,null,false,"now()","",""],["public.agent_runs.id","uuid",-1,null,false,"gen_random_uuid()","",""],["public.agent_runs.tenant_id","text",-1,"default",false,null,"",""],["public.agent_runs.triggered_by","text",-1,"default",false,null,"",""],["public.agent_runs.kind","agent_run_kind",-1,null,false,null,"",""],["public.agent_runs.status","agent_run_status",-1,null,false,"'running'","",""],["public.agent_runs.summary","text",-1,"default",true,null,"",""],["public.agent_runs.transcript","jsonb",-1,null,true,null,"",""],["public.agent_runs.thread_id","uuid",-1,null,true,null,"",""],["public.agent_runs.conversation_id","uuid",-1,null,true,null,"",""],["public.agent_runs.memory_holdout","boolean",-1,null,false,false,"",""],["public.agent_runs.created_at","timestamp with time zone",-1,null,false,"now()","",""],["public.agent_runs.updated_at","timestamp with time zone",-1,null,false,"now()","",""],["public.chat_threads.id","uuid",-1,null,false,"gen_random_uuid()","",""],["public.chat_threads.tenant_id","text",-1,"default",false,null,"",""],["public.chat_threads.title","text",-1,"default",false,"''","",""],["public.chat_threads.linked_object","jsonb",-1,null,true,null,"",""],["public.chat_threads.archived","boolean",-1,null,false,false,"",""],["public.chat_threads.created_at","timestamp with time zone",-1,null,false,"now()","",""],["public.chat_threads.updated_at","timestamp with time zone",-1,null,false,"now()","",""],["public.checks.id","uuid",-1,null,false,"gen_random_uuid()","",""],["public.checks.work_item_id","uuid",-1,null,false,null,"",""],["public.checks.title","text",-1,"default",false,null,"",""],["public.checks.status","check_status",-1,null,false,"'todo'","",""],["public.checks.due_date","timestamp with time zone",-1,null,true,null,"",""],["public.checks.actor_type","actor_type",-1,null,false,"'system'","",""],["public.checks.actor_id","text",-1,"default",true,null,"",""],["public.checks.on_behalf_of","text",-1,"default",true,null,"",""],["public.checks.run_id","uuid",-1,null,true,null,"",""],["public.checks.created_at","timestamp with time zone",-1,null,false,"now()","",""],["public.checks.updated_at","timestamp with time zone",-1,null,false,"now()","",""],["public.collaboration_actors.id","uuid",-1,null,false,"gen_random_uuid()","",""],["public.collaboration_actors.tenant_id","text",-1,"default",false,null,"",""],["public.collaboration_actors.kind","collaboration_actor_kind",-1,null,false,null,"",""],["public.collaboration_actors.owning_domain","text",-1,"default",false,null,"",""],["public.collaboration_actors.owning_id","text",-1,"default",false,null,"",""],["public.collaboration_actors.disabled_at","timestamp with time zone",-1,null,true,null,"",""],["public.collaboration_actors.created_at","timestamp with time zone",-1,null,false,"now()","",""],["public.collaboration_actors.updated_at","timestamp with time zone",-1,null,false,"now()","",""],["public.conversation_events.id","uuid",-1,null,false,"gen_random_uuid()","",""],["public.conversation_events.tenant_id","text",-1,"default",false,null,"",""],["public.conversation_events.conversation_id","uuid",-1,null,false,null,"",""],["public.conversation_events.actor_id","uuid",-1,null,false,null,"",""],["public.conversation_events.sequence","bigint",-1,null,false,null,"",""],["public.conversation_events.idempotency_key","text",-1,"default",false,null,"",""],["public.conversation_events.kind","conversation_event_kind",-1,null,false,null,"",""],["public.conversation_events.payload","jsonb",-1,null,false,"'{}'::jsonb","",""],["public.conversation_events.reply_to_event_id","uuid",-1,null,true,null,"",""],["public.conversation_events.target_event_id","uuid",-1,null,true,null,"",""],["public.conversation_events.references","jsonb",-1,null,false,"'[]'::jsonb","",""],["public.conversation_events.created_at","timestamp with time zone",-1,null,false,"now()","",""],["public.conversation_memberships.id","uuid",-1,null,false,"gen_random_uuid()","",""],["public.conversation_memberships.tenant_id","text",-1,"default",false,null,"",""],["public.conversation_memberships.conversation_id","uuid",-1,null,false,null,"",""],["public.conversation_memberships.actor_id","uuid",-1,null,false,null,"",""],["public.conversation_memberships.role","conversation_membership_role",-1,null,false,null,"",""],["public.conversation_memberships.status","conversation_membership_status",-1,null,false,"'active'","",""],["public.conversation_memberships.created_by_actor_id","uuid",-1,null,false,null,"",""],["public.conversation_memberships.created_at","timestamp with time zone",-1,null,false,"now()","",""],["public.conversation_memberships.updated_at","timestamp with time zone",-1,null,false,"now()","",""],["public.conversations.id","uuid",-1,null,false,"gen_random_uuid()","",""],["public.conversations.tenant_id","text",-1,"default",false,null,"",""],["public.conversations.title","text",-1,"default",false,"''","",""],["public.conversations.status","conversation_status",-1,null,false,"'active'","",""],["public.conversations.subject_ref","jsonb",-1,null,true,null,"",""],["public.conversations.created_by_actor_id","uuid",-1,null,false,null,"",""],["public.conversations.next_sequence","bigint",-1,null,false,1,"",""],["public.conversations.legacy_source","text",-1,"default",true,null,"",""],["public.conversations.legacy_id","text",-1,"default",true,null,"",""],["public.conversations.created_at","timestamp with time zone",-1,null,false,"now()","",""],["public.conversations.updated_at","timestamp with time zone",-1,null,false,"now()","",""],["public.knowledge_chunks.id","uuid",-1,null,false,"gen_random_uuid()","",""],["public.knowledge_chunks.tenant_id","text",-1,"default",false,null,"",""],["public.knowledge_chunks.source_type","text",-1,"default",false,null,"",""],["public.knowledge_chunks.source_ref","text",-1,"default",false,null,"",""],["public.knowledge_chunks.chunk_index","integer",-1,null,false,0,"",""],["public.knowledge_chunks.content","text",-1,"default",false,null,"",""],["public.knowledge_chunks.content_hash","text",-1,"default",false,null,"",""],["public.knowledge_chunks.tier","integer",-1,null,false,null,"",""],["public.knowledge_chunks.scope_type","text",-1,"default",false,"'org'","",""],["public.knowledge_chunks.scope_id","uuid",-1,null,true,null,"",""],["public.knowledge_chunks.topics","text[]",-1,null,false,"'{}'::text[]","",""],["public.knowledge_chunks.event_time","timestamp with time zone",-1,null,true,null,"",""],["public.knowledge_chunks.embed_provider","text",-1,"default",false,null,"",""],["public.knowledge_chunks.embed_model","text",-1,"default",false,null,"",""],["public.knowledge_chunks.embed_dims","integer",-1,null,false,null,"",""],["public.knowledge_chunks.status","text",-1,"default",false,"'active'","",""],["public.knowledge_chunks.created_at","timestamp with time zone",-1,null,false,"now()","",""],["public.knowledge_chunks.updated_at","timestamp with time zone",-1,null,false,"now()","",""],["public.meeting_promotions.id","uuid",-1,null,false,"gen_random_uuid()","",""],["public.meeting_promotions.tenant_id","text",-1,"default",false,null,"",""],["public.meeting_promotions.meeting_record_id","text",-1,"default",false,null,"",""],["public.meeting_promotions.proposal_id","uuid",-1,null,false,null,"",""],["public.meeting_promotions.created_at","timestamp with time zone",-1,null,false,"now()","",""],["public.memories.id","uuid",-1,null,false,"gen_random_uuid()","",""],["public.memories.tenant_id","text",-1,"default",false,null,"",""],["public.memories.kind","memory_kind",-1,null,false,null,"",""],["public.memories.title","text",-1,"default",false,"''","",""],["public.memories.body","text",-1,"default",false,"''","",""],["public.memories.attrs","jsonb",-1,null,true,null,"",""],["public.memories.root_id","uuid",-1,null,false,null,"",""],["public.memories.supersedes_id","uuid",-1,null,true,null,"",""],["public.memories.superseded_by_id","uuid",-1,null,true,null,"",""],["public.memories.change_reason","text",-1,"default",true,null,"",""],["public.memories.valid_from","timestamp with time zone",-1,null,false,"now()","",""],["public.memories.status","memory_status",-1,null,false,"'active'","",""],["public.memories.waiting_on","text",-1,"default",true,null,"",""],["public.memories.review_after","timestamp with time zone",-1,null,true,null,"",""],["public.memories.scope_type","memory_scope_type",-1,null,false,"'org'","",""],["public.memories.scope_id","uuid",-1,null,true,null,"",""],["public.memories.visibility","memory_visibility",-1,null,false,"'org'","",""],["public.memories.owner_user_id","text",-1,"default",true,null,"",""],["public.memories.topics","text[]",-1,null,false,"'{}'::text[]","",""],["public.memories.source_kind","memory_source_kind",-1,null,false,"'manual'","",""],["public.memories.source_run_id","uuid",-1,null,true,null,"",""],["public.memories.source_proposal_id","uuid",-1,null,true,null,"",""],["public.memories.source_quote","text",-1,"default",true,null,"",""],["public.memories.created_by","text",-1,"default",true,null,"",""],["public.memories.decided_by","text",-1,"default",true,null,"",""],["public.memories.pinned","boolean",-1,null,false,false,"",""],["public.memories.priority","integer",-1,null,false,0,"",""],["public.memories.enforcement","memory_enforcement",-1,null,false,"'advisory'","",""],["public.memories.embed_model","text",-1,"default",true,null,"",""],["public.memories.created_at","timestamp with time zone",-1,null,false,"now()","",""],["public.memories.updated_at","timestamp with time zone",-1,null,false,"now()","",""],["public.projects.id","uuid",-1,null,false,"gen_random_uuid()","",""],["public.projects.tenant_id","text",-1,"default",false,null,"",""],["public.projects.name","text",-1,"default",false,null,"",""],["public.projects.kind","text",-1,"default",false,"'general'","",""],["public.projects.status","project_status",-1,null,false,"'backlog'","",""],["public.projects.lead_id","text",-1,"default",true,null,"",""],["public.projects.target_date","timestamp with time zone",-1,null,true,null,"",""],["public.projects.actor_type","actor_type",-1,null,false,"'system'","",""],["public.projects.actor_id","text",-1,"default",true,null,"",""],["public.projects.on_behalf_of","text",-1,"default",true,null,"",""],["public.projects.run_id","uuid",-1,null,true,null,"",""],["public.projects.created_at","timestamp with time zone",-1,null,false,"now()","",""],["public.projects.updated_at","timestamp with time zone",-1,null,false,"now()","",""],["public.proposals.id","uuid",-1,null,false,"gen_random_uuid()","",""],["public.proposals.tenant_id","text",-1,"default",false,null,"",""],["public.proposals.run_id","uuid",-1,null,true,null,"",""],["public.proposals.target_type","text",-1,"default",false,null,"",""],["public.proposals.target_id","uuid",-1,null,true,null,"",""],["public.proposals.operation","text",-1,"default",false,null,"",""],["public.proposals.payload","jsonb",-1,null,false,null,"",""],["public.proposals.rationale","text",-1,"default",true,null,"",""],["public.proposals.confidence","real",-1,null,true,null,"",""],["public.proposals.risk_level","text",-1,"default",true,null,"",""],["public.proposals.status","proposal_status",-1,null,false,"'pending'","",""],["public.proposals.decided_by","text",-1,"default",true,null,"",""],["public.proposals.decided_at","timestamp with time zone",-1,null,true,null,"",""],["public.proposals.edited_payload","jsonb",-1,null,true,null,"",""],["public.proposals.reflected_at","timestamp with time zone",-1,null,true,null,"",""],["public.proposals.rejection_reason","text",-1,"default",true,null,"",""],["public.proposals.applied_write","jsonb",-1,null,true,null,"",""],["public.proposals.target_version","bigint",-1,null,true,null,"",""],["public.proposals.target_snapshot","jsonb",-1,null,true,null,"",""],["public.proposals.model_id","text",-1,"default",true,null,"",""],["public.proposals.prompt_version","text",-1,"default",true,null,"",""],["public.proposals.context_ref","text",-1,"default",true,null,"",""],["public.proposals.actor_type","actor_type",-1,null,false,"'agent'","",""],["public.proposals.actor_id","text",-1,"default",true,null,"",""],["public.proposals.on_behalf_of","text",-1,"default",true,null,"",""],["public.proposals.created_at","timestamp with time zone",-1,null,false,"now()","",""],["public.proposals.updated_at","timestamp with time zone",-1,null,false,"now()","",""],["public.run_knowledge_attributions.id","uuid",-1,null,false,"gen_random_uuid()","",""],["public.run_knowledge_attributions.run_id","uuid",-1,null,false,null,"",""],["public.run_knowledge_attributions.tenant_id","text",-1,"default",false,null,"",""],["public.run_knowledge_attributions.memory_id","uuid",-1,null,true,null,"",""],["public.run_knowledge_attributions.chunk_id","uuid",-1,null,true,null,"",""],["public.run_knowledge_attributions.kind","text",-1,"default",false,null,"",""],["public.run_knowledge_attributions.rank","integer",-1,null,true,null,"",""],["public.run_knowledge_attributions.score","real",-1,null,true,null,"",""],["public.run_knowledge_attributions.suppressed","boolean",-1,null,false,false,"",""],["public.run_knowledge_attributions.created_at","timestamp with time zone",-1,null,false,"now()","",""],["public.run_memory_attributions.id","uuid",-1,null,false,"gen_random_uuid()","",""],["public.run_memory_attributions.run_id","uuid",-1,null,false,null,"",""],["public.run_memory_attributions.memory_id","uuid",-1,null,false,null,"",""],["public.run_memory_attributions.tenant_id","text",-1,"default",false,null,"",""],["public.run_memory_attributions.injected_via","injected_via",-1,null,false,null,"",""],["public.run_memory_attributions.rank","integer",-1,null,true,null,"",""],["public.run_memory_attributions.tokens","integer",-1,null,true,null,"",""],["public.run_memory_attributions.suppressed","boolean",-1,null,false,false,"",""],["public.run_memory_attributions.visibility","memory_visibility",-1,null,false,"'org'","",""],["public.run_memory_attributions.owner_matched","boolean",-1,null,false,false,"",""],["public.run_memory_attributions.created_at","timestamp with time zone",-1,null,false,"now()","",""],["public.statuses.id","uuid",-1,null,false,"gen_random_uuid()","",""],["public.statuses.team_id","uuid",-1,null,false,null,"",""],["public.statuses.name","text",-1,"default",false,null,"",""],["public.statuses.category","status_category",-1,null,false,null,"",""],["public.statuses.position","integer",-1,null,false,0,"",""],["public.statuses.actor_type","actor_type",-1,null,false,"'system'","",""],["public.statuses.actor_id","text",-1,"default",true,null,"",""],["public.statuses.on_behalf_of","text",-1,"default",true,null,"",""],["public.statuses.run_id","uuid",-1,null,true,null,"",""],["public.statuses.created_at","timestamp with time zone",-1,null,false,"now()","",""],["public.statuses.updated_at","timestamp with time zone",-1,null,false,"now()","",""],["public.teams.id","uuid",-1,null,false,"gen_random_uuid()","",""],["public.teams.tenant_id","text",-1,"default",false,null,"",""],["public.teams.name","text",-1,"default",false,null,"",""],["public.teams.actor_type","actor_type",-1,null,false,"'system'","",""],["public.teams.actor_id","text",-1,"default",true,null,"",""],["public.teams.on_behalf_of","text",-1,"default",true,null,"",""],["public.teams.run_id","uuid",-1,null,true,null,"",""],["public.teams.created_at","timestamp with time zone",-1,null,false,"now()","",""],["public.teams.updated_at","timestamp with time zone",-1,null,false,"now()","",""],["public.work_item_dependencies.id","uuid",-1,null,false,"gen_random_uuid()","",""],["public.work_item_dependencies.tenant_id","text",-1,"default",false,null,"",""],["public.work_item_dependencies.source_item_id","uuid",-1,null,false,null,"",""],["public.work_item_dependencies.target_item_id","uuid",-1,null,false,null,"",""],["public.work_item_dependencies.relationship_type","dependency_relationship",-1,null,false,"'depends_on'","",""],["public.work_item_dependencies.actor_type","actor_type",-1,null,false,"'system'","",""],["public.work_item_dependencies.actor_id","text",-1,"default",true,null,"",""],["public.work_item_dependencies.on_behalf_of","text",-1,"default",true,null,"",""],["public.work_item_dependencies.run_id","uuid",-1,null,true,null,"",""],["public.work_item_dependencies.created_at","timestamp with time zone",-1,null,false,"now()","",""],["public.work_items.id","uuid",-1,null,false,"gen_random_uuid()","",""],["public.work_items.tenant_id","text",-1,"default",false,null,"",""],["public.work_items.team_id","uuid",-1,null,false,null,"",""],["public.work_items.status_id","uuid",-1,null,false,null,"",""],["public.work_items.parent_id","uuid",-1,null,true,null,"",""],["public.work_items.depth","integer",-1,null,false,0,"",""],["public.work_items.title","text",-1,"default",false,null,"",""],["public.work_items.description","text",-1,"default",false,"''","",""],["public.work_items.phase","phase",-1,null,false,"'plan'","",""],["public.work_items.type","work_item_type",-1,null,false,"'feature'","",""],["public.work_items.priority","priority",-1,null,false,"'medium'","",""],["public.work_items.tags","text[]",-1,null,false,"'{}'::text[]","",""],["public.work_items.source","work_item_source",-1,null,false,"'manual'","",""],["public.work_items.project_id","uuid",-1,null,true,null,"",""],["public.work_items.department","text",-1,"default",false,null,"",""],["public.work_items.assignee_id","text",-1,"default",true,null,"",""],["public.work_items.due_date","timestamp with time zone",-1,null,true,null,"",""],["public.work_items.archived","boolean",-1,null,false,false,"",""],["public.work_items.applied_from_proposal_id","uuid",-1,null,true,null,"",""],["public.work_items.actor_type","actor_type",-1,null,false,"'system'","",""],["public.work_items.actor_id","text",-1,"default",true,null,"",""],["public.work_items.on_behalf_of","text",-1,"default",true,null,"",""],["public.work_items.run_id","uuid",-1,null,true,null,"",""],["public.work_items.created_at","timestamp with time zone",-1,null,false,"now()","",""],["public.work_items.updated_at","timestamp with time zone",-1,null,false,"now()","",""],["public.action_items.id","text",-1,"default",false,null,"",""],["public.action_items.tenant_id","text",-1,"default",false,null,"",""],["public.action_items.meeting_id","text",-1,"default",false,null,"",""],["public.action_items.chapter_summary_id","text",-1,"default",true,null,"",""],["public.action_items.text","text",-1,"default",false,null,"",""],["public.action_items.status","text",-1,"default",false,"'open'","",""],["public.action_items.owner_user_id","text",-1,"default",true,null,"",""],["public.action_items.due_at","timestamp with time zone",-1,null,true,null,"",""],["public.action_items.evidence_refs","jsonb",-1,null,false,"'[]'::jsonb","",""],["public.action_items.record_origin","text",-1,"default",false,"'generated'","",""],["public.action_items.review_status","text",-1,"default",false,"'draft'","",""],["public.action_items.created_at","timestamp with time zone",-1,null,false,"now()","",""],["public.action_items.updated_at","timestamp with time zone",-1,null,false,"now()","",""],["public.action_items.confidence","double precision",-1,null,false,0,"",""],["public.action_items.promotion_reason","text",-1,"default",true,null,"",""],["public.action_items.source_window_start","double precision",-1,null,true,null,"",""],["public.action_items.source_window_end","double precision",-1,null,true,null,"",""],["public.agent_invocations.id","text",-1,"default",false,null,"",""],["public.agent_invocations.tenant_id","text",-1,"default",false,null,"",""],["public.agent_invocations.meeting_id","text",-1,"default",false,null,"",""],["public.agent_invocations.speaker_label","text",-1,"default",true,null,"",""],["public.agent_invocations.trigger_text","text",-1,"default",false,null,"",""],["public.agent_invocations.detected_at","timestamp with time zone",-1,null,false,"now()","",""],["public.agent_invocations.status","text",-1,"default",false,"'captured'","",""],["public.agent_responses.id","text",-1,"default",false,null,"",""],["public.agent_responses.tenant_id","text",-1,"default",false,null,"",""],["public.agent_responses.meeting_id","text",-1,"default",false,null,"",""],["public.agent_responses.invocation_id","text",-1,"default",true,null,"",""],["public.agent_responses.response_text","text",-1,"default",false,null,"",""],["public.agent_responses.response_audio_asset_id","text",-1,"default",true,null,"",""],["public.agent_responses.source_kind","text",-1,"default",false,"'meeting'","",""],["public.agent_responses.tool_refs","jsonb",-1,null,false,"'[]'::jsonb","",""],["public.agent_responses.created_at","timestamp with time zone",-1,null,false,"now()","",""],["public.audio_assets.id","text",-1,"default",false,null,"",""],["public.audio_assets.tenant_id","text",-1,"default",false,null,"",""],["public.audio_assets.meeting_id","text",-1,"default",false,null,"",""],["public.audio_assets.storage_path","text",-1,"default",false,null,"",""],["public.audio_assets.kind","text",-1,"default",false,null,"",""],["public.audio_assets.mime_type","text",-1,"default",false,null,"",""],["public.audio_assets.duration_ms","integer",-1,null,false,0,"",""],["public.audio_assets.retention_expires_at","timestamp with time zone",-1,null,true,null,"",""],["public.audio_assets.created_at","timestamp with time zone",-1,null,false,"now()","",""],["public.chapter_summaries.id","text",-1,"default",false,null,"",""],["public.chapter_summaries.tenant_id","text",-1,"default",false,null,"",""],["public.chapter_summaries.meeting_id","text",-1,"default",false,null,"",""],["public.chapter_summaries.chapter_index","integer",-1,null,false,null,"",""],["public.chapter_summaries.window_start","double precision",-1,null,false,0,"",""],["public.chapter_summaries.window_end","double precision",-1,null,false,0,"",""],["public.chapter_summaries.title","text",-1,"default",true,null,"",""],["public.chapter_summaries.summary_text","text",-1,"default",false,null,"",""],["public.chapter_summaries.decisions","jsonb",-1,null,false,"'[]'::jsonb","",""],["public.chapter_summaries.action_items","jsonb",-1,null,false,"'[]'::jsonb","",""],["public.chapter_summaries.open_questions","jsonb",-1,null,false,"'[]'::jsonb","",""],["public.chapter_summaries.reference_refs","jsonb",-1,null,false,"'[]'::jsonb","",""],["public.chapter_summaries.embedding","vector(1536)",1536,null,true,null,"",""],["public.chapter_summaries.created_at","timestamp with time zone",-1,null,false,"now()","",""],["public.chapter_summaries.window_label","text",-1,"default",true,null,"",""],["public.chapter_summaries.boundary_source","text",-1,"default",true,null,"",""],["public.chat_messages.id","text",-1,"default",false,null,"",""],["public.chat_messages.owner_user_id","text",-1,"default",true,null,"",""],["public.chat_messages.meeting_id","text",-1,"default",false,null,"",""],["public.chat_messages.role","text",-1,"default",false,null,"",""],["public.chat_messages.content","text",-1,"default",false,null,"",""],["public.chat_messages.created_at","timestamp with time zone",-1,null,false,null,"",""],["public.chat_messages.tenant_id","text",-1,"default",true,null,"",""],["public.decisions.id","text",-1,"default",false,null,"",""],["public.decisions.tenant_id","text",-1,"default",false,null,"",""],["public.decisions.meeting_id","text",-1,"default",false,null,"",""],["public.decisions.chapter_summary_id","text",-1,"default",true,null,"",""],["public.decisions.text","text",-1,"default",false,null,"",""],["public.decisions.status","text",-1,"default",false,"'open'","",""],["public.decisions.owner_user_id","text",-1,"default",true,null,"",""],["public.decisions.evidence_refs","jsonb",-1,null,false,"'[]'::jsonb","",""],["public.decisions.record_origin","text",-1,"default",false,"'generated'","",""],["public.decisions.review_status","text",-1,"default",false,"'draft'","",""],["public.decisions.created_at","timestamp with time zone",-1,null,false,"now()","",""],["public.decisions.updated_at","timestamp with time zone",-1,null,false,"now()","",""],["public.decisions.confidence","double precision",-1,null,false,0,"",""],["public.decisions.promotion_reason","text",-1,"default",true,null,"",""],["public.decisions.source_window_start","double precision",-1,null,true,null,"",""],["public.decisions.source_window_end","double precision",-1,null,true,null,"",""],["public.jobs.id","text",-1,"default",false,null,"",""],["public.jobs.owner_user_id","text",-1,"default",false,null,"",""],["public.jobs.meeting_id","text",-1,"default",true,null,"",""],["public.jobs.job_type","text",-1,"default",false,null,"",""],["public.jobs.status","text",-1,"default",false,null,"",""],["public.jobs.stage","text",-1,"default",false,null,"",""],["public.jobs.elapsed_ms","integer",-1,null,false,0,"",""],["public.jobs.error","text",-1,"default",true,null,"",""],["public.jobs.retry_count","integer",-1,null,false,0,"",""],["public.jobs.created_at","timestamp with time zone",-1,null,false,null,"",""],["public.jobs.updated_at","timestamp with time zone",-1,null,false,null,"",""],["public.jobs.tenant_id","text",-1,"default",true,null,"",""],["public.jobs.payload","jsonb",-1,null,false,"'{}'::jsonb","",""],["public.jobs.result","jsonb",-1,null,false,"'{}'::jsonb","",""],["public.jobs.scheduled_at","timestamp with time zone",-1,null,true,null,"",""],["public.jobs.started_at","timestamp with time zone",-1,null,true,null,"",""],["public.jobs.finished_at","timestamp with time zone",-1,null,true,null,"",""],["public.jobs.idempotency_key","text",-1,"default",true,null,"",""],["public.meeting_links.id","text",-1,"default",false,null,"",""],["public.meeting_links.tenant_id","text",-1,"default",false,null,"",""],["public.meeting_links.meeting_id","text",-1,"default",false,null,"",""],["public.meeting_links.linked_meeting_id","text",-1,"default",false,null,"",""],["public.meeting_links.reason","text",-1,"default",false,null,"",""],["public.meeting_links.score","double precision",-1,null,false,0,"",""],["public.meeting_links.created_at","timestamp with time zone",-1,null,false,"now()","",""],["public.meeting_state.id","text",-1,"default",false,null,"",""],["public.meeting_state.tenant_id","text",-1,"default",false,null,"",""],["public.meeting_state.meeting_id","text",-1,"default",false,null,"",""],["public.meeting_state.window_start","double precision",-1,null,false,0,"",""],["public.meeting_state.window_end","double precision",-1,null,false,0,"",""],["public.meeting_state.current_topic","text",-1,"default",true,null,"",""],["public.meeting_state.current_goal","text",-1,"default",true,null,"",""],["public.meeting_state.summary_bullets","jsonb",-1,null,false,"'[]'::jsonb","",""],["public.meeting_state.decisions_forming","jsonb",-1,null,false,"'[]'::jsonb","",""],["public.meeting_state.blockers","jsonb",-1,null,false,"'[]'::jsonb","",""],["public.meeting_state.open_questions","jsonb",-1,null,false,"'[]'::jsonb","",""],["public.meeting_state.active_action_items","jsonb",-1,null,false,"'[]'::jsonb","",""],["public.meeting_state.confidence","double precision",-1,null,false,0,"",""],["public.meeting_state.created_at","timestamp with time zone",-1,null,false,"now()","",""],["public.meetings.id","text",-1,"default",false,null,"",""],["public.meetings.owner_user_id","text",-1,"default",true,null,"",""],["public.meetings.title","text",-1,"default",false,null,"",""],["public.meetings.status","text",-1,"default",false,null,"",""],["public.meetings.engine","text",-1,"default",false,null,"",""],["public.meetings.created_at","timestamp with time zone",-1,null,false,null,"",""],["public.meetings.updated_at","timestamp with time zone",-1,null,false,null,"",""],["public.meetings.duration_seconds","integer",-1,null,false,0,"",""],["public.meetings.segment_count","integer",-1,null,false,0,"",""],["public.meetings.tenant_id","text",-1,"default",true,null,"",""],["public.meetings.visibility","text",-1,"default",false,"'private'","",""],["public.meetings.project_name","text",-1,"default",true,null,"",""],["public.meetings.tags","text[]",-1,null,false,"'{}'","",""],["public.meetings.participant_labels","text[]",-1,null,false,"'{}'","",""],["public.meetings.started_at","timestamp with time zone",-1,null,true,null,"",""],["public.meetings.ended_at","timestamp with time zone",-1,null,true,null,"",""],["public.meetings.primary_language","text",-1,"default",false,"'unknown'","",""],["public.meetings.buddy_mode","text",-1,"default",false,"'addressable'","",""],["public.open_questions.id","text",-1,"default",false,null,"",""],["public.open_questions.tenant_id","text",-1,"default",false,null,"",""],["public.open_questions.meeting_id","text",-1,"default",false,null,"",""],["public.open_questions.chapter_summary_id","text",-1,"default",true,null,"",""],["public.open_questions.text","text",-1,"default",false,null,"",""],["public.open_questions.status","text",-1,"default",false,"'open'","",""],["public.open_questions.evidence_refs","jsonb",-1,null,false,"'[]'::jsonb","",""],["public.open_questions.record_origin","text",-1,"default",false,"'generated'","",""],["public.open_questions.review_status","text",-1,"default",false,"'draft'","",""],["public.open_questions.created_at","timestamp with time zone",-1,null,false,"now()","",""],["public.open_questions.updated_at","timestamp with time zone",-1,null,false,"now()","",""],["public.open_questions.confidence","double precision",-1,null,false,0,"",""],["public.open_questions.promotion_reason","text",-1,"default",true,null,"",""],["public.open_questions.source_window_start","double precision",-1,null,true,null,"",""],["public.open_questions.source_window_end","double precision",-1,null,true,null,"",""],["public.organization_invitations.id","text",-1,"default",false,null,"",""],["public.organization_invitations.tenant_id","text",-1,"default",false,null,"",""],["public.organization_invitations.email","text",-1,"default",false,null,"",""],["public.organization_invitations.role","text",-1,"default",false,"'member'","",""],["public.organization_invitations.token_hash","text",-1,"default",false,null,"",""],["public.organization_invitations.status","text",-1,"default",false,"'pending'","",""],["public.organization_invitations.invited_by_user_id","text",-1,"default",true,null,"",""],["public.organization_invitations.accepted_by_user_id","text",-1,"default",true,null,"",""],["public.organization_invitations.expires_at","timestamp with time zone",-1,null,false,null,"",""],["public.organization_invitations.accepted_at","timestamp with time zone",-1,null,true,null,"",""],["public.organization_invitations.created_at","timestamp with time zone",-1,null,false,null,"",""],["public.organization_invitations.updated_at","timestamp with time zone",-1,null,false,null,"",""],["public.organization_memberships.id","text",-1,"default",false,null,"",""],["public.organization_memberships.tenant_id","text",-1,"default",false,null,"",""],["public.organization_memberships.user_id","text",-1,"default",false,null,"",""],["public.organization_memberships.role","text",-1,"default",false,"'member'","",""],["public.organization_memberships.status","text",-1,"default",false,"'active'","",""],["public.organization_memberships.invited_by_user_id","text",-1,"default",true,null,"",""],["public.organization_memberships.created_at","timestamp with time zone",-1,null,false,null,"",""],["public.organization_memberships.updated_at","timestamp with time zone",-1,null,false,null,"",""],["public.summaries.id","text",-1,"default",false,null,"",""],["public.summaries.owner_user_id","text",-1,"default",true,null,"",""],["public.summaries.meeting_id","text",-1,"default",false,null,"",""],["public.summaries.summary_text","text",-1,"default",false,null,"",""],["public.summaries.action_items","text[]",-1,null,false,"'{}'","",""],["public.summaries.key_topics","text[]",-1,null,false,"'{}'","",""],["public.summaries.created_at","timestamp with time zone",-1,null,false,null,"",""],["public.summaries.tenant_id","text",-1,"default",true,null,"",""],["public.tenants.id","text",-1,"default",false,null,"",""],["public.tenants.slug","text",-1,"default",false,null,"",""],["public.tenants.name","text",-1,"default",false,null,"",""],["public.tenants.created_at","timestamp with time zone",-1,null,false,"now()","",""],["public.tenants.updated_at","timestamp with time zone",-1,null,false,"now()","",""],["public.transcript_segments.id","text",-1,"default",false,null,"",""],["public.transcript_segments.owner_user_id","text",-1,"default",true,null,"",""],["public.transcript_segments.meeting_id","text",-1,"default",false,null,"",""],["public.transcript_segments.speaker_label","text",-1,"default",false,null,"",""],["public.transcript_segments.text","text",-1,"default",false,null,"",""],["public.transcript_segments.timestamp_start","double precision",-1,null,false,0,"",""],["public.transcript_segments.timestamp_end","double precision",-1,null,false,0,"",""],["public.transcript_segments.created_at","timestamp with time zone",-1,null,false,null,"",""],["public.transcript_segments.language_code","text",-1,"default",false,"'unknown'","",""],["public.transcript_segments.translated_text","text",-1,"default",true,null,"",""],["public.transcript_segments.tenant_id","text",-1,"default",true,null,"",""],["public.user_auth_identities.id","text",-1,"default",false,null,"",""],["public.user_auth_identities.user_id","text",-1,"default",false,null,"",""],["public.user_auth_identities.provider","text",-1,"default",false,null,"",""],["public.user_auth_identities.provider_user_id","text",-1,"default",false,null,"",""],["public.user_auth_identities.provider_email","text",-1,"default",true,null,"",""],["public.user_auth_identities.created_at","timestamp with time zone",-1,null,false,null,"",""],["public.user_auth_identities.updated_at","timestamp with time zone",-1,null,false,null,"",""],["public.users.id","text",-1,"default",false,null,"",""],["public.users.email","text",-1,"default",false,null,"",""],["public.users.password_hash","text",-1,"default",false,null,"",""],["public.users.name","text",-1,"default",true,null,"",""],["public.users.created_at","timestamp with time zone",-1,null,false,null,"",""],["public.users.updated_at","timestamp with time zone",-1,null,false,null,"",""]],"enums":[["public.activity_event_kind",["created","updated","dependency_added","dependency_removed"]],["public.actor_type",["human","agent","system","import"]],["public.agent_run_kind",["chat","agent_run"]],["public.agent_run_status",["running","completed","failed","canceled"]],["public.check_status",["todo","in_progress","completed"]],["public.collaboration_actor_kind",["human","agent","service"]],["public.conversation_event_kind",["message.created","message.edited","message.deleted","membership.added","membership.changed","membership.removed"]],["public.conversation_membership_role",["reader","writer","admin"]],["public.conversation_membership_status",["active","removed"]],["public.conversation_status",["active","archived"]],["public.dependency_relationship",["depends_on","blocks","complements"]],["public.injected_via",["pinned","retrieved","tool"]],["public.memory_enforcement",["advisory","hard"]],["public.memory_kind",["decision","fact","rule"]],["public.memory_scope_type",["org","project","work_item_type","work_item"]],["public.memory_source_kind",["meeting","chat","proposal","manual","import"]],["public.memory_status",["active","superseded","retracted","deferred"]],["public.memory_visibility",["private","org"]],["public.phase",["plan","execute","review","done"]],["public.priority",["critical","high","medium","low"]],["public.project_status",["backlog","planned","in_progress","paused","completed","canceled"]],["public.proposal_status",["pending","accepted","accepted_with_edits","rejected","superseded","expired","applied","failed"]],["public.status_category",["backlog","unstarted","started","completed","canceled","triage"]],["public.work_item_source",["manual","meeting","agent","feedback"]],["public.work_item_type",["feature","bug","chore","research"]]],"constraints":[{"table":"public.activity_events","name":"activity_events_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.activity_events","name":"activity_events_work_item_id_work_items_id_fk","kind":"f","columns":["work_item_id"],"refTable":"public.work_items","refColumns":["id"],"onDelete":"cascade","onUpdate":"no action","deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.activity_events","name":"activity_events_run_id_agent_runs_id_fk","kind":"f","columns":["run_id"],"refTable":"public.agent_runs","refColumns":["id"],"onDelete":"set null","onUpdate":"no action","deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.agent_runs","name":"agent_runs_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.agent_runs","name":"agent_runs_thread_id_chat_threads_id_fk","kind":"f","columns":["thread_id"],"refTable":"public.chat_threads","refColumns":["id"],"onDelete":"set null","onUpdate":"no action","deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.agent_runs","name":"agent_runs_tenant_conversation_fk","kind":"f","columns":["tenant_id","conversation_id"],"refTable":"public.conversations","refColumns":["tenant_id","id"],"onDelete":"restrict","onUpdate":"no action","deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.chat_threads","name":"chat_threads_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.checks","name":"checks_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.checks","name":"checks_work_item_id_work_items_id_fk","kind":"f","columns":["work_item_id"],"refTable":"public.work_items","refColumns":["id"],"onDelete":"cascade","onUpdate":"no action","deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.checks","name":"checks_run_id_agent_runs_id_fk","kind":"f","columns":["run_id"],"refTable":"public.agent_runs","refColumns":["id"],"onDelete":"set null","onUpdate":"no action","deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.collaboration_actors","name":"collaboration_actors_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.collaboration_actors","name":"collaboration_actors_tenant_id_uniq","kind":"u","columns":["tenant_id","id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.conversation_events","name":"conversation_events_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.conversation_events","name":"conversation_events_tenant_conversation_id_uniq","kind":"u","columns":["tenant_id","conversation_id","id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.conversation_events","name":"conversation_events_payload_size_check","kind":"c","columns":[],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":"octet_length(\"conversation_events\".\"payload\"::text) <= 262144"},{"table":"public.conversation_events","name":"conversation_events_references_size_check","kind":"c","columns":[],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":"jsonb_typeof(\"conversation_events\".\"references\") = 'array' and octet_length(\"conversation_events\".\"references\"::text) <= 65536"},{"table":"public.conversation_events","name":"conversation_events_tenant_conversation_fk","kind":"f","columns":["tenant_id","conversation_id"],"refTable":"public.conversations","refColumns":["tenant_id","id"],"onDelete":"no action","onUpdate":"no action","deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.conversation_events","name":"conversation_events_tenant_actor_fk","kind":"f","columns":["tenant_id","actor_id"],"refTable":"public.collaboration_actors","refColumns":["tenant_id","id"],"onDelete":"no action","onUpdate":"no action","deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.conversation_events","name":"conversation_events_tenant_reply_fk","kind":"f","columns":["tenant_id","conversation_id","reply_to_event_id"],"refTable":"public.conversation_events","refColumns":["tenant_id","conversation_id","id"],"onDelete":"no action","onUpdate":"no action","deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.conversation_events","name":"conversation_events_tenant_target_fk","kind":"f","columns":["tenant_id","conversation_id","target_event_id"],"refTable":"public.conversation_events","refColumns":["tenant_id","conversation_id","id"],"onDelete":"no action","onUpdate":"no action","deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.conversation_memberships","name":"conversation_memberships_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.conversation_memberships","name":"conversation_memberships_tenant_conversation_fk","kind":"f","columns":["tenant_id","conversation_id"],"refTable":"public.conversations","refColumns":["tenant_id","id"],"onDelete":"no action","onUpdate":"no action","deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.conversation_memberships","name":"conversation_memberships_tenant_actor_fk","kind":"f","columns":["tenant_id","actor_id"],"refTable":"public.collaboration_actors","refColumns":["tenant_id","id"],"onDelete":"no action","onUpdate":"no action","deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.conversation_memberships","name":"conversation_memberships_tenant_created_by_actor_fk","kind":"f","columns":["tenant_id","created_by_actor_id"],"refTable":"public.collaboration_actors","refColumns":["tenant_id","id"],"onDelete":"no action","onUpdate":"no action","deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.conversations","name":"conversations_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.conversations","name":"conversations_tenant_id_uniq","kind":"u","columns":["tenant_id","id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.conversations","name":"conversations_tenant_created_by_actor_fk","kind":"f","columns":["tenant_id","created_by_actor_id"],"refTable":"public.collaboration_actors","refColumns":["tenant_id","id"],"onDelete":"no action","onUpdate":"no action","deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.knowledge_chunks","name":"knowledge_chunks_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.meeting_promotions","name":"meeting_promotions_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.meeting_promotions","name":"meeting_promotions_proposal_id_proposals_id_fk","kind":"f","columns":["proposal_id"],"refTable":"public.proposals","refColumns":["id"],"onDelete":"cascade","onUpdate":"no action","deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.memories","name":"memories_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.memories","name":"memories_source_run_id_agent_runs_id_fk","kind":"f","columns":["source_run_id"],"refTable":"public.agent_runs","refColumns":["id"],"onDelete":"set null","onUpdate":"no action","deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.memories","name":"memories_source_proposal_id_proposals_id_fk","kind":"f","columns":["source_proposal_id"],"refTable":"public.proposals","refColumns":["id"],"onDelete":"set null","onUpdate":"no action","deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.projects","name":"projects_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.projects","name":"projects_run_id_agent_runs_id_fk","kind":"f","columns":["run_id"],"refTable":"public.agent_runs","refColumns":["id"],"onDelete":"set null","onUpdate":"no action","deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.proposals","name":"proposals_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.proposals","name":"proposals_run_id_agent_runs_id_fk","kind":"f","columns":["run_id"],"refTable":"public.agent_runs","refColumns":["id"],"onDelete":"set null","onUpdate":"no action","deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.run_knowledge_attributions","name":"run_knowledge_attributions_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.run_knowledge_attributions","name":"run_knowledge_attributions_run_id_agent_runs_id_fk","kind":"f","columns":["run_id"],"refTable":"public.agent_runs","refColumns":["id"],"onDelete":"cascade","onUpdate":"no action","deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.run_knowledge_attributions","name":"run_knowledge_attributions_memory_id_memories_id_fk","kind":"f","columns":["memory_id"],"refTable":"public.memories","refColumns":["id"],"onDelete":"cascade","onUpdate":"no action","deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.run_knowledge_attributions","name":"run_knowledge_attributions_chunk_id_knowledge_chunks_id_fk","kind":"f","columns":["chunk_id"],"refTable":"public.knowledge_chunks","refColumns":["id"],"onDelete":"cascade","onUpdate":"no action","deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.run_memory_attributions","name":"run_memory_attributions_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.run_memory_attributions","name":"run_memory_attributions_run_id_agent_runs_id_fk","kind":"f","columns":["run_id"],"refTable":"public.agent_runs","refColumns":["id"],"onDelete":"cascade","onUpdate":"no action","deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.run_memory_attributions","name":"run_memory_attributions_memory_id_memories_id_fk","kind":"f","columns":["memory_id"],"refTable":"public.memories","refColumns":["id"],"onDelete":"cascade","onUpdate":"no action","deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.statuses","name":"statuses_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.statuses","name":"statuses_team_name_uniq","kind":"u","columns":["team_id","name"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.statuses","name":"statuses_team_id_teams_id_fk","kind":"f","columns":["team_id"],"refTable":"public.teams","refColumns":["id"],"onDelete":"cascade","onUpdate":"no action","deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.statuses","name":"statuses_run_id_agent_runs_id_fk","kind":"f","columns":["run_id"],"refTable":"public.agent_runs","refColumns":["id"],"onDelete":"set null","onUpdate":"no action","deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.teams","name":"teams_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.teams","name":"teams_tenant_name_uniq","kind":"u","columns":["tenant_id","name"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.teams","name":"teams_run_id_agent_runs_id_fk","kind":"f","columns":["run_id"],"refTable":"public.agent_runs","refColumns":["id"],"onDelete":"set null","onUpdate":"no action","deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.work_item_dependencies","name":"work_item_dependencies_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.work_item_dependencies","name":"work_item_dependencies_edge_uniq","kind":"u","columns":["source_item_id","target_item_id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.work_item_dependencies","name":"work_item_dependencies_source_item_id_work_items_id_fk","kind":"f","columns":["source_item_id"],"refTable":"public.work_items","refColumns":["id"],"onDelete":"cascade","onUpdate":"no action","deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.work_item_dependencies","name":"work_item_dependencies_target_item_id_work_items_id_fk","kind":"f","columns":["target_item_id"],"refTable":"public.work_items","refColumns":["id"],"onDelete":"cascade","onUpdate":"no action","deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.work_item_dependencies","name":"work_item_dependencies_run_id_agent_runs_id_fk","kind":"f","columns":["run_id"],"refTable":"public.agent_runs","refColumns":["id"],"onDelete":"set null","onUpdate":"no action","deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.work_items","name":"work_items_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.work_items","name":"work_items_team_id_teams_id_fk","kind":"f","columns":["team_id"],"refTable":"public.teams","refColumns":["id"],"onDelete":"restrict","onUpdate":"no action","deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.work_items","name":"work_items_status_id_statuses_id_fk","kind":"f","columns":["status_id"],"refTable":"public.statuses","refColumns":["id"],"onDelete":"restrict","onUpdate":"no action","deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.work_items","name":"work_items_project_id_projects_id_fk","kind":"f","columns":["project_id"],"refTable":"public.projects","refColumns":["id"],"onDelete":"set null","onUpdate":"no action","deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.work_items","name":"work_items_run_id_agent_runs_id_fk","kind":"f","columns":["run_id"],"refTable":"public.agent_runs","refColumns":["id"],"onDelete":"set null","onUpdate":"no action","deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.action_items","name":"action_items_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.agent_invocations","name":"agent_invocations_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.agent_responses","name":"agent_responses_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.audio_assets","name":"audio_assets_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.chapter_summaries","name":"chapter_summaries_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.chat_messages","name":"chat_messages_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.decisions","name":"decisions_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.jobs","name":"jobs_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.meeting_links","name":"meeting_links_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.meeting_state","name":"meeting_state_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.meetings","name":"meetings_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.open_questions","name":"open_questions_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.organization_invitations","name":"organization_invitations_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.organization_invitations","name":"organization_invitations_token_hash_key","kind":"u","columns":["token_hash"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.organization_memberships","name":"organization_memberships_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.organization_memberships","name":"organization_memberships_tenant_id_user_id_key","kind":"u","columns":["tenant_id","user_id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.summaries","name":"summaries_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.summaries","name":"summaries_meeting_id_key","kind":"u","columns":["meeting_id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.tenants","name":"tenants_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.tenants","name":"tenants_slug_key","kind":"u","columns":["slug"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.transcript_segments","name":"transcript_segments_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.user_auth_identities","name":"user_auth_identities_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.user_auth_identities","name":"user_auth_identities_provider_provider_user_id_key","kind":"u","columns":["provider","provider_user_id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.users","name":"users_pkey","kind":"p","columns":["id"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null},{"table":"public.users","name":"users_email_key","kind":"u","columns":["email"],"refTable":null,"refColumns":[],"onDelete":null,"onUpdate":null,"deferrable":false,"initiallyDeferred":false,"definition":null}],"indexes":[{"table":"public.activity_events","name":"activity_events_work_item_idx","unique":false,"method":"btree","keys":["work_item_id"],"opclasses":["uuid_ops"],"include":[],"predicate":null},{"table":"public.agent_runs","name":"agent_runs_tenant_idx","unique":false,"method":"btree","keys":["tenant_id"],"opclasses":["text_ops"],"include":[],"predicate":null},{"table":"public.agent_runs","name":"agent_runs_thread_created_idx","unique":false,"method":"btree","keys":["thread_id","created_at"],"opclasses":["uuid_ops","timestamptz_ops"],"include":[],"predicate":null},{"table":"public.chat_threads","name":"chat_threads_tenant_list_idx","unique":false,"method":"btree","keys":["tenant_id","archived","updated_at"],"opclasses":["text_ops","bool_ops","timestamptz_ops"],"include":[],"predicate":null},{"table":"public.checks","name":"checks_work_item_idx","unique":false,"method":"btree","keys":["work_item_id"],"opclasses":["uuid_ops"],"include":[],"predicate":null},{"table":"public.collaboration_actors","name":"collaboration_actors_tenant_owner_uniq","unique":true,"method":"btree","keys":["tenant_id","owning_domain","owning_id"],"opclasses":["text_ops","text_ops","text_ops"],"include":[],"predicate":null},{"table":"public.conversation_events","name":"conversation_events_tenant_conversation_sequence_uniq","unique":true,"method":"btree","keys":["tenant_id","conversation_id","sequence"],"opclasses":["text_ops","uuid_ops","int8_ops"],"include":[],"predicate":null},{"table":"public.conversation_events","name":"conversation_events_tenant_conversation_idempotency_uniq","unique":true,"method":"btree","keys":["tenant_id","conversation_id","idempotency_key"],"opclasses":["text_ops","uuid_ops","text_ops"],"include":[],"predicate":null},{"table":"public.conversation_memberships","name":"conversation_memberships_tenant_conversation_actor_uniq","unique":true,"method":"btree","keys":["tenant_id","conversation_id","actor_id"],"opclasses":["text_ops","uuid_ops","uuid_ops"],"include":[],"predicate":null},{"table":"public.conversations","name":"conversations_tenant_legacy_uniq","unique":true,"method":"btree","keys":["tenant_id","legacy_source","legacy_id"],"opclasses":["text_ops","text_ops","text_ops"],"include":[],"predicate":null},{"table":"public.conversations","name":"conversations_tenant_updated_idx","unique":false,"method":"btree","keys":["tenant_id","updated_at"],"opclasses":["text_ops","timestamptz_ops"],"include":[],"predicate":null},{"table":"public.knowledge_chunks","name":"knowledge_chunks_tenant_scope","unique":false,"method":"btree","keys":["tenant_id","status","scope_type","scope_id"],"opclasses":["text_ops","text_ops","text_ops","uuid_ops"],"include":[],"predicate":null},{"table":"public.knowledge_chunks","name":"knowledge_chunks_dedup","unique":true,"method":"btree","keys":["tenant_id","source_type","source_ref","content_hash"],"opclasses":["text_ops","text_ops","text_ops","text_ops"],"include":[],"predicate":null},{"table":"public.meeting_promotions","name":"meeting_promotions_tenant_record_uniq","unique":true,"method":"btree","keys":["tenant_id","meeting_record_id"],"opclasses":["text_ops","text_ops"],"include":[],"predicate":null},{"table":"public.memories","name":"memories_tenant_scope_idx","unique":false,"method":"btree","keys":["tenant_id","status","scope_type","scope_id"],"opclasses":["text_ops","enum_ops","enum_ops","uuid_ops"],"include":[],"predicate":null},{"table":"public.memories","name":"memories_tenant_visibility_scope_idx","unique":false,"method":"btree","keys":["tenant_id","status","visibility","owner_user_id","scope_type","scope_id"],"opclasses":["text_ops","enum_ops","enum_ops","text_ops","enum_ops","uuid_ops"],"include":[],"predicate":null},{"table":"public.memories","name":"memories_tenant_root_idx","unique":false,"method":"btree","keys":["tenant_id","root_id"],"opclasses":["text_ops","uuid_ops"],"include":[],"predicate":null},{"table":"public.memories","name":"memories_source_proposal_uniq","unique":true,"method":"btree","keys":["source_proposal_id"],"opclasses":["uuid_ops"],"include":[],"predicate":"\"memories\".\"source_proposal_id\" is not null"},{"table":"public.projects","name":"projects_tenant_idx","unique":false,"method":"btree","keys":["tenant_id"],"opclasses":["text_ops"],"include":[],"predicate":null},{"table":"public.proposals","name":"proposals_tenant_status_idx","unique":false,"method":"btree","keys":["tenant_id","status"],"opclasses":["text_ops","enum_ops"],"include":[],"predicate":null},{"table":"public.proposals","name":"proposals_run_idx","unique":false,"method":"btree","keys":["run_id"],"opclasses":["uuid_ops"],"include":[],"predicate":null},{"table":"public.proposals","name":"proposals_target_idx","unique":false,"method":"btree","keys":["target_type","target_id"],"opclasses":["text_ops","uuid_ops"],"include":[],"predicate":null},{"table":"public.run_knowledge_attributions","name":"run_knowledge_attributions_run_idx","unique":false,"method":"btree","keys":["run_id"],"opclasses":["uuid_ops"],"include":[],"predicate":null},{"table":"public.run_memory_attributions","name":"run_memory_attributions_run_idx","unique":false,"method":"btree","keys":["run_id"],"opclasses":["uuid_ops"],"include":[],"predicate":null},{"table":"public.run_memory_attributions","name":"run_memory_attributions_memory_idx","unique":false,"method":"btree","keys":["memory_id"],"opclasses":["uuid_ops"],"include":[],"predicate":null},{"table":"public.statuses","name":"statuses_team_idx","unique":false,"method":"btree","keys":["team_id"],"opclasses":["uuid_ops"],"include":[],"predicate":null},{"table":"public.teams","name":"teams_tenant_idx","unique":false,"method":"btree","keys":["tenant_id"],"opclasses":["text_ops"],"include":[],"predicate":null},{"table":"public.work_item_dependencies","name":"work_item_dependencies_tenant_idx","unique":false,"method":"btree","keys":["tenant_id"],"opclasses":["text_ops"],"include":[],"predicate":null},{"table":"public.work_items","name":"work_items_tenant_idx","unique":false,"method":"btree","keys":["tenant_id"],"opclasses":["text_ops"],"include":[],"predicate":null},{"table":"public.work_items","name":"work_items_applied_from_proposal_uniq","unique":true,"method":"btree","keys":["applied_from_proposal_id"],"opclasses":["uuid_ops"],"include":[],"predicate":"\"work_items\".\"applied_from_proposal_id\" is not null"},{"table":"public.jobs","name":"idx_jobs_owner_created_at","unique":false,"method":"btree","keys":["owner_user_id","created_at"],"opclasses":["text_ops","timestamptz_ops"],"include":[],"predicate":null},{"table":"public.jobs","name":"idx_jobs_meeting_status_scheduled_at","unique":false,"method":"btree","keys":["meeting_id","status","scheduled_at"],"opclasses":["text_ops","text_ops","timestamptz_ops"],"include":[],"predicate":null},{"table":"public.jobs","name":"idx_jobs_idempotency_key","unique":true,"method":"btree","keys":["idempotency_key"],"opclasses":["text_ops"],"include":[],"predicate":"\"jobs\".\"idempotency_key\" is not null"},{"table":"public.organization_invitations","name":"idx_org_invites_tenant_email_status","unique":false,"method":"btree","keys":["tenant_id","email","status"],"opclasses":["text_ops","text_ops","text_ops"],"include":[],"predicate":null},{"table":"public.organization_invitations","name":"idx_org_invites_tenant_email_pending","unique":true,"method":"btree","keys":["tenant_id","email"],"opclasses":["text_ops","text_ops"],"include":[],"predicate":"\"organization_invitations\".\"status\" = 'pending'"},{"table":"public.organization_memberships","name":"idx_org_memberships_tenant_user","unique":false,"method":"btree","keys":["tenant_id","user_id"],"opclasses":["text_ops","text_ops"],"include":[],"predicate":null},{"table":"public.summaries","name":"idx_summaries_meeting_id","unique":false,"method":"btree","keys":["meeting_id"],"opclasses":["text_ops"],"include":[],"predicate":null},{"table":"public.user_auth_identities","name":"idx_user_auth_identities_user_id","unique":false,"method":"btree","keys":["user_id"],"opclasses":["text_ops"],"include":[],"predicate":null},{"table":"public.users","name":"idx_users_email","unique":false,"method":"btree","keys":["lower(\"email\")"],"opclasses":["text_ops"],"include":[],"predicate":null}]}$catalog_contract_data$::jsonb;
  expected_row jsonb;
  expected_type text;
  expected_typmod integer;
  expected_collation text;
  expected_nullable boolean;
  expected_default text;
  expected_identity text;
  expected_generated text;
  actual_kind "char";
  actual_type text;
  actual_typmod integer;
  actual_collation text;
  actual_nullable boolean;
  actual_default text;
  actual_identity text;
  actual_generated text;
  actual_enum text[];
  expected_enum text[];
  actual_constraint_kind "char";
  actual_columns text[];
  actual_ref_table text;
  actual_ref_columns text[];
  actual_delete "char";
  actual_update "char";
  actual_deferrable boolean;
  actual_deferred boolean;
  actual_definition text;
  expected_columns text[];
  expected_ref_columns text[];
  expected_delete "char";
  expected_update "char";
  actual_unique boolean;
  actual_method text;
  actual_keys text[];
  actual_opclasses text[];
  actual_include text[];
  actual_predicate text;
  expected_keys text[];
  expected_opclasses text[];
  expected_include text[];
BEGIN
  FOR expected_row IN
    SELECT value FROM jsonb_array_elements(expected_catalog->'relations') AS rows(value)
  LOOP
    SELECT c.relkind INTO actual_kind
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = split_part(expected_row->>0, '.', 1)
        AND c.relname = split_part(expected_row->>0, '.', 2);
    IF actual_kind IS DISTINCT FROM expected_row->>1 THEN
      RAISE EXCEPTION 'catalog mismatch: relation % kind', expected_row->>0 USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  FOR expected_row IN
    SELECT value FROM jsonb_array_elements(expected_catalog->'columns') AS rows(value)
  LOOP
    expected_type := expected_row->>1;
    expected_typmod := (expected_row->>2)::integer;
    expected_collation := expected_row->>3;
    expected_nullable := (expected_row->>4)::boolean;
    expected_default := expected_row->>5;
    expected_identity := coalesce(expected_row->>6, '');
    expected_generated := coalesce(expected_row->>7, '');
    SELECT replace(replace(format_type(a.atttypid, a.atttypmod), 'public.', ''), '"public".', ''),
           a.atttypmod,
           CASE WHEN a.attcollation = 0 THEN NULL ELSE coll.collname END,
           NOT a.attnotnull,
           pg_get_expr(d.adbin, d.adrelid),
           a.attidentity::text,
           a.attgenerated::text
      INTO actual_type, actual_typmod, actual_collation, actual_nullable,
           actual_default, actual_identity, actual_generated
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class r ON r.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = r.relnamespace
      LEFT JOIN pg_catalog.pg_collation coll ON coll.oid = a.attcollation
      LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE n.nspname = split_part(expected_row->>0, '.', 1)
        AND r.relname = split_part(split_part(expected_row->>0, '.', 2), '.', 1)
        AND a.attname = split_part(expected_row->>0, '.', 3)
        AND a.attnum > 0 AND NOT a.attisdropped;
    IF actual_type IS NULL
       OR actual_type IS DISTINCT FROM expected_type
       OR actual_typmod IS DISTINCT FROM expected_typmod
       OR actual_collation IS DISTINCT FROM expected_collation
       OR actual_nullable IS DISTINCT FROM expected_nullable
       OR regexp_replace(regexp_replace(lower(coalesce(actual_default, '')), '::[a-z0-9_." ]+', '', 'g'), '\[\]', '', 'g')
          IS DISTINCT FROM regexp_replace(regexp_replace(lower(coalesce(expected_default, '')), '::[a-z0-9_." ]+', '', 'g'), '\[\]', '', 'g')
       OR coalesce(actual_identity, '') IS DISTINCT FROM expected_identity
       OR coalesce(actual_generated, '') IS DISTINCT FROM expected_generated THEN
      RAISE EXCEPTION 'catalog mismatch: column %', expected_row->>0 USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  FOR expected_row IN
    SELECT value FROM jsonb_array_elements(expected_catalog->'enums') AS rows(value)
  LOOP
    expected_enum := ARRAY(SELECT jsonb_array_elements_text(expected_row->1));
    SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder) INTO actual_enum
      FROM pg_catalog.pg_type t
      JOIN pg_catalog.pg_enum e ON e.enumtypid = t.oid
      JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = split_part(expected_row->>0, '.', 1)
        AND t.typname = split_part(expected_row->>0, '.', 2);
    IF actual_enum IS DISTINCT FROM expected_enum THEN
      RAISE EXCEPTION 'catalog mismatch: enum % order', expected_row->>0 USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  FOR expected_row IN
    SELECT value FROM jsonb_array_elements(expected_catalog->'constraints') AS rows(value)
  LOOP
    expected_columns := ARRAY(SELECT jsonb_array_elements_text(expected_row->'columns'));
    expected_ref_columns := ARRAY(SELECT jsonb_array_elements_text(expected_row->'refColumns'));
    expected_delete := CASE expected_row->>'onDelete'
      WHEN 'cascade' THEN 'c' WHEN 'restrict' THEN 'r' WHEN 'set null' THEN 'n'
      WHEN 'set default' THEN 'd' WHEN 'no action' THEN 'a' ELSE NULL END;
    expected_update := CASE expected_row->>'onUpdate'
      WHEN 'cascade' THEN 'c' WHEN 'restrict' THEN 'r' WHEN 'set null' THEN 'n'
      WHEN 'set default' THEN 'd' WHEN 'no action' THEN 'a' ELSE NULL END;
    SELECT c.contype,
           ARRAY(SELECT a.attname
             FROM unnest(c.conkey) WITH ORDINALITY key(attnum, ord)
             JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = key.attnum
             ORDER BY key.ord),
           CASE WHEN c.confrelid = 0 THEN NULL ELSE replace(c.confrelid::regclass::text, '"', '') END,
           ARRAY(SELECT a.attname
             FROM unnest(c.confkey) WITH ORDINALITY key(attnum, ord)
             JOIN pg_catalog.pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = key.attnum
             ORDER BY key.ord),
           c.confdeltype, c.confupdtype, c.condeferrable, c.condeferred,
           pg_get_constraintdef(c.oid, true)
      INTO actual_constraint_kind, actual_columns, actual_ref_table, actual_ref_columns,
           actual_delete, actual_update, actual_deferrable, actual_deferred, actual_definition
      FROM pg_catalog.pg_constraint c
      WHERE c.conname = expected_row->>'name'
        AND c.conrelid = to_regclass(expected_row->>'table');
    IF actual_constraint_kind IS NULL
       OR actual_constraint_kind IS DISTINCT FROM expected_row->>'kind'
       OR actual_columns IS DISTINCT FROM expected_columns
       OR (expected_row->>'kind' = 'f' AND (
            split_part(actual_ref_table, '.', 2) IS DISTINCT FROM split_part(expected_row->>'refTable', '.', 2)
            OR actual_ref_columns IS DISTINCT FROM expected_ref_columns
            OR actual_delete IS DISTINCT FROM expected_delete
            OR actual_update IS DISTINCT FROM expected_update))
       OR actual_deferrable IS DISTINCT FROM coalesce((expected_row->>'deferrable')::boolean, false)
       OR actual_deferred IS DISTINCT FROM coalesce((expected_row->>'initiallyDeferred')::boolean, false)
       OR (expected_row->>'kind' = 'c' AND
           regexp_replace(lower(replace(replace(actual_definition,
             format('"%s".', split_part(expected_row->>'table', '.', 2)), ''), 'CHECK ', '')),
             '[[:space:]"()]', '', 'g') IS DISTINCT FROM
           regexp_replace(lower(expected_row->>'definition'), '[[:space:]"()]', '', 'g')) THEN
      RAISE EXCEPTION 'catalog mismatch: constraint %', expected_row->>'table' || '.' || expected_row->>'name'
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  FOR expected_row IN
    SELECT value FROM jsonb_array_elements(expected_catalog->'indexes') AS rows(value)
  LOOP
    expected_keys := ARRAY(
      SELECT regexp_replace(lower(value), '[[:space:]""]', '', 'g')
      FROM jsonb_array_elements_text(expected_row->'keys') AS keys(value));
    expected_opclasses := ARRAY(SELECT jsonb_array_elements_text(expected_row->'opclasses'));
    expected_include := ARRAY(SELECT jsonb_array_elements_text(expected_row->'include'));
    SELECT i.indisunique,
           am.amname,
           ARRAY(SELECT regexp_replace(lower(pg_get_indexdef(i.indexrelid, key_no, true)),
             '[[:space:]""]', '', 'g')
             FROM generate_series(1, i.indnkeyatts) key_no),
           ARRAY(SELECT oc.opcname
             FROM generate_subscripts(i.indclass, 1) key_no
             JOIN pg_catalog.pg_opclass oc ON oc.oid = i.indclass[key_no]
             WHERE key_no <= i.indnkeyatts ORDER BY key_no),
           ARRAY(SELECT a.attname
             FROM pg_catalog.pg_attribute a
             WHERE a.attrelid = i.indexrelid AND a.attnum > i.indnkeyatts
             ORDER BY a.attnum),
           pg_get_expr(i.indpred, i.indrelid)
      INTO actual_unique, actual_method, actual_keys, actual_opclasses, actual_include, actual_predicate
      FROM pg_catalog.pg_index i
      JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
      JOIN pg_catalog.pg_am am ON am.oid = c.relam
      WHERE c.relnamespace = 'public'::regnamespace
        AND c.relname = expected_row->>'name';
    IF actual_method IS NULL
       OR actual_unique IS DISTINCT FROM (expected_row->>'unique')::boolean
       OR actual_method IS DISTINCT FROM expected_row->>'method'
       OR actual_keys IS DISTINCT FROM expected_keys
       OR actual_opclasses IS DISTINCT FROM expected_opclasses
       OR actual_include IS DISTINCT FROM expected_include
       OR regexp_replace(lower(coalesce(actual_predicate, '')), '[[:space:]""]', '', 'g')
          IS DISTINCT FROM regexp_replace(lower(coalesce(expected_row->>'predicate', '')), '[[:space:]""]', '', 'g') THEN
      RAISE EXCEPTION 'catalog mismatch: index %', expected_row->>'name' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $catalog_contract_assertions$;--> statement-breakpoint

REVOKE CREATE ON SCHEMA public FROM PUBLIC;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO product_suite_platform_runtime, product_suite_meeting_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO product_suite_platform_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO product_suite_meeting_runtime;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO product_suite_platform_runtime, product_suite_meeting_runtime;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO product_suite_platform_runtime, product_suite_meeting_runtime;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO product_suite_platform_runtime, product_suite_meeting_runtime;--> statement-breakpoint
COMMIT;
