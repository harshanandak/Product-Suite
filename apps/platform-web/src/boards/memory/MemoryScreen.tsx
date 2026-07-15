import { useState } from "react";

import { useSearch } from "@tanstack/react-router";

import { Button, EmptyState, ErrorState } from "@product-suite/ui";

import { useMemories, type MemoriesAdapter } from "@/data/memories";

import { LogDecisionForm } from "./LogDecisionForm";
import { MemoryListItem } from "./MemoryListItem";
import { groupBySource, resolveToCurrentByTopic } from "./memory-format";

/**
 * Props for {@link MemoryScreen}. Like {@link InboxScreen}, the only prop is the
 * adapter SEAM — optional, defaulting to the shared singleton — so tests can
 * drive the screen against a controlled fixture store.
 */
export interface MemoryScreenProps {
  adapter?: MemoriesAdapter;
}

/** The two lenses on the memory store. */
type View = "log" | "topics";

/** A single loading placeholder row (mirrors the router's pending skeleton). */
function SkeletonRow() {
  return <div className="h-20 w-full animate-pulse rounded-lg bg-muted" />;
}

/**
 * The Decision Log SCREEN (Memory Brain P1) — the organization's durable memory.
 * Two lenses share one loaded set: the LOG (chronological, grouped by where each
 * memory came from) and TOPICS (the resolved-to-current knowledge — active
 * memories only, bucketed by topic). Capture lives up top via "Log a decision",
 * a one-step form that writes an immediately-active memory. Mirrors
 * {@link InboxScreen}'s scaffolding (adapter seam, the four §4 states, the
 * bordered `bg-card` card grammar).
 */
export function MemoryScreen({ adapter }: Readonly<MemoryScreenProps> = {}) {
  // `?new=1` (the command-palette "Log a decision" action) auto-opens the form.
  const search = useSearch({ strict: false }) as { new?: unknown };
  const {
    memories,
    isLoading,
    error,
    refetch,
    get,
    create,
    supersede,
    retract,
    defer,
    isMutating,
  } = useMemories({ adapter });

  const [view, setView] = useState<View>("log");
  const [formOpen, setFormOpen] = useState<boolean>(Boolean(search.new));

  if (isLoading) {
    return (
      <output className="block space-y-2.5" aria-label="Loading memories">
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </output>
    );
  }

  if (error !== null) {
    return (
      <ErrorState
        title="Couldn't load memories"
        description={error.message}
        action={
          <Button size="sm" variant="outline" onClick={refetch}>
            Try again
          </Button>
        }
      />
    );
  }

  const sourceGroups = groupBySource(memories);
  const topicGroups = resolveToCurrentByTopic(memories);

  const renderItem = (id: string) => {
    const memory = memories.find((m) => m.id === id);
    if (!memory) return null;
    return (
      <MemoryListItem
        key={memory.id}
        memory={memory}
        supersede={supersede}
        retract={retract}
        defer={defer}
        getDetail={get}
        isMutating={isMutating}
      />
    );
  };

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold text-foreground">Decision Log</h1>
        <span className="text-sm text-muted-foreground">
          {memories.length} {memories.length === 1 ? "memory" : "memories"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <div
            role="group"
            aria-label="View"
            className="flex items-center gap-1 rounded-md border border-border p-0.5"
          >
            <Button
              size="xs"
              variant={view === "log" ? "default" : "ghost"}
              aria-pressed={view === "log"}
              onClick={() => setView("log")}
            >
              Log
            </Button>
            <Button
              size="xs"
              variant={view === "topics" ? "default" : "ghost"}
              aria-pressed={view === "topics"}
              onClick={() => setView("topics")}
            >
              Topics
            </Button>
          </div>
          <Button size="sm" onClick={() => setFormOpen((open) => !open)}>
            {formOpen ? "Close" : "Log a decision"}
          </Button>
        </div>
      </header>

      {formOpen ? (
        <LogDecisionForm
          create={create}
          onCreated={() => setFormOpen(false)}
          onCancel={() => setFormOpen(false)}
        />
      ) : null}

      {memories.length === 0 ? (
        <EmptyState
          title="No memories yet"
          description="Log a decision or fact and it becomes durable, searchable memory the org can build on."
        />
      ) : view === "log" ? (
        <div className="flex flex-col gap-6">
          {sourceGroups.map((group) => (
            <section key={group.source} className="flex flex-col gap-2.5">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </h2>
              <ul className="flex list-none flex-col gap-2.5 p-0">
                {group.memories.map((memory) => (
                  <li key={memory.id}>{renderItem(memory.id)}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {topicGroups.length === 0 ? (
            <EmptyState
              title="No current memories"
              description="Active decisions and facts, grouped by topic, appear here."
            />
          ) : (
            topicGroups.map((group) => (
              <section key={group.topic} className="flex flex-col gap-2.5">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.topic}
                </h2>
                <ul className="flex list-none flex-col gap-2.5 p-0">
                  {group.memories.map((memory) => (
                    <li key={memory.id}>{renderItem(memory.id)}</li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      )}
    </section>
  );
}
