-- Atomic-accept wave (2b91cd2c) — make the work-item apply-idempotency index
-- explicitly PARTIAL, matching `memories_source_proposal_uniq` (0011) and the schema.
-- `applied_from_proposal_id` is NULL for every human-created/updated item and non-null
-- only for a proposal-applied create; the unique index is the idempotency key that lets
-- the write-first apply path re-drive safely (a duplicate insert returns the existing
-- row). Postgres already treats NULLs as distinct, so 0007's non-partial index behaved
-- the same for uniqueness — this restates intent explicitly and drops the NULLs from the
-- index (smaller, and unambiguous to a reader). Purely a redefinition; no data change.
-- Hand-authored (drizzle-kit generate unavailable in the worktree; see 0011/0012).
DROP INDEX IF EXISTS "work_items_applied_from_proposal_uniq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "work_items_applied_from_proposal_uniq" ON "work_items" ("applied_from_proposal_id") WHERE "applied_from_proposal_id" IS NOT NULL;
