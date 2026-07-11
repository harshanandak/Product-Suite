-- Sub-items (Tasks): work items gain an optional self-referential `parent_id`
-- and a materialized `depth`. Both are additive and safe on existing rows
-- (nullable / defaulted), so no backfill. The self-FK and child-lookup index are
-- added here (drizzle doesn't emit the self-reference from the plain column).
--
-- ON DELETE RESTRICT: a parent that still has sub-items cannot be hard-deleted —
-- children must be detached first (which resets their depth to 0 via the API).
-- This keeps `depth` from ever going stale: children are never silently orphaned
-- with a leftover depth=1. (Items are normally ARCHIVED, not deleted.)
ALTER TABLE "work_items" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "depth" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_items" ADD CONSTRAINT "work_items_parent_id_work_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."work_items"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_items_parent_idx" ON "work_items" USING btree ("parent_id");
