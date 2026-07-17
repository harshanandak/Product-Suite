-- Memory Brain P3a — pgvector + the knowledge-chunk store + the KB attribution
-- rail (see docs/design/2026-07-17-memory-brain-p3a.md §3). Additive only.
-- `knowledge_chunks` is the bulk, unreviewed recall layer (work-items now;
-- docs/meetings in P3b/P3c) that sits alongside the curated `memories` table —
-- different lifecycles, so NOT merged into one table (see design doc §1).
-- `memories` gets an `embedding` + `embed_model` so canon and recall share one
-- vector index. `run_knowledge_attributions` is a DEDICATED rail (not
-- `run_memory_attributions`) because a chunk can't satisfy that table's
-- memory_id FK, and a nullable FK there would weaken the existing P1/P2 rail.
-- Hand-authored (drizzle-kit generate unavailable in the worktree; purely
-- additive; halfvec/tsvector are not Drizzle column types — see schema.ts).
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint

-- The chunk store. `fts` is a GENERATED tsvector over `content`, authored here
-- exactly like `memories.fts` (migration 0010) — not a Drizzle column type.
CREATE TABLE IF NOT EXISTS "knowledge_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_ref" text NOT NULL,
	"chunk_index" integer DEFAULT 0 NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"embedding" halfvec(1024),
	"fts" tsvector GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED,
	"tier" integer NOT NULL,
	"scope_type" text DEFAULT 'org' NOT NULL,
	"scope_id" uuid,
	"topics" text[] DEFAULT '{}'::text[] NOT NULL,
	"event_time" timestamp with time zone,
	"embed_provider" text NOT NULL,
	"embed_model" text NOT NULL,
	"embed_dims" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- HNSW on the halfvec (cosine); GIN on fts; scope filter; exact-hash dedup.
CREATE INDEX IF NOT EXISTS "knowledge_chunks_hnsw" ON "knowledge_chunks" USING hnsw ("embedding" halfvec_cosine_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_chunks_fts" ON "knowledge_chunks" USING gin ("fts");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_chunks_tenant_scope" ON "knowledge_chunks" ("tenant_id","status","scope_type","scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_chunks_dedup" ON "knowledge_chunks" ("tenant_id","source_type","source_ref","content_hash");--> statement-breakpoint

-- Give `memories` an embedding so canon + recall answer one query (raw-SQL only;
-- not a Drizzle column — see schema.ts).
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "embedding" halfvec(1024);--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "embed_model" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memories_hnsw" ON "memories" USING hnsw ("embedding" halfvec_cosine_ops);--> statement-breakpoint

-- The KB attribution rail. A chunk can't satisfy run_memory_attributions'
-- memory_id FK (NOT NULL, references memories), and reusing that table would
-- either need a nullable FK (weakening the existing rail) or conflate the two
-- tools — so a dedicated table. EXACTLY ONE of memory_id/chunk_id is set.
CREATE TABLE IF NOT EXISTS "run_knowledge_attributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"tenant_id" text NOT NULL,
	"memory_id" uuid,
	"chunk_id" uuid,
	"kind" text NOT NULL,
	"rank" integer,
	"score" real,
	"suppressed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rka_exactly_one" CHECK (("memory_id" IS NULL) <> ("chunk_id" IS NULL))
);--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "run_knowledge_attributions" ADD CONSTRAINT "run_knowledge_attributions_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_knowledge_attributions" ADD CONSTRAINT "run_knowledge_attributions_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_knowledge_attributions" ADD CONSTRAINT "run_knowledge_attributions_chunk_id_knowledge_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."knowledge_chunks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "run_knowledge_attributions_run_idx" ON "run_knowledge_attributions" ("run_id");
