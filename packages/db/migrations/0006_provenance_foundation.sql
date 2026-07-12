-- Provenance foundation (see docs/design/2026-07-12-actor-provenance-design.md).
-- Additive + backfill-safe, zero-downtime. Adds:
--   1. the `agent_runs` table (a run is first-class) + its enums,
--   2. the uniform `actor_*` provenance columns on every write table.
-- `actor_id` lands NULLABLE here on purpose: it becomes NOT NULL only in the
-- fast-follow, once every route writes through `recordWrite` and can never insert
-- a NULL. Hand-authored (drizzle-kit generate is unavailable in the worktree; the
-- change is purely additive so there is no rename to detect).

-- 1. Enums ------------------------------------------------------------------
DO $$ BEGIN
 CREATE TYPE "public"."actor_type" AS ENUM('human', 'agent', 'system', 'import');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."agent_run_kind" AS ENUM('chat', 'agent_run');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."agent_run_status" AS ENUM('running', 'completed', 'failed', 'canceled');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

-- 2. agent_runs -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"triggered_by" text NOT NULL,
	"kind" "public"."agent_run_kind" NOT NULL,
	"status" "public"."agent_run_status" DEFAULT 'running' NOT NULL,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_tenant_idx" ON "agent_runs" ("tenant_id");--> statement-breakpoint

-- 3. Provenance columns on every write table --------------------------------
-- Each: actor_type (default 'system' = unattributed, so a not-yet-converted
-- route's unstamped write never falsely claims 'human'; only an explicit
-- recordWrite stamp with a real actor_id earns 'human'), actor_id (nullable this
-- cut), on_behalf_of, run_id (nullable FK, SET NULL on run delete so a deleted
-- run never cascades away real work). Repeated per table for a readable diff.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "actor_type" "public"."actor_type" DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "actor_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "on_behalf_of" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "run_id" uuid;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "actor_type" "public"."actor_type" DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "actor_id" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "on_behalf_of" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "run_id" uuid;--> statement-breakpoint
ALTER TABLE "statuses" ADD COLUMN IF NOT EXISTS "actor_type" "public"."actor_type" DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "statuses" ADD COLUMN IF NOT EXISTS "actor_id" text;--> statement-breakpoint
ALTER TABLE "statuses" ADD COLUMN IF NOT EXISTS "on_behalf_of" text;--> statement-breakpoint
ALTER TABLE "statuses" ADD COLUMN IF NOT EXISTS "run_id" uuid;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "actor_type" "public"."actor_type" DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "actor_id" text;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "on_behalf_of" text;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "run_id" uuid;--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN IF NOT EXISTS "actor_type" "public"."actor_type" DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN IF NOT EXISTS "actor_id" text;--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN IF NOT EXISTS "on_behalf_of" text;--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN IF NOT EXISTS "run_id" uuid;--> statement-breakpoint
ALTER TABLE "work_item_dependencies" ADD COLUMN IF NOT EXISTS "actor_type" "public"."actor_type" DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_item_dependencies" ADD COLUMN IF NOT EXISTS "actor_id" text;--> statement-breakpoint
ALTER TABLE "work_item_dependencies" ADD COLUMN IF NOT EXISTS "on_behalf_of" text;--> statement-breakpoint
ALTER TABLE "work_item_dependencies" ADD COLUMN IF NOT EXISTS "run_id" uuid;--> statement-breakpoint
ALTER TABLE "activity_events" ADD COLUMN IF NOT EXISTS "actor_type" "public"."actor_type" DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_events" ADD COLUMN IF NOT EXISTS "actor_id" text;--> statement-breakpoint
ALTER TABLE "activity_events" ADD COLUMN IF NOT EXISTS "on_behalf_of" text;--> statement-breakpoint
ALTER TABLE "activity_events" ADD COLUMN IF NOT EXISTS "run_id" uuid;--> statement-breakpoint

-- 4. run_id foreign keys (SET NULL on run delete) ---------------------------
DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "teams" ADD CONSTRAINT "teams_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "statuses" ADD CONSTRAINT "statuses_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_items" ADD CONSTRAINT "work_items_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "checks" ADD CONSTRAINT "checks_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_item_dependencies" ADD CONSTRAINT "work_item_dependencies_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

-- 5. Backfill existing rows -------------------------------------------------
-- Rows that predate provenance have no known writer. Attribute them honestly as
-- an 'import' (they are being migrated into the provenance regime) with the
-- reserved nil-UUID sentinel actor, rather than mislabeling them as a specific
-- human. on_behalf_of stays NULL (no known authorizing human). The ADD COLUMN
-- above set them to 'system' via the default; this re-labels the pre-existing
-- rows to the more precise 'import'. Small tables here; one UPDATE each is safe.
--
-- FAST-FOLLOW NOTE (before `SET NOT NULL` on actor_id): rows written by
-- not-yet-converted routes BETWEEN this migration and the conversion land as
-- actor_type='system' (the default), actor_id=NULL — i.e. genuinely unattributed
-- (we never captured which human). The fast-follow only needs to fill those
-- residual NULL actor_ids with the nil-UUID sentinel (keeping actor_type as-is);
-- it must NOT relabel them 'human' or 'import'. Then `SET NOT NULL` is safe.
UPDATE "projects" SET "actor_type" = 'import', "actor_id" = '00000000-0000-0000-0000-000000000000' WHERE "actor_id" IS NULL;--> statement-breakpoint
UPDATE "teams" SET "actor_type" = 'import', "actor_id" = '00000000-0000-0000-0000-000000000000' WHERE "actor_id" IS NULL;--> statement-breakpoint
UPDATE "statuses" SET "actor_type" = 'import', "actor_id" = '00000000-0000-0000-0000-000000000000' WHERE "actor_id" IS NULL;--> statement-breakpoint
UPDATE "work_items" SET "actor_type" = 'import', "actor_id" = '00000000-0000-0000-0000-000000000000' WHERE "actor_id" IS NULL;--> statement-breakpoint
UPDATE "checks" SET "actor_type" = 'import', "actor_id" = '00000000-0000-0000-0000-000000000000' WHERE "actor_id" IS NULL;--> statement-breakpoint
UPDATE "work_item_dependencies" SET "actor_type" = 'import', "actor_id" = '00000000-0000-0000-0000-000000000000' WHERE "actor_id" IS NULL;--> statement-breakpoint
UPDATE "activity_events" SET "actor_type" = 'import', "actor_id" = '00000000-0000-0000-0000-000000000000' WHERE "actor_id" IS NULL;
