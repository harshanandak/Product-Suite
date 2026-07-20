import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Button, ThemeProvider, cn } from "@product-suite/ui";

import { AcceptStateView } from "@/agent-chat/AcceptStateView";
import type { ProposalCardData } from "@/agent-chat/proposal-card-data";
import { ProposalDetail } from "@/boards/inbox/ProposalDetail";
import {
  useProposalActions,
  type AcceptResult,
  type Proposal,
  type ProposalRepository,
} from "@/data/proposals";

import "../src/styles.css";

/**
 * Screenshot harness for the inline-proposal-ux wave (Lane C). It mounts:
 *  - the REAL {@link ProposalDetail} (the inbox batch view), once per accept
 *    outcome, and
 *  - the inline chat proposal card (the PRIMARY surface), once per state.
 * Each is driven by a MOCKED `accept` resolving the corresponding Lane-A LOCKED
 * envelope; a Playwright spec clicks Accept and screenshots the resulting UX.
 *
 * No router, no Clerk, no backend: `@tanstack/react-router` is aliased to a Link
 * shim (vite.harness.config.ts); the inline card is driven by an injected mock
 * repository so its REAL `useProposalActions` + REAL `AcceptStateView` run.
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

/** A mock repository whose `accept` always resolves the given LOCKED envelope. */
function repoResolving(result: AcceptResult): ProposalRepository {
  return {
    list: async () => [],
    accept: async () => result,
    reject: async () => undefined,
    activeRules: async () => [],
  };
}

// --- Inbox (ProposalDetail) panels -----------------------------------------

/** One labelled card wrapping a ProposalDetail wired to a single mocked outcome. */
function InboxPanel({
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
  status: "applied",
  proposal_id: "p_applied",
  item_id: "wi_42",
});

const acceptInvalid = async (): Promise<AcceptResult> => ({
  status: "invalid",
  proposal_id: "p_needs-attention",
  message: "Team not found — it may have been deleted.",
  retryable: true,
});

const acceptStale = async (): Promise<AcceptResult> => ({
  status: "stale",
  proposal_id: "p_changed",
  item_id: "wi_42",
  message: "Someone moved this item to Done since the agent proposed it.",
});

// --- Inline chat card panels (the PRIMARY surface) --------------------------

/**
 * A faithful stand-in for the inline `ProposalCard`: it reproduces ONLY the card
 * chrome and drives the REAL {@link useProposalActions} (with an injected mock
 * repo) + the REAL {@link AcceptStateView}, so the state region is exactly what
 * ships. Navigation is a no-op here (the harness has no router).
 */
function HarnessCard({
  data,
  repository,
}: {
  data: ProposalCardData;
  repository: ProposalRepository;
}) {
  const isCreate = data.operation === "create";
  const { phase, result, busy, accept, reject, reset } = useProposalActions(
    data.proposalId,
    { repository },
  );
  return (
    <div className="rounded-lg border border-border bg-card p-4 text-sm shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded-md px-1.5 py-0.5 text-xs font-medium",
            isCreate
              ? "bg-primary/10 text-primary"
              : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
          )}
        >
          {isCreate ? "Create" : "Update"}
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          Pending review
        </span>
      </div>
      <p className="mt-2 font-medium text-foreground">{data.title}</p>
      {data.summary ? (
        <p className="mt-1 line-clamp-3 text-muted-foreground">{data.summary}</p>
      ) : null}
      {phase === "idle" ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy} onClick={() => accept()}>
            Accept
          </Button>
          <Button size="sm" variant="outline" disabled={busy}>
            Edit
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => reject()}>
            Discard
          </Button>
        </div>
      ) : (
        <div className="mt-3">
          <AcceptStateView
            phase={phase}
            result={result}
            busy={busy}
            onRetry={() => accept()}
            onEdit={reset}
            onDiscard={() => reject()}
            onRefresh={reset}
            onApplyAnyway={() => accept()}
            onViewItem={() => {}}
          />
        </div>
      )}
    </div>
  );
}

const cardData: ProposalCardData = {
  operation: "update",
  proposalId: "card_1",
  title: "Ship Q3 pricing brief",
  summary: "Two customer calls surfaced pricing objections — capture the brief.",
};

/** One labelled inline-card panel. */
function CardPanel({
  state,
  title,
  repository,
}: {
  state: string;
  title: string;
  repository: ProposalRepository;
}) {
  return (
    <section data-state={state} className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <HarnessCard data={cardData} repository={repository} />
    </section>
  );
}

function Harness() {
  return (
    <ThemeProvider>
      <main className="mx-auto flex max-w-2xl flex-col gap-8 bg-background p-8">
        <h1 className="text-lg font-semibold text-foreground">
          Inline proposal card — accept outcome states
        </h1>
        <CardPanel
          state="card-pending"
          title="Inline card · Pending (accept in place)"
          repository={repoResolving({
            status: "applied",
            proposal_id: "card_1",
            item_id: "wi_42",
          })}
        />
        <CardPanel
          state="card-applied"
          title="Inline card · Applied ✓"
          repository={repoResolving({
            status: "applied",
            proposal_id: "card_1",
            item_id: "wi_42",
          })}
        />
        <CardPanel
          state="card-needs-attention"
          title="Inline card · Needs attention (terminal — Discard only)"
          repository={repoResolving({
            status: "invalid",
            proposal_id: "card_1",
            message: "The team this refers to no longer exists.",
            retryable: false,
          })}
        />
        <CardPanel
          state="card-changed"
          title="Inline card · This item changed (stale)"
          repository={repoResolving({
            status: "stale",
            proposal_id: "card_1",
            item_id: "wi_42",
            message: "Someone moved this item to Done since the agent proposed it.",
          })}
        />

        <h1 className="mt-4 text-lg font-semibold text-foreground">
          Review Inbox — accept outcome states
        </h1>
        <InboxPanel state="applied" title="Inbox · Applied (optimistic success)" accept={acceptApplied} />
        <InboxPanel
          state="needs-attention"
          title="Inbox · Needs attention (invalid — legible failure)"
          accept={acceptInvalid}
        />
        <InboxPanel
          state="changed"
          title="Inbox · This item changed (stale — never clobber)"
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
