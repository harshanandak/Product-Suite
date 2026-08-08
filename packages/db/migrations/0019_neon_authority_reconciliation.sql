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

REVOKE CREATE ON SCHEMA public FROM PUBLIC;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO product_suite_platform_runtime, product_suite_meeting_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO product_suite_platform_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO product_suite_meeting_runtime;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO product_suite_platform_runtime, product_suite_meeting_runtime;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO product_suite_platform_runtime, product_suite_meeting_runtime;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO product_suite_platform_runtime, product_suite_meeting_runtime;--> statement-breakpoint
COMMIT;
