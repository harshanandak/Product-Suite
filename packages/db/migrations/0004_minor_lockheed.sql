-- Projects enrichment: the cross-team OUTCOME container gains its own lifecycle
-- `status`, an optional `lead_id`, and an optional `target_date`. All additive and
-- safe on existing rows (status is defaulted; lead/target are nullable) — no backfill.
-- The lead_id → users FK is hand-added here (users is Alembic-owned), mirroring
-- work_items.assignee_id (ON DELETE SET NULL). Health stays DERIVED, never stored.
CREATE TYPE "public"."project_status" AS ENUM('backlog', 'planned', 'in_progress', 'paused', 'completed', 'canceled');--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "status" "project_status" DEFAULT 'backlog' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "lead_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "target_date" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_lead_id_users_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
