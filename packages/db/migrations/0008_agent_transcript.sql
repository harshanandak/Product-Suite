-- Agent-run transcript capture (see docs/design/2026-07-13-agent-slice-pr2-plan.md
-- Task 1 and 2026-07-13-agent-slice-v1-design.md §13). Additive. The full
-- messages + tool-calls array is written once at run end, turning a completed run
-- into a self-contained, replayable decision-corpus record. Nullable — it is null
-- while the run is 'running' and populated on completion. Hand-authored
-- (drizzle-kit generate unavailable in the worktree; purely additive).
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "transcript" jsonb;
