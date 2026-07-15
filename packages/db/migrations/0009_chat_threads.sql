-- Chat threads — durable agent chat (see docs/design/2026-07-15-thread-persistence.md).
-- Additive. A thread GROUPS the runs that produced it; its history is DERIVED by
-- concatenating those runs' UIMessage deltas (agent_runs.transcript, version 1), so
-- there is no second write path. Anchored to ONE org (tenant_id) exactly like
-- runs/proposals; `archived` is a soft-delete from day one. Hand-authored
-- (drizzle-kit generate unavailable in the worktree; purely additive).
CREATE TABLE IF NOT EXISTS "chat_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"linked_object" jsonb,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
-- The panel list: an org's newest non-archived threads first.
CREATE INDEX IF NOT EXISTS "chat_threads_tenant_list_idx" ON "chat_threads" ("tenant_id","archived","updated_at" DESC);--> statement-breakpoint
-- Link a chat run to its thread (nullable: legacy/autonomous runs stay unlinked).
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "thread_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
-- Reconstruction reads a thread's completed runs in creation order.
CREATE INDEX IF NOT EXISTS "agent_runs_thread_created_idx" ON "agent_runs" ("thread_id","created_at");
