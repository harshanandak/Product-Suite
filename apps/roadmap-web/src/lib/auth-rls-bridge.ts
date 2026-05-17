export const ROADMAP_RLS_AUTH_UID_POLICY_FILES = [
  '20250110000001_initial_multitenant_schema.sql',
  '20250111000002_fix_team_members_rls.sql',
  '20250114000000_add_ai_model_tracking.sql',
  '20251112115417_create_tags_table.sql',
] as const

export const RLS_AUTH_BRIDGE_REQUIREMENT =
  'RLS policies that depend on auth.uid() must receive an RLS-compatible canonical token or move behind server-side membership checks before Supabase Auth is removed from that data path.'
