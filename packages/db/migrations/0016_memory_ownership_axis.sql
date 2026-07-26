-- Personal-vs-org dual-tier memory, v1 slice (personal-vs-org-memory-b0d3975f;
-- research docs/research/2026-07-25-personal-vs-org-memory.md rec #1 + #2).
--
-- Adds the OWNERSHIP axis to `memories`, orthogonal to the existing `scope_type`
-- cascade. Scope answers "what is this about" and cascades; visibility answers
-- "who may see it". Modelling the tier as a `scope_type='user'` value instead
-- would conflate the two and make "my private note about project X"
-- unrepresentable (§2.1).
--
-- This migration touches ZERO existing rows: `visibility` lands NOT NULL with
-- DEFAULT 'org', so every memory that exists today keeps exactly its current
-- reach and the org tier cannot regress.
--
-- The privacy boundary is a DB CHECK, not a convention. A nullable JSONB key or a
-- topics[] tag fails OPEN on every code path that forgets it; a NOT NULL indexed
-- column plus a biconditional CHECK fails CLOSED.
--
-- `run_memory_attributions` gains the tier columns in the SAME migration even
-- though nothing writes private rows yet: attribution is only recoverable going
-- forward, so retrofitting it later would permanently lose the early cohort (§2.6).
--
-- Hand-authored (drizzle-kit generate unavailable in the worktree; see
-- 0011/0012/0014/0015). No meta snapshot: the snapshot chain in this repo stops at
-- 0011 and 0012-0015 ship SQL + journal only.
DO $$ BEGIN
 CREATE TYPE "memory_visibility" AS ENUM('private', 'org');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "visibility" "memory_visibility" DEFAULT 'org' NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "owner_user_id" text;--> statement-breakpoint
-- The biconditional: a private memory MUST name its owner (an unowned private row
-- is retrievable by nobody, i.e. silently dead) and an org memory MUST NOT (an
-- owned org row is a mislabelled private one, i.e. a leak that reads as intended).
DO $$ BEGIN
 ALTER TABLE "memories" ADD CONSTRAINT "memories_private_requires_owner" CHECK (("visibility" = 'private') = ("owner_user_id" IS NOT NULL));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
-- The predicate shape BOTH retrieval lanes use: the org lane always constrains
-- `visibility`, and the private lane adds `owner_user_id = :asker`. Added
-- alongside `memories_tenant_scope_idx` rather than replacing it — other domain
-- queries still filter (tenant, status, scope) with no visibility term.
CREATE INDEX IF NOT EXISTS "memories_tenant_visibility_scope_idx" ON "memories" ("tenant_id","status","visibility","owner_user_id","scope_type","scope_id");--> statement-breakpoint
ALTER TABLE "run_memory_attributions" ADD COLUMN IF NOT EXISTS "visibility" "memory_visibility" DEFAULT 'org' NOT NULL;--> statement-breakpoint
ALTER TABLE "run_memory_attributions" ADD COLUMN IF NOT EXISTS "owner_matched" boolean DEFAULT false NOT NULL;
