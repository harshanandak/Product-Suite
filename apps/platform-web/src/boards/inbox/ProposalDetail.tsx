import { Button } from "@product-suite/ui";

import type { AcceptResult, Proposal } from "@/data/proposals";
import { useWorkItems } from "@/data/work-items";

import { buildFieldRows, describeOperation } from "./field-diff";

/** Props for {@link ProposalDetail}. */
export interface ProposalDetailProps {
  proposal: Proposal;
  /** Accept mutation from `useProposals` (returns the surfaced outcome). */
  accept: (id: string) => Promise<AcceptResult>;
  /** Reject mutation from `useProposals`. */
  reject: (id: string, reason?: string) => Promise<void>;
  /** True while an accept/reject is in flight (disables the actions). */
  isMutating: boolean;
  /** Active workspace slug — used to link to the target/applied work item. */
  workspace: string;
}

/**
 * The decision surface — *what will actually change*. Layered top-down: the
 * operation sentence, the rationale (visually primary), then the field diff.
 *
 * NOTE: this is the Task-2 scaffold (operation sentence + rationale + wired
 * Accept/Reject); Task 3 expands it into the full surface — field-diff rows,
 * provenance fine-print, confidence badge, target link, optional-reason chips,
 * and stale/applied handling.
 */
export function ProposalDetail({
  proposal,
  accept,
  reject,
  isMutating,
}: Readonly<ProposalDetailProps>) {
  // The target's current values feed the update diff + operation sentence.
  const { items } = useWorkItems();
  const target =
    proposal.target_id === null
      ? undefined
      : items.find((item) => item.id === proposal.target_id);

  const rows = buildFieldRows(proposal, target);
  const sentence = describeOperation(proposal, target, rows.length);

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-foreground">{sentence}</h2>
      </header>

      {proposal.rationale ? (
        <p className="text-sm leading-relaxed text-foreground">
          {proposal.rationale}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={isMutating}
          onClick={() => {
            void accept(proposal.id);
          }}
        >
          Accept
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={isMutating}
          onClick={() => {
            void reject(proposal.id);
          }}
        >
          Reject
        </Button>
      </div>
    </section>
  );
}
