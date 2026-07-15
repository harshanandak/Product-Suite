import { describe, expect, it } from "vitest";

import type { MemoryRow } from "@/data/memories";

import {
  UNTAGGED_TOPIC,
  formatTimestamp,
  groupBySource,
  resolveToCurrentByTopic,
  statusPill,
} from "./memory-format";

function mem(partial: Partial<MemoryRow> & Pick<MemoryRow, "id">): MemoryRow {
  return {
    tenant_id: "t",
    kind: "decision",
    title: partial.id,
    body: null,
    attrs: null,
    root_id: partial.id,
    supersedes_id: null,
    superseded_by_id: null,
    change_reason: null,
    valid_from: null,
    status: "active",
    waiting_on: null,
    review_after: null,
    scope_type: "org",
    scope_id: null,
    topics: [],
    source_kind: "manual",
    source_run_id: null,
    source_proposal_id: null,
    source_quote: null,
    created_by: null,
    decided_by: null,
    pinned: false,
    priority: null,
    enforcement: null,
    created_at: "2026-07-14T09:00:00.000Z",
    updated_at: "2026-07-14T09:00:00.000Z",
    ...partial,
  };
}

describe("statusPill", () => {
  it("maps every status to a variant + label", () => {
    expect(statusPill("active")).toEqual({ variant: "default", label: "Active" });
    expect(statusPill("superseded").label).toBe("Superseded");
    expect(statusPill("retracted").variant).toBe("destructive");
    expect(statusPill("deferred").variant).toBe("outline");
  });
});

describe("groupBySource", () => {
  it("groups by source_kind in a stable order, newest-first within a group", () => {
    const groups = groupBySource([
      mem({ id: "a", source_kind: "chat", created_at: "2026-07-10T00:00:00Z" }),
      mem({ id: "b", source_kind: "manual", created_at: "2026-07-11T00:00:00Z" }),
      mem({ id: "c", source_kind: "manual", created_at: "2026-07-12T00:00:00Z" }),
    ]);
    // manual sorts before chat in SOURCE_ORDER.
    expect(groups.map((g) => g.source)).toEqual(["manual", "chat"]);
    expect(groups[0]!.memories.map((m) => m.id)).toEqual(["c", "b"]);
  });

  it("omits empty groups", () => {
    const groups = groupBySource([mem({ id: "a", source_kind: "meeting" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.source).toBe("meeting");
  });
});

describe("resolveToCurrentByTopic", () => {
  it("keeps only active memories and buckets each under every topic", () => {
    const groups = resolveToCurrentByTopic([
      mem({ id: "a", topics: ["models", "blog"], status: "active" }),
      mem({ id: "b", topics: ["models"], status: "superseded" }),
      mem({ id: "c", topics: [], status: "active" }),
    ]);
    const byTopic = Object.fromEntries(groups.map((g) => [g.topic, g.memories]));
    expect(byTopic["models"]!.map((m) => m.id)).toEqual(["a"]);
    expect(byTopic["blog"]!.map((m) => m.id)).toEqual(["a"]);
    expect(byTopic[UNTAGGED_TOPIC]!.map((m) => m.id)).toEqual(["c"]);
    // Untagged always sorts last.
    expect(groups.at(-1)!.topic).toBe(UNTAGGED_TOPIC);
  });
});

describe("formatTimestamp", () => {
  it("falls back to the raw string for an invalid date", () => {
    expect(formatTimestamp("not-a-date")).toBe("not-a-date");
  });
});
