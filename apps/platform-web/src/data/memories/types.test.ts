import { describe, expect, it } from "vitest";

import type {
  CreateMemoryInput,
  MemoryRow,
  SupersedeMemoryInput,
} from "./types";

describe("memory types", () => {
  it("MemoryRow accepts the backend snake_case shape", () => {
    const row: MemoryRow = {
      id: "mem_1",
      tenant_id: "org_1",
      kind: "decision",
      title: "Ship it",
      body: null,
      attrs: null,
      root_id: "mem_1",
      supersedes_id: null,
      superseded_by_id: null,
      change_reason: null,
      valid_from: null,
      status: "active",
      waiting_on: null,
      review_after: null,
      scope_type: "org",
      scope_id: null,
      topics: ["ship"],
      source_kind: "manual",
      source_run_id: null,
      source_proposal_id: null,
      source_quote: null,
      created_by: "u1",
      decided_by: null,
      pinned: false,
      priority: null,
      enforcement: null,
      created_at: "2026-07-14T00:00:00Z",
      updated_at: "2026-07-14T00:00:00Z",
    };
    expect(row.kind).toBe("decision");
    expect(row.status).toBe("active");
  });

  it("CreateMemoryInput requires only kind + title", () => {
    const input: CreateMemoryInput = { kind: "fact", title: "A fact" };
    expect(input.title).toBe("A fact");
  });

  it("SupersedeMemoryInput requires change_reason", () => {
    const input: SupersedeMemoryInput = { change_reason: "outdated" };
    expect(input.change_reason).toBe("outdated");
  });
});
