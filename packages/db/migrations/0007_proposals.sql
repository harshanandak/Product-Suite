-- Proposals kernel (see docs/design/2026-07-13-agent-slice-v1-design.md §5 and
-- 2026-07-12-proposals-queue-design.md). Additive. A module-agnostic reviewable
-- intent to change something, applied through the same validated domain-command
-- layer as the human UI, plus the decision-corpus capture columns (edited_payload,
-- model_id, prompt_version, context_ref) that must exist from day one. Hand-authored
-- (drizzle-kit generate unavailable in the worktree; purely additive).
DO $$ BEGIN
 CREATE TYPE "public"."proposal_status" AS ENUM('pending','accepted','accepted_with_edits','rejected','superseded','expired','applied');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"run_id" uuid,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"operation" text NOT NULL,
	"payload" jsonb NOT NULL,
	"rationale" text,
	"confidence" real,
	"risk_level" text,
	"status" "public"."proposal_status" DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"edited_payload" jsonb,
	"rejection_reason" text,
	"applied_write" jsonb,
	"target_version" bigint,
	"model_id" text,
	"prompt_version" text,
	"context_ref" text,
	"actor_type" "public"."actor_type" DEFAULT 'agent' NOT NULL,
	"actor_id" text,
	"on_behalf_of" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_tenant_status_idx" ON "proposals" ("tenant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_run_idx" ON "proposals" ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_target_idx" ON "proposals" ("target_type","target_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposals" ADD CONSTRAINT "proposals_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
