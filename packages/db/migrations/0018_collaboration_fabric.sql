-- Canonical collaboration authority. Additive only: legacy chat_threads and
-- agent_runs.thread_id remain available throughout the compatibility cutover.
DO $$ BEGIN
 CREATE TYPE "collaboration_actor_kind" AS ENUM ('human', 'agent', 'service');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "conversation_status" AS ENUM ('active', 'archived');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "conversation_membership_role" AS ENUM ('reader', 'writer', 'admin');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "conversation_membership_status" AS ENUM ('active', 'removed');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "conversation_event_kind" AS ENUM ('message.created', 'message.edited', 'message.deleted', 'membership.added', 'membership.changed', 'membership.removed');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "collaboration_actors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "kind" "collaboration_actor_kind" NOT NULL,
  "owning_domain" text NOT NULL,
  "owning_id" text NOT NULL,
  "disabled_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "collaboration_actors_tenant_id_uniq" UNIQUE ("tenant_id", "id")
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "collaboration_actors_tenant_owner_uniq" ON "collaboration_actors" ("tenant_id", "owning_domain", "owning_id");--> statement-breakpoint

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
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "conversations_tenant_id_uniq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "conversations_tenant_created_by_actor_fk" FOREIGN KEY ("tenant_id","created_by_actor_id") REFERENCES "collaboration_actors"("tenant_id","id") ON DELETE restrict
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_tenant_legacy_uniq" ON "conversations" ("tenant_id", "legacy_source", "legacy_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_tenant_updated_idx" ON "conversations" ("tenant_id", "updated_at" DESC);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "conversation_memberships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "conversation_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "role" "conversation_membership_role" NOT NULL,
  "status" "conversation_membership_status" DEFAULT 'active' NOT NULL,
  "created_by_actor_id" uuid NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "conversation_memberships_tenant_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "conversations"("tenant_id","id") ON DELETE cascade,
  CONSTRAINT "conversation_memberships_tenant_actor_fk" FOREIGN KEY ("tenant_id","actor_id") REFERENCES "collaboration_actors"("tenant_id","id") ON DELETE restrict,
  CONSTRAINT "conversation_memberships_tenant_created_by_actor_fk" FOREIGN KEY ("tenant_id","created_by_actor_id") REFERENCES "collaboration_actors"("tenant_id","id") ON DELETE restrict
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_memberships_tenant_conversation_actor_uniq" ON "conversation_memberships" ("tenant_id", "conversation_id", "actor_id");--> statement-breakpoint

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
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "conversation_events_tenant_conversation_id_uniq" UNIQUE ("tenant_id", "conversation_id", "id"),
  CONSTRAINT "conversation_events_tenant_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "conversations"("tenant_id","id") ON DELETE cascade,
  CONSTRAINT "conversation_events_tenant_actor_fk" FOREIGN KEY ("tenant_id","actor_id") REFERENCES "collaboration_actors"("tenant_id","id") ON DELETE restrict,
  CONSTRAINT "conversation_events_tenant_reply_fk" FOREIGN KEY ("tenant_id","conversation_id","reply_to_event_id") REFERENCES "conversation_events"("tenant_id","conversation_id","id") ON DELETE restrict,
  CONSTRAINT "conversation_events_tenant_target_fk" FOREIGN KEY ("tenant_id","conversation_id","target_event_id") REFERENCES "conversation_events"("tenant_id","conversation_id","id") ON DELETE restrict,
  CONSTRAINT "conversation_events_payload_size_check" CHECK (octet_length("payload"::text) <= 262144),
  CONSTRAINT "conversation_events_references_size_check" CHECK (jsonb_typeof("references") = 'array' AND octet_length("references"::text) <= 65536)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_events_tenant_conversation_sequence_uniq" ON "conversation_events" ("tenant_id", "conversation_id", "sequence");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_events_tenant_conversation_idempotency_uniq" ON "conversation_events" ("tenant_id", "conversation_id", "idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_events_tenant_conversation_cursor_idx" ON "conversation_events" ("tenant_id", "conversation_id", "sequence");--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_conversation_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'conversation_events are immutable';
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "conversation_events_immutable" ON "conversation_events";--> statement-breakpoint
CREATE TRIGGER "conversation_events_immutable"
BEFORE UPDATE OR DELETE ON "conversation_events"
FOR EACH ROW EXECUTE FUNCTION prevent_conversation_event_mutation();--> statement-breakpoint

ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "conversation_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_conversation_created_idx" ON "agent_runs" ("conversation_id", "created_at");
