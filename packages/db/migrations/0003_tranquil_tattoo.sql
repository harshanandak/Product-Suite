-- Sub-items (Tasks): work items gain an optional self-referential `parent_id`
-- and a materialized `depth`. Both are additive and safe on existing rows
-- (nullable / defaulted), so no backfill. The self-FK and child-lookup index are
-- added here (drizzle doesn't emit the self-reference from the plain column).
--
-- ON DELETE SET NULL: deleting a parent promotes its children to top-level rather
-- than destroying work. (The API resets `depth` to 0 when a row loses its parent.)
ALTER TABLE "work_items" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "depth" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_items" ADD CONSTRAINT "work_items_parent_id_work_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_items_parent_idx" ON "work_items" USING btree ("parent_id");
