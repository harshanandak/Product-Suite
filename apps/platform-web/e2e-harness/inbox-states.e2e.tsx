import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ThemeProvider } from "@product-suite/ui";

import { ProposalCard } from "@/agent-chat/ProposalCard";
import type { ProposalCardData } from "@/agent-chat/proposal-card-data";
import { ProposalDetail } from "@/boards/inbox/ProposalDetail";
import { ProposalRepositoryContext } from "@/data/proposals/proposal-repository-context";
import type {
  AcceptResult,
  Proposal,
  ProposalRepository,
} from "@/data/proposals";

import "../src/styles.css";

/**
 * Screenshot harness for the inline-proposal-ux wave (Lane C). It mounts the REAL
 * shipped components, each driven by a MOCKED repository:
 *  - the inline `ProposalCard` (the PRIMARY surface) — one per state — wrapped in a
 *    per-card `ProposalRepositoryContext.Provider` so its own `useProposalActions`
 *    resolves the injected outcome. This is the shipped card, not a stand-in, so a
 *    regression in it fails the screenshots.
 *  - the `ProposalDetail` inbox batch view — one per accept outcome.
 * A Playwright spec clicks each Accept and screenshots the resulting state.
 *
 * No router, no Clerk, no backend: `@tanstack/react-router` is aliased to a Link+
 * useNavigate shim (vite.harness.config.ts).
 */

/** A pending create-work-item proposal, the shared fixture for the inbox panels. */
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

/** A mock repository whose `accept` resolves the given LOCKED envelope. */
function repoResolving(result: AcceptResult): ProposalRepository {
  return {
    list: async () => [],
    accept: async () => result,
    reject: async () => undefined,
    activeRules: async () => [],
  };
}

/** A mock repository whose `accept` THROWS — models a transport/5xx failure. */
function repoThrowing(message: string): ProposalRepository {
  return {
    list: async () => [],
    accept: async () => {
      throw new Error(message);
    },
    reject: async () => undefined,
    activeRules: async () => [],
  };
}

// --- Inline chat card panels (the PRIMARY surface, REAL ProposalCard) -------

function cardData(proposalId: string): ProposalCardData {
  return {
    operation: "update",
    proposalId,
    title: "Ship Q3 pricing brief",
    summary: "Two customer calls surfaced pricing objections — capture the brief.",
  };
}

/** One labelled panel mounting the REAL ProposalCard against an injected repo. */
function CardPanel({
  state,
  title,
  proposalId,
  repository,
}: {
  state: string;
  title: string;
  proposalId: string;
  repository: ProposalRepository;
}) {
  return (
    <section data-state={state} className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <ProposalRepositoryContext.Provider value={repository}>
        <ProposalCard data={cardData(proposalId)} workspace="acme" />
      </ProposalRepositoryContext.Provider>
    </section>
  );
}

// --- Inbox (ProposalDetail) panels -----------------------------------------

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

function Harness() {
  return (
    <ThemeProvider>
      <main className="mx-auto flex max-w-2xl flex-col gap-8 bg-background p-8">
        <h1 className="text-lg font-semibold text-foreground">
          Inline proposal card (real ProposalCard) — accept outcome states
        </h1>
        <CardPanel
          state="card-pending"
          title="Inline card · Pending (accept in place)"
          proposalId="card_pending"
          repository={repoResolving({
            status: "applied",
            proposal_id: "card_pending",
            item_id: "wi_42",
          })}
        />
        <CardPanel
          state="card-applied"
          title="Inline card · Applied ✓"
          proposalId="card_applied"
          repository={repoResolving({
            status: "applied",
            proposal_id: "card_applied",
            item_id: "wi_42",
          })}
        />
        <CardPanel
          state="card-needs-attention"
          title="Inline card · Needs attention (terminal — Discard only)"
          proposalId="card_needs"
          repository={repoResolving({
            status: "invalid",
            proposal_id: "card_needs",
            message: "The team this refers to no longer exists.",
            retryable: false,
          })}
        />
        <CardPanel
          state="card-changed"
          title="Inline card · This item changed (stale)"
          proposalId="card_changed"
          repository={repoResolving({
            status: "stale",
            proposal_id: "card_changed",
            item_id: "wi_42",
            message: "Someone moved this item to Done since the agent proposed it.",
          })}
        />
        <CardPanel
          state="card-failed"
          title="Inline card · Transport error (thrown accept → retryable failed)"
          proposalId="card_failed"
          repository={repoThrowing("The write service is unavailable. Please try again.")}
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
