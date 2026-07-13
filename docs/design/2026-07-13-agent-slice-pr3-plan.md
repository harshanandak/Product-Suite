# PR3 — Review Inbox UI

**Scope:** Pending-proposals inbox UI + accept/reject controls + diff display. The surface where humans dispose of what agents propose.

**4 TDD tasks:**

1. **Inbox list view** — `GET /api/proposals?status=pending&tenant_id=$` paginated, display as a card list (title, type, model_id, created_at, user/actor). Reuse `packages/ui-chat` + `ui/src/components/status-pill` + `SortableTable` patterns.

2. **Proposal detail / diff view** — click a proposal → display the full `(target_type, operation, payload)` + `edited_payload` side-by-side diff (if edited), plus the captured `context_shown` summary.

3. **Accept / reject controls** — modal on the detail view: "Review this proposal. Accept (apply to live data) or Reject (mark invalid). Edit payload before accepting if needed." Call `PATCH /api/proposals/{id}` with `status='applied'|'rejected'` + optional `edited_payload`. Optimistic UI.

4. **Integration test** — simulate a proposal in the DB, render the inbox, accept it, verify the `work_items` row was created with the right provenance (`actor_type='agent'`, `on_behalf_of=current_user`, `run_id=X`).

**Design tokens / reuse:**
- Reuse `packages/ui-chat` for message/action card styling (or adapt it; inbox cards ≈ proposal cards).
- Buttons: shadcn "Accept" (green, md), "Reject" (red, md), "Edit" (outline, sm).
- Diff view: split-pane or stacked (decision: split preferred; stacked fallback if mobile).
- Card colors: use the same `--health-*` / `--priority-*` tokens from `work-item-board.html` mockups — consistency is the goal.

**Security:**
- Only current tenant's proposals are fetched (scoped by `callerTenantIds`).
- `decided_by` is stamped server-side from Clerk identity, never client-supplied.
- Payload validation is the server's job; UI is display-only on accept.

**Hard stop before merge:** screenshots of the inbox + proposal detail against `work-item-board.html` to confirm visual consistency (cards, spacing, tokens, Geist font weight).
