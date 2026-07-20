import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ThemeProvider } from "@product-suite/ui";

import { ProposalDetail } from "@/boards/inbox/ProposalDetail";
import type { AcceptResult, Proposal } from "@/data/proposals";
import type { WorkItem } from "@/data/work-items";

import "../src/styles.css";

/**
 * Screenshot harness for the atomic-accept Review Inbox UX (Lane C). It mounts the
 * REAL {@link ProposalDetail} once per accept outcome, each driven by a MOCKED
 * `accept` that resolves the corresponding Lane-A envelope. A Playwright spec
 * clicks each panel's Accept and screenshots the resulting banner — the three
 * states this wave protects: applied / needs-attention / this-item-changed.
 *
 * No router, no Clerk, no backend: `@tanstack/react-router` is aliased to a Link
 * shim (vite.harness.config.ts) and the proposals/work-items hooks fall back to
 * their in-memory mock repositories.
 */

/** A pending create-work-item proposal, the shared fixture for every panel. */
function makeProposal(id: string): Proposal {
  return {
    id,
    target_type: "work_item",
    target_id: null,
    operation: "create",
    payload: { title: "Ship Q3 pricing brief", priority: "high", phase: "plan" },
    rationale:
      "Two customer calls this week surfaced pricing objections — capturing the brief keeps the follow-up from slipping.",
    confidence: 0.82,
    status: "pending",
    run_id: "run_9f2a",
    model_id: "kimi-k2.5",
    created_at: "2026-07-20T09:12:00.000Z",
  };
}

const noopReject = async (): Promise<void> => undefined;

/** One labelled card wrapping a ProposalDetail wired to a single mocked outcome. */
function Panel({
  state,
  title,
  accept,
}: {
  state: string;
  title: string;
  accept: (id: string, editedPayload?: Record<string, unknown>) => Promise<AcceptResult>;
}) {
  return (
    <section data-state={state} className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <div className="rounded-lg border border-border bg-card p-5">
        <ProposalDetail
          proposal={makeProposal(`p_${state}`)}
          accept={accept}
          reject={noopReject}
          isMutating={false}
          workspace="acme"
          onRefresh={() => {}}
        />
      </div>
    </section>
  );
}

const acceptApplied = async (): Promise<AcceptResult> => ({
  outcome: "applied",
  item: { id: "wi_42" } as WorkItem,
});

const acceptInvalid = async (): Promise<AcceptResult> => ({
  outcome: "invalid",
  fieldErrors: [
    { field: "team_id", message: "Team not found — it may have been deleted." },
    { field: "title", message: "Title must be under 120 characters." },
  ],
});

const acceptStale = async (): Promise<AcceptResult> => ({
  outcome: "stale",
  currentVersion: 7,
  proposedVersion: 4,
});

function Harness() {
  return (
    <ThemeProvider>
      <main className="mx-auto flex max-w-2xl flex-col gap-8 bg-background p-8">
        <h1 className="text-lg font-semibold text-foreground">
          Review Inbox — accept outcome states
        </h1>
        <Panel state="applied" title="1 · Applied (optimistic success)" accept={acceptApplied} />
        <Panel
          state="needs-attention"
          title="2 · Needs attention (invalid — legible failure)"
          accept={acceptInvalid}
        />
        <Panel
          state="changed"
          title="3 · This item changed (stale — never clobber)"
          accept={acceptStale}
        />
      </main>
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
