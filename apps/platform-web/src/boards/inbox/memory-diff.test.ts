import { describe, expect, it } from "vitest";

import type { MemoryRow } from "@/data/memories";
import type { Proposal } from "@/data/proposals";

import {
  buildMemoryCreateRows,
  buildMemoryDeferRows,
  buildMemorySupersedeRows,
  describeMemoryOperation,
  memoryBody,
  memoryChangeReason,
  memoryListTitle,
} from "./memory-diff";

function memProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: "mp1",
    target_type: "memory",
    target_id: null,
    operation: "create",
    payload: { kind: "decision", title: "Use Postgres", body: "We picked PG.", topics: ["db"] },
    rationale: null,
    confidence: null,
    status: "pending",
    run_id: "run_1",
    model_id: "kimi",
    created_at: "2026-07-16T00:00:00.000Z",
    ...overrides,
  };
}

const target = {
  id: "mem_1",
  title: "Use Postgres",
  body: "We picked Postgres.",
  topics: ["db"],
} as unknown as MemoryRow;

describe("describeMemoryOperation", () => {
  it("create → Log a <kind>: <title>", () => {
    expect(describeMemoryOperation(memProposal(), undefined, 0)).toBe(
      "Log a decision: “Use Postgres”",
    );
  });

  it("supersede → Supersede <target>: <n> change(s)", () => {
    const p = memProposal({ operation: "supersede", target_id: "mem_1", payload: { change_reason: "x", title: "New" } });
    expect(describeMemoryOperation(p, target, 1)).toBe("Supersede Use Postgres: 1 change");
    expect(describeMemoryOperation(p, target, 2)).toBe("Supersede Use Postgres: 2 changes");
  });

  it("supersede falls back to the target id when the target is not yet loaded", () => {
    const p = memProposal({ operation: "supersede", target_id: "mem_9", payload: { change_reason: "x" } });
    expect(describeMemoryOperation(p, undefined, 0)).toBe("Supersede mem_9: 0 changes");
  });

  it("retract / defer name the target", () => {
    const r = memProposal({ operation: "retract", target_id: "mem_1", payload: {} });
    expect(describeMemoryOperation(r, target, 0)).toBe("Retract “Use Postgres”");
    const d = memProposal({ operation: "defer", target_id: "mem_1", payload: {} });
    expect(describeMemoryOperation(d, target, 0)).toBe("Defer “Use Postgres”");
  });
});

describe("buildMemoryCreateRows", () => {
  it("emits kind + topics; scope only when present", () => {
    const rows = buildMemoryCreateRows(memProposal());
    expect(rows).toEqual([
      { label: "kind", value: "decision" },
      { label: "topics", value: "db" },
    ]);
  });

  it("includes a scope row (type · id) when scoped", () => {
    const rows = buildMemoryCreateRows(
      memProposal({ payload: { kind: "fact", title: "x", scope_type: "project", scope_id: "pr_1" } }),
    );
    expect(rows).toContainEqual({ label: "scope", value: "project · pr_1" });
  });
});

describe("buildMemorySupersedeRows", () => {
  it("emits current → proposed only for the overridden fields", () => {
    const p = memProposal({
      operation: "supersede",
      target_id: "mem_1",
      payload: { change_reason: "x", title: "Use MongoDB" },
    });
    const rows = buildMemorySupersedeRows(p, target);
    expect(rows).toEqual([{ field: "title", current: "Use Postgres", proposed: "Use MongoDB" }]);
  });

  it("uses an em-dash current when the target is not loaded (never a blank diff)", () => {
    const p = memProposal({
      operation: "supersede",
      target_id: "mem_1",
      payload: { change_reason: "x", body: "New body" },
    });
    const rows = buildMemorySupersedeRows(p, undefined);
    expect(rows).toEqual([{ field: "body", current: "—", proposed: "New body" }]);
  });
});

describe("memoryChangeReason / memoryBody / defer rows / list title", () => {
  it("memoryChangeReason is only set for a supersede", () => {
    expect(memoryChangeReason(memProposal())).toBeNull();
    const p = memProposal({ operation: "supersede", target_id: "m", payload: { change_reason: "why" } });
    expect(memoryChangeReason(p)).toBe("why");
  });

  it("memoryBody reads the payload body", () => {
    expect(memoryBody(memProposal())).toBe("We picked PG.");
    expect(memoryBody(memProposal({ payload: { kind: "fact", title: "x" } }))).toBeNull();
  });

  it("buildMemoryDeferRows surfaces waiting_on / review_after", () => {
    const p = memProposal({ operation: "defer", target_id: "m", payload: { waiting_on: "legal" } });
    expect(buildMemoryDeferRows(p)).toEqual([{ label: "waiting on", value: "legal" }]);
  });

  it("memoryListTitle labels each operation", () => {
    expect(memoryListTitle(memProposal())).toBe("Use Postgres");
    expect(
      memoryListTitle(memProposal({ operation: "supersede", target_id: "mem_1", payload: {} })),
    ).toBe("Supersede mem_1");
  });
});
