-- Memory Brain P1b — harden the create-idempotency guard. `applyMemoryCommand`
-- (proposals/apply.ts) does a check-then-insert on `source_proposal_id`
-- (getMemoryBySourceProposalId → createMemory), so two concurrent re-drives of the
-- SAME proposal could both miss the check and double-create the memory. A PARTIAL
-- UNIQUE index makes the second insert fail at the DB, so at most one memory can ever
-- be created from a given proposal. Partial (WHERE source_proposal_id IS NOT NULL) so
-- the many rows with a NULL source (human/meeting/import memories) are unconstrained.
-- Hand-authored (drizzle-kit generate unavailable in the worktree; purely additive).
CREATE UNIQUE INDEX IF NOT EXISTS "memories_source_proposal_uniq" ON "memories" ("source_proposal_id") WHERE "source_proposal_id" IS NOT NULL;
