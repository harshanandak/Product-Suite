-- Memory Brain P1 — the semantic decision/knowledge store + the attribution rail
-- (see docs/design/2026-07-15-memory-brain-p1.md). Additive. `memories` is ONE
-- table (kind = decision | fact | rule; rules land in P2) anchored to ONE org
-- (tenant_id) exactly like runs/proposals. Supersession is APPEND-ONLY: a new
-- version row is inserted and the old is latched (never overwritten).
-- `run_memory_attributions` is the moat rail — one row per injected memory.
-- Hand-authored (drizzle-kit generate unavailable in the worktree; purely additive).

-- Enums (idempotent create — an aborted re-run must not fail on an existing type).
DO $$ BEGIN
 CREATE TYPE "public"."memory_kind" AS ENUM('decision', 'fact', 'rule');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."memory_status" AS ENUM('active', 'superseded', 'retracted', 'deferred');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."memory_scope_type" AS ENUM('org', 'project', 'work_item_type', 'work_item');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."memory_source_kind" AS ENUM('meeting', 'chat', 'proposal', 'manual', 'import');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."memory_enforcement" AS ENUM('advisory', 'hard');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."injected_via" AS ENUM('pinned', 'retrieved', 'tool');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

-- The memories table. `fts` is a GENERATED tsvector over title+body (the FTS axis);
-- `topics` is a text[] (the topic axis). Self-referential supersession columns
-- (root_id / supersedes_id / superseded_by_id) get their FKs added below, after the
-- table exists.
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
	"fts" tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce("title", '') || ' ' || coalesce("body", ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Provenance FKs to the Drizzle-owned run/proposal tables (SET NULL: a deleted
-- source must not cascade away the decision it produced).
DO $$ BEGIN
 ALTER TABLE "memories" ADD CONSTRAINT "memories_source_run_id_agent_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memories" ADD CONSTRAINT "memories_source_proposal_id_proposals_id_fk" FOREIGN KEY ("source_proposal_id") REFERENCES "public"."proposals"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
-- Self-referential supersession FKs. supersedes_id is immutable; superseded_by_id is
-- the only mutable pointer (latched on the old row). root_id is the chain head.
DO $$ BEGIN
 ALTER TABLE "memories" ADD CONSTRAINT "memories_supersedes_id_memories_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."memories"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memories" ADD CONSTRAINT "memories_superseded_by_id_memories_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."memories"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

-- Retrieval filter (an org's active memories at a scope), chain resolution, and the
-- two axes (topics GIN, fts GIN).
CREATE INDEX IF NOT EXISTS "memories_tenant_scope_idx" ON "memories" ("tenant_id","status","scope_type","scope_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memories_tenant_root_idx" ON "memories" ("tenant_id","root_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memories_topics_gin_idx" ON "memories" USING gin ("topics");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memories_fts_gin_idx" ON "memories" USING gin ("fts");--> statement-breakpoint

-- The attribution rail — one row per memory injected into a run's context.
CREATE TABLE IF NOT EXISTS "run_memory_attributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"memory_id" uuid NOT NULL,
	"tenant_id" text NOT NULL,
	"injected_via" "injected_via" NOT NULL,
	"rank" integer,
	"tokens" integer,
	"suppressed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_memory_attributions" ADD CONSTRAINT "run_memory_attributions_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_memory_attributions" ADD CONSTRAINT "run_memory_attributions_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "run_memory_attributions_run_idx" ON "run_memory_attributions" ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "run_memory_attributions_memory_idx" ON "run_memory_attributions" ("memory_id");--> statement-breakpoint

-- The P2 holdout flag on the run (always false in P1; assigned at run start).
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "memory_holdout" boolean DEFAULT false NOT NULL;
