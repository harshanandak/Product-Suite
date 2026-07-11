-- Teams promotion: `work_items.department` (free text) becomes a first-class
-- `teams` table, and every work item gains a mandatory `team_id`.
--
-- This migration is hand-authored (not raw drizzle-kit output) because the
-- generated `ADD COLUMN team_id uuid NOT NULL` fails on existing rows. It follows
-- the expand/contract order: create teams → backfill teams (1:1 from DISTINCT
-- department) → add team_id NULLABLE → backfill → SET NOT NULL → add FK. `department`
-- is intentionally RETAINED (deprecated) for one contract cycle for back-compat.
CREATE TABLE IF NOT EXISTS "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_tenant_name_uniq" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teams_tenant_idx" ON "teams" USING btree ("tenant_id");--> statement-breakpoint
-- One team per DISTINCT (tenant_id, department). 1:1 department → team (founder-confirmed).
INSERT INTO "teams" ("tenant_id", "name")
SELECT DISTINCT "tenant_id", "department" FROM "work_items"
ON CONFLICT ("tenant_id", "name") DO NOTHING;--> statement-breakpoint
-- Add nullable first so the ADD COLUMN survives existing rows.
ALTER TABLE "work_items" ADD COLUMN "team_id" uuid;--> statement-breakpoint
-- Backfill each item's team from its department within the same org.
UPDATE "work_items" wi
SET "team_id" = t."id"
FROM "teams" t
WHERE t."tenant_id" = wi."tenant_id" AND t."name" = wi."department";--> statement-breakpoint
-- Enforce NOT NULL only after every row has a team.
ALTER TABLE "work_items" ALTER COLUMN "team_id" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_items" ADD CONSTRAINT "work_items_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
