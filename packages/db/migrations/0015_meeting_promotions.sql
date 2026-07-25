-- Meeting → board loop (end-to-end-meeting-0c1a2ac1), Task B.1 — the dedup ledger.
-- One row per meeting record already turned into a proposal, so re-running the
-- ingest proposes each candidate exactly once.
--
-- `meeting_record_id` is meeting-api's CONTENT-DERIVED id, not the meeting row's
-- primary key: meeting-api rematerializes action items by DELETE + re-INSERT
-- (server.py), so a row id is reborn on every reprocess and would dedup nothing.
-- TEXT because that id lives in meeting-api's TEXT key space.
--
-- The unique index is COMPOSITE on (tenant_id, meeting_record_id) — a
-- content-derived id can legitimately collide across tenants, and keying on the
-- id alone would let one tenant's promotion silently suppress another's.
-- Hand-authored (drizzle-kit generate unavailable in the worktree; see 0011/0012/0014).
CREATE TABLE IF NOT EXISTS "meeting_promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"meeting_record_id" text NOT NULL,
	"proposal_id" uuid NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meeting_promotions" ADD CONSTRAINT "meeting_promotions_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "meeting_promotions_tenant_record_uniq" ON "meeting_promotions" ("tenant_id","meeting_record_id");
