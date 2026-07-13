import { describe, expect, it } from "vitest";

import type { Proposal } from "@/data/proposals";
import type { WorkItem } from "@/data/work-items";

import {
  buildFieldRows,
  describeOperation,
  formatConfidence,
  formatValue,
  proposalListTitle,
} from "./field-diff";

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: "p1",
    target_type: "work_item",
    target_id: null,
    operation: "create",
    payload: {},
    rationale: null,
    confidence: null,
    status: "pending",
    run_id: "r1",
    model_id: "m1",
    created_at: "2026-07-13T09:12:00.000Z",
    ...overrides,
  };
}

const target = {
  id: "wi_1",
  title: "Payments revamp",
  priority: "high",
  phase: "plan",
  tags: ["a", "b"],
} as unknown as WorkItem;

describe("formatValue", () => {
  it("formats primitives and arrays", () => {
    expect(formatValue("hi")).toBe("hi");
    expect(formatValue(3)).toBe("3");
    expect(formatValue(false)).toBe("false");
    expect(formatValue(["a", "b"])).toBe("a, b");
  });

  it("renders empties DISTINGUISHABLY (so a real empty→empty change never looks unchanged)", () => {
    expect(formatValue(undefined)).toBe("—");
    expect(formatValue(null)).toBe("null");
    expect(formatValue("")).toBe("(empty)");
    expect(formatValue([])).toBe("(none)");
  });
});

describe("buildFieldRows — create", () => {
  it("lists every provided payload field as field | value", () => {
    const rows = buildFieldRows(
      proposal({ operation: "create", payload: { title: "New", priority: "low" } }),
      undefined,
    );
    expect(rows).toEqual([
      { field: "title", proposed: "New" },
      { field: "priority", proposed: "low" },
    ]);
    expect(rows.every((r) => r.current === undefined)).toBe(true);
  });
});

describe("buildFieldRows — update", () => {
  it("shows current → proposed for ONLY the changed fields", () => {
    const rows = buildFieldRows(
      proposal({
        operation: "update",
        target_id: "wi_1",
        // priority changes (high→critical); phase is UNCHANGED (plan→plan).
        payload: { priority: "critical", phase: "plan" },
      }),
      target,
    );
    expect(rows).toEqual([
      { field: "priority", current: "high", proposed: "critical" },
    ]);
  });

  it("treats array reordering/content faithfully (changed vs unchanged)", () => {
    const unchanged = buildFieldRows(
      proposal({ operation: "update", target_id: "wi_1", payload: { tags: ["a", "b"] } }),
      target,
    );
    expect(unchanged).toEqual([]);
    const changed = buildFieldRows(
      proposal({ operation: "update", target_id: "wi_1", payload: { tags: ["a", "c"] } }),
      target,
    );
    expect(changed).toEqual([
      { field: "tags", current: "a, b", proposed: "a, c" },
    ]);
  });

  it("shows an empty-to-null change as a REAL change (not — → —)", () => {
    const emptyTarget = { id: "wi_1", note: "" } as unknown as WorkItem;
    const rows = buildFieldRows(
      proposal({ operation: "update", target_id: "wi_1", payload: { note: null } }),
      emptyTarget,
    );
    expect(rows).toEqual([
      { field: "note", current: "(empty)", proposed: "null" },
    ]);
  });

  it("treats a reordered-but-equal object as UNCHANGED (key-order-insensitive)", () => {
    const objTarget = {
      id: "wi_1",
      meta: { a: 1, b: 2 },
    } as unknown as WorkItem;
    const unchanged = buildFieldRows(
      proposal({
        operation: "update",
        target_id: "wi_1",
        // Same object, keys in a different order — must NOT show as a change.
        payload: { meta: { b: 2, a: 1 } },
      }),
      objTarget,
    );
    expect(unchanged).toEqual([]);
  });

  it("shows all payload fields when the target is unknown (never a silent empty diff)", () => {
    const rows = buildFieldRows(
      proposal({ operation: "update", target_id: "wi_x", payload: { priority: "low" } }),
      undefined,
    );
    expect(rows).toEqual([
      { field: "priority", current: "—", proposed: "low" },
    ]);
  });
});

describe("describeOperation", () => {
  it("creates read as Create work item …", () => {
    expect(
      describeOperation(proposal({ payload: { title: "Ship it" } }), undefined, 0),
    ).toBe("Create work item “Ship it”");
  });

  it("updates read as Update <target>: n fields", () => {
    expect(
      describeOperation(
        proposal({ operation: "update", target_id: "wi_1" }),
        target,
        1,
      ),
    ).toBe("Update Payments revamp: 1 field");
    expect(
      describeOperation(
        proposal({ operation: "update", target_id: "wi_1" }),
        target,
        2,
      ),
    ).toBe("Update Payments revamp: 2 fields");
  });
});

describe("small formatters", () => {
  it("proposalListTitle", () => {
    expect(proposalListTitle(proposal({ payload: { title: "X" } }))).toBe("X");
    expect(
      proposalListTitle(proposal({ operation: "update", target_id: "wi_1" })),
    ).toBe("Update wi_1");
  });

  it("formatConfidence hides null and renders 2dp", () => {
    expect(formatConfidence(null)).toBeNull();
    expect(formatConfidence(0.8)).toBe("0.80");
  });
});
