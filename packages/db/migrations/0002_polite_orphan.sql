-- Statuses: replace the `phase` enum with per-team named workflow states over an
-- immutable `status_category`. Every team gets a default status set; each work
-- item's `status_id` is backfilled from its old `phase`.
--
-- Hand-authored (not raw drizzle output) because the generated
-- `ADD COLUMN status_id uuid NOT NULL` fails on existing rows. Expand/contract:
-- create type + table → seed defaults per team → add status_id NULLABLE →
-- backfill from phase → SET NOT NULL → FK. `phase` is RETAINED (deprecated).
CREATE TYPE "public"."status_category" AS ENUM('backlog', 'unstarted', 'started', 'completed', 'canceled', 'triage');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" "status_category" NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "statuses_team_name_uniq" UNIQUE("team_id","name")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "statuses" ADD CONSTRAINT "statuses_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "statuses_team_idx" ON "statuses" USING btree ("team_id");--> statement-breakpoint
-- Seed a default workflow for every existing team (one+ status per category we
-- backfill into). Idempotent via the (team_id, name) unique constraint.
INSERT INTO "statuses" ("team_id", "name", "category", "position")
SELECT t."id", d."name", d."category"::"status_category", d."position"
FROM "teams" t
CROSS JOIN (VALUES
	('Triage', 'triage', 0),
	('Backlog', 'backlog', 1),
	('Todo', 'unstarted', 2),
	('In Progress', 'started', 3),
	('In Review', 'started', 4),
	('Done', 'completed', 5),
	('Canceled', 'canceled', 6)
) AS d("name", "category", "position")
ON CONFLICT ("team_id", "name") DO NOTHING;--> statement-breakpoint
-- Add nullable first so the ADD COLUMN survives existing rows.
ALTER TABLE "work_items" ADD COLUMN "status_id" uuid;--> statement-breakpoint
-- Backfill each item's status from its phase, within its own team:
--   plan → Backlog, execute → In Progress, review → In Review, done → Done.
UPDATE "work_items" wi
SET "status_id" = s."id"
FROM "statuses" s
WHERE s."team_id" = wi."team_id"
  AND s."name" = (CASE wi."phase"
	WHEN 'plan' THEN 'Backlog'
	WHEN 'execute' THEN 'In Progress'
	WHEN 'review' THEN 'In Review'
	WHEN 'done' THEN 'Done'
  END);--> statement-breakpoint
-- Enforce NOT NULL only after every row has a status.
ALTER TABLE "work_items" ALTER COLUMN "status_id" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_items" ADD CONSTRAINT "work_items_status_id_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."statuses"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
