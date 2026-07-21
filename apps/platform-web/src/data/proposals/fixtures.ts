import type { Proposal } from "./types";

/**
 * In-memory mock dataset for the agent-proposal review seam.
 *
 * Three proposals chosen to exercise the inbox end-to-end:
 *  - ONE `create` — a brand-new work item whose payload carries the core fields a
 *    reviewer decides on (`title` / `team_id` / `status_id` / `priority`), plus a
 *    rationale, model self-confidence, and provenance (`run_id` / `model_id`).
 *  - TWO `update`s — each `target_id` points at a REAL work-item fixture id
 *    (`wi_auth`, `wi_realtime` from `data/work-items/fixtures`), and each payload
 *    changes fields whose current values differ, so `ProposalDetail` renders a
 *    genuine `current → proposed` field diff (the whole point of the update view).
 *
 * Confidence is varied (high / mid / very-high) so the confidence badge shows a
 * spread. `RAW_PROPOSALS` is exported through the {@link createProposalFixtures}
 * deep-clone factory (mirroring `data/work-items/fixtures`) so the mock repository
 * can splice/mutate freely without poisoning the source fixtures across instances.
 */
const RAW_PROPOSALS: ReadonlyArray<Proposal> = [
  {
    id: "prop_create_pricing",
    target_type: "work_item",
    target_id: null,
    operation: "create",
    payload: {
      title: "Draft Q3 pricing brief",
      team_id: "team_marketing",
      status_id: "status_marketing_plan",
      priority: "high",
      type: "task",
    },
    rationale:
      "The Aqua and Marine calls both surfaced pricing objections; a short brief keeps the team aligned before the next round of quotes.",
    confidence: 0.82,
    status: "pending",
    run_id: "run_9f2a",
    model_id: "kimi-k2.5",
    source: "chat",
    created_at: "2026-07-13T09:12:00.000Z",
  },
  {
    // Targets the `wi_auth` fixture (phase "execute", priority "high") — the
    // payload flips both, so the diff shows two changed rows.
    id: "prop_update_auth",
    target_type: "work_item",
    target_id: "wi_auth",
    operation: "update",
    payload: { priority: "critical", phase: "review" },
    rationale:
      "The Q2 security review re-opened a token-verifier gap overnight; raising priority and moving to review reflects the new urgency.",
    confidence: 0.64,
    status: "pending",
    run_id: "run_9f2a",
    model_id: "kimi-k2.5",
    source: "autonomous",
    created_at: "2026-07-13T09:14:00.000Z",
  },
  {
    // Targets the `wi_realtime` fixture (title "Realtime transport seam",
    // priority "critical") — the payload changes both, so the diff shows a title
    // rename plus a priority change.
    id: "prop_update_realtime",
    target_type: "work_item",
    target_id: "wi_realtime",
    operation: "update",
    payload: {
      title: "Realtime transport seam (spike DO first)",
      priority: "high",
    },
    rationale:
      "The Durable Objects spike is the real blocker; renaming to lead with it and easing priority matches how the team is sequencing v2.0.",
    confidence: 0.91,
    status: "pending",
    run_id: "run_c318",
    model_id: "glm-5",
    source: "connector",
    created_at: "2026-07-13T09:18:00.000Z",
  },
];

/**
 * Deep-clone factory: a fresh `Proposal[]` per call (mutation-safe for the mock
 * repository — `accept`/`reject` splice this array in place). `payload` is copied
 * too, so a caller mutating a returned proposal's payload never aliases RAW.
 */
export function createProposalFixtures(): Proposal[] {
  return RAW_PROPOSALS.map((proposal) => ({
    ...proposal,
    payload: { ...proposal.payload },
  }));
}
