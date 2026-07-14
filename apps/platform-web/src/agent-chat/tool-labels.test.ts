import { describe, expect, it } from "vitest";

import { isProposeTool, toolLabel } from "./tool-labels";

describe("toolLabel", () => {
  it("maps each retrieval tool to a present-tense verb", () => {
    expect(toolLabel("list_work_items")).toBe("Reading the board…");
    expect(toolLabel("get_work_item")).toBe("Reading an item…");
    expect(toolLabel("search_items")).toBe("Searching…");
  });

  it("maps both propose tools to the drafting verb", () => {
    expect(toolLabel("propose_create")).toBe("Drafting a proposal…");
    expect(toolLabel("propose_update")).toBe("Drafting a proposal…");
  });

  it("falls back to a generic label for an unknown tool", () => {
    expect(toolLabel("some_future_tool")).toBe("Working…");
  });
});

describe("isProposeTool", () => {
  it("is true only for the propose_* tools", () => {
    expect(isProposeTool("propose_create")).toBe(true);
    expect(isProposeTool("propose_update")).toBe(true);
    expect(isProposeTool("list_work_items")).toBe(false);
    expect(isProposeTool("search_items")).toBe(false);
  });
});
