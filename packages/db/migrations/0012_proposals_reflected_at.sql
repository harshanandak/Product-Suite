-- Memory Brain P2a — idempotency marker for the reflection engine. A correction
-- (an accepted proposal with edited_payload) is mined into at most one rule proposal;
-- reflected_at is stamped ONLY when the correction is folded into an emitted rule
-- proposal, so a sub-threshold pattern stays NULL and can mature on a later run.
-- Additive + nullable; hand-authored (drizzle-kit generate unavailable in the worktree).
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "reflected_at" timestamptz;
