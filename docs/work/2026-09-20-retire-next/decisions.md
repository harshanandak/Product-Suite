# Decisions

- Next.js is being retired, not upgraded. Archived source remains recoverable; runnable manifests leave the active graph.
- Keep supported canvas and Hocuspocus coverage. Do not transplant the archived Supabase/Next adapter test into the supported stack.
- Keep migration evidence and database authority checks. Product feature parity is separate baseline work.
- Required GitHub contexts must describe supported services. Change protection only after concrete supported check evidence, preserving its prior settings for reversal.
- Independent coverage review found that Platform Web CI omits contracts and chat UI paths from its app-impact selector. Include both before requiring that check; otherwise its green result could omit validation of an affected app.
- Preserve the dirty root and existing worktrees. This branch starts from fetched main and stays separate from the pushed lint-once branch.
- Validation: the focused retirement cases failed first (232 passing, six expected failures), then all 238 passed. Frozen install made no changes; deployment verification and both supported Vite application builds passed. The critical audit threshold passed; lower-severity findings are not claimed resolved.
- Lock comparison found zero new resolution values and 304 removed values. Added keys re-hoist already locked versions after removal of Roadmap's competing dependency graph.
- Independent specification review passed. The normal guarded push will supply full local validation; exact-head CI and the required-context transition remain pending before merge readiness.
