import type { MemoryRow, MemoryStatus, SourceKind } from "@/data/memories";

/** Human label for each provenance source (Decision Log group headings). */
export const SOURCE_LABELS: Record<SourceKind, string> = {
  meeting: "From meetings",
  chat: "From chat",
  proposal: "From agent proposals",
  manual: "Logged manually",
  import: "Imported",
};

/** Stable display order for the source groups (most human-authored first). */
const SOURCE_ORDER: SourceKind[] = [
  "manual",
  "meeting",
  "chat",
  "proposal",
  "import",
];

/** A `@product-suite/ui` Badge variant plus a label, per lifecycle status. */
export interface StatusPill {
  variant: "default" | "secondary" | "outline" | "destructive";
  label: string;
}

/** Map a memory status to its Decision-Log pill (variant + label). */
export function statusPill(status: MemoryStatus): StatusPill {
  switch (status) {
    case "active":
      return { variant: "default", label: "Active" };
    case "superseded":
      return { variant: "secondary", label: "Superseded" };
    case "retracted":
      return { variant: "destructive", label: "Retracted" };
    case "deferred":
      return { variant: "outline", label: "Deferred" };
  }
}

/** One source-kind group of memories (chronological within the group). */
export interface SourceGroup {
  source: SourceKind;
  label: string;
  memories: MemoryRow[];
}

/**
 * Group memories by `source_kind` for the Decision Log, in {@link SOURCE_ORDER};
 * within each group they are sorted newest-first. Empty groups are omitted.
 */
export function groupBySource(memories: readonly MemoryRow[]): SourceGroup[] {
  const groups: SourceGroup[] = [];
  for (const source of SOURCE_ORDER) {
    const inGroup = memories
      .filter((m) => m.source_kind === source)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (inGroup.length > 0) {
      groups.push({ source, label: SOURCE_LABELS[source], memories: inGroup });
    }
  }
  return groups;
}

/** Sentinel topic bucket for memories that carry no topics. */
export const UNTAGGED_TOPIC = "Untagged";

/** One topic bucket of resolved-to-current memories. */
export interface TopicGroup {
  topic: string;
  memories: MemoryRow[];
}

/**
 * Topic view: the CURRENT knowledge only. Keeps `active` memories, then buckets
 * each under every topic it carries (a memory with two topics appears under
 * both); topicless memories fall into {@link UNTAGGED_TOPIC}. Topics are sorted
 * alphabetically (Untagged always last); within a topic, newest-first.
 */
export function resolveToCurrentByTopic(
  memories: readonly MemoryRow[],
): TopicGroup[] {
  const buckets = new Map<string, MemoryRow[]>();
  const add = (topic: string, memory: MemoryRow): void => {
    const list = buckets.get(topic);
    if (list) list.push(memory);
    else buckets.set(topic, [memory]);
  };

  for (const memory of memories) {
    if (memory.status !== "active") continue;
    if (memory.topics.length === 0) add(UNTAGGED_TOPIC, memory);
    else for (const topic of memory.topics) add(topic, memory);
  }

  return [...buckets.entries()]
    .map(([topic, list]) => ({
      topic,
      memories: list.sort((a, b) => b.created_at.localeCompare(a.created_at)),
    }))
    .sort((a, b) => {
      if (a.topic === UNTAGGED_TOPIC) return 1;
      if (b.topic === UNTAGGED_TOPIC) return -1;
      return a.topic.localeCompare(b.topic);
    });
}

/** Compact created-at label (e.g. `Jul 13, 09:12`); falls back to the raw string. */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
