import { type ReactNode, useState } from "react";

import { Badge, Button, Input, TagList, Textarea } from "@product-suite/ui";

import type {
  MemoryDetail,
  MemoryRow,
  SupersedeMemoryInput,
} from "@/data/memories";

import { formatTimestamp, statusPill } from "./memory-format";

/** Props for {@link MemoryListItem}. */
export interface MemoryListItemProps {
  memory: MemoryRow;
  supersede: (id: string, input: SupersedeMemoryInput) => Promise<MemoryRow>;
  retract: (id: string) => Promise<MemoryRow>;
  defer: (id: string, input: { waiting_on?: string }) => Promise<MemoryRow>;
  /** Reactivate a parked (deferred) memory — so it isn't a dead end. */
  reactivate: (id: string) => Promise<MemoryRow>;
  /** Fetch the full supersession chain for the history view. */
  getDetail: (id: string) => Promise<MemoryDetail>;
  /** True while any mutation is in flight (disables actions). */
  isMutating: boolean;
}

/** Inline supersede form: `change_reason` is REQUIRED (submit blocked if empty). */
function SupersedeForm({
  memory,
  isMutating,
  onSubmit,
  onCancel,
}: Readonly<{
  memory: MemoryRow;
  isMutating: boolean;
  onSubmit: (input: SupersedeMemoryInput) => void;
  onCancel: () => void;
}>) {
  const [title, setTitle] = useState(memory.title);
  const [reason, setReason] = useState("");
  const reasonEmpty = reason.trim().length === 0;

  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-border p-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground" htmlFor={`sup-title-${memory.id}`}>
          New title
        </label>
        <Input
          id={`sup-title-${memory.id}`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label
          className="text-xs font-medium text-muted-foreground"
          htmlFor={`sup-reason-${memory.id}`}
        >
          Why is this changing? (required)
        </label>
        <Textarea
          id={`sup-reason-${memory.id}`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Reason for superseding"
          rows={2}
          aria-label="Change reason"
          aria-invalid={reasonEmpty || undefined}
        />
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={isMutating || reasonEmpty}
          onClick={() =>
            onSubmit({
              change_reason: reason.trim(),
              title: title.trim() || undefined,
            })
          }
        >
          Supersede
        </Button>
        <Button size="sm" variant="ghost" disabled={isMutating} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Inline defer form: an optional "waiting on" note + confirm. */
function DeferForm({
  isMutating,
  onSubmit,
  onCancel,
}: Readonly<{
  isMutating: boolean;
  onSubmit: (input: { waiting_on?: string }) => void;
  onCancel: () => void;
}>) {
  const [waitingOn, setWaitingOn] = useState("");
  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-border p-3">
      <Input
        value={waitingOn}
        onChange={(event) => setWaitingOn(event.target.value)}
        placeholder="Waiting on (optional)"
        aria-label="Waiting on"
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={isMutating}
          onClick={() =>
            onSubmit(waitingOn.trim() ? { waiting_on: waitingOn.trim() } : {})
          }
        >
          Defer
        </Button>
        <Button size="sm" variant="ghost" disabled={isMutating} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** The lazily-fetched supersession history (chain), oldest first. */
function ChainHistory({ chain }: Readonly<{ chain: MemoryRow[] }>) {
  return (
    <ol className="flex list-none flex-col gap-1.5 border-l border-border pl-3">
      {chain.map((version) => {
        const pill = statusPill(version.status);
        return (
          <li key={version.id} className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{version.title}</span>{" "}
            <Badge variant={pill.variant} className="px-1.5 py-0 text-[9.5px]">
              {pill.label}
            </Badge>
            {version.change_reason ? (
              <span className="italic"> — because {version.change_reason}</span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

type ItemMode = "idle" | "superseding" | "deferring";

/**
 * One Decision Log row (the memory-brain sibling of {@link ProposalListItem}).
 * Ports the inbox's bordered `bg-card` card grammar: a status pill + kind, the
 * title, its topics, a provenance meta line, and — for an ACTIVE memory — the
 * supersede / retract / defer actions. A SUPERSEDED memory exposes "Show
 * history", which lazily fetches `GET /:id` and renders the chain ("… because
 * <change_reason>"). Supersede collects a MANDATORY change_reason before submit.
 */
export function MemoryListItem({
  memory,
  supersede,
  retract,
  defer,
  reactivate,
  getDetail,
  isMutating,
}: Readonly<MemoryListItemProps>) {
  const [mode, setMode] = useState<ItemMode>("idle");
  const [error, setError] = useState<string | null>(null);
  const [chain, setChain] = useState<MemoryRow[] | null>(null);
  const [chainOpen, setChainOpen] = useState(false);

  const pill = statusPill(memory.status);
  const isActive = memory.status === "active";

  const runAction = (op: Promise<MemoryRow>): void => {
    setError(null);
    void op
      .then(() => setMode("idle"))
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "That action failed. Please try again.",
        ),
      );
  };

  const toggleChain = (): void => {
    if (chainOpen) {
      setChainOpen(false);
      return;
    }
    setChainOpen(true);
    if (chain === null) {
      void getDetail(memory.id)
        .then((detail) => setChain(detail.chain))
        .catch((cause: unknown) =>
          setError(
            cause instanceof Error ? cause.message : "Couldn't load history.",
          ),
        );
    }
  };

  let actionRegion: ReactNode = null;
  if (mode === "superseding") {
    actionRegion = (
      <SupersedeForm
        memory={memory}
        isMutating={isMutating}
        onSubmit={(input) => runAction(supersede(memory.id, input))}
        onCancel={() => setMode("idle")}
      />
    );
  } else if (mode === "deferring") {
    actionRegion = (
      <DeferForm
        isMutating={isMutating}
        onSubmit={(input) => runAction(defer(memory.id, input))}
        onCancel={() => setMode("idle")}
      />
    );
  } else if (isActive) {
    actionRegion = (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="xs"
          variant="outline"
          disabled={isMutating}
          onClick={() => setMode("superseding")}
        >
          Supersede
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={isMutating}
          onClick={() => setMode("deferring")}
        >
          Defer
        </Button>
        <Button
          size="xs"
          variant="destructive"
          disabled={isMutating}
          onClick={() => runAction(retract(memory.id))}
        >
          Retract
        </Button>
      </div>
    );
  } else if (memory.status === "deferred") {
    actionRegion = (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">
          Parked{memory.waiting_on ? ` — waiting on ${memory.waiting_on}` : ""}.
        </span>
        <Button
          size="xs"
          variant="outline"
          disabled={isMutating}
          onClick={() => runAction(reactivate(memory.id))}
        >
          Reactivate
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-card px-4 py-3.5">
      <div className="flex items-center gap-2">
        <Badge variant={pill.variant} className="px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide">
          {pill.label}
        </Badge>
        <Badge variant="outline" className="px-1.5 py-0 text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">
          {memory.kind}
        </Badge>
        <span className="ml-auto text-xs text-muted-foreground">
          {formatTimestamp(memory.created_at)}
        </span>
      </div>

      <p className="text-sm font-semibold text-foreground">{memory.title}</p>
      {memory.body ? (
        <p className="text-sm leading-relaxed text-muted-foreground">{memory.body}</p>
      ) : null}

      {memory.topics.length > 0 ? (
        <TagList tags={memory.topics} />
      ) : null}

      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        {memory.decided_by ? (
          <div className="flex gap-1">
            <dt>by</dt>
            <dd className="text-foreground/70">{memory.decided_by}</dd>
          </div>
        ) : null}
        {memory.created_by ? (
          <div className="flex gap-1">
            <dt>logged by</dt>
            <dd className="font-mono text-foreground/70">{memory.created_by}</dd>
          </div>
        ) : null}
      </dl>

      {memory.status === "superseded" ? (
        <button
          type="button"
          className="w-fit text-xs text-primary hover:underline"
          aria-expanded={chainOpen}
          onClick={toggleChain}
        >
          {chainOpen ? "Hide history" : "Show history"}
        </button>
      ) : null}
      {chainOpen && chain ? <ChainHistory chain={chain} /> : null}

      {error ? (
        <output className="block rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </output>
      ) : null}

      {actionRegion}
    </div>
  );
}
