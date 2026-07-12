-- Final ontology rename: the checklist tier `tasks` → `checks` (and its status
-- enum). "Task" is now the owned CHILD tier (a work item with a parent), so the
-- frozen checkbox tier is a "Check" — Task = owned work, Check = checkbox,
-- everywhere. Pure rename: NO data change. Hand-authored because drizzle-kit's
-- rename detection is interactive; renaming preserves rows (vs drop+create).
ALTER TYPE "public"."task_status" RENAME TO "check_status";--> statement-breakpoint
ALTER TABLE "tasks" RENAME TO "checks";--> statement-breakpoint
ALTER INDEX "tasks_work_item_idx" RENAME TO "checks_work_item_idx";--> statement-breakpoint
-- Constraint renames are cosmetic (keep names aligned to the table). Guarded so a
-- differently-auto-named constraint can't fail the migration.
DO $$ BEGIN
 ALTER TABLE "checks" RENAME CONSTRAINT "tasks_work_item_id_work_items_id_fk" TO "checks_work_item_id_work_items_id_fk";
EXCEPTION WHEN undefined_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "checks" RENAME CONSTRAINT "tasks_pkey" TO "checks_pkey";
EXCEPTION WHEN undefined_object THEN null; END $$;
