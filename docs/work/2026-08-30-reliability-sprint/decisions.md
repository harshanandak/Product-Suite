# Reliability Sprint Decisions

## D1 — PR order

Locked order is R3 → R2 → R1 → R4, with one open PR at a time.

## D2 — merge and ancestry controls

Before every push, prove exact current `origin/main` ancestry. Forge merge
predicates remain `checks_green`, `threads_resolved`, and `settle_min10`.

## D3 — scope boundary

This sprint makes no Forge repository, Neon, gate, or branch-protection changes.
R3 changes only DB CI authority classification and its tests; delivery classifier
coverage remains separate.

## D4 — critic result

Muse 9.30 PASS; GLM 9.33 PASS; DeepSeek V4 Flash 9.48 PASS; DeepSeek V4 Pro
9.50 PASS.

## Unresolved decisions

None.
