import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  MemoryDetail,
  MemoryRow,
  SupersedeMemoryInput,
} from "@/data/memories";

import { MemoryListItem } from "./MemoryListItem";

function mem(partial: Partial<MemoryRow> & Pick<MemoryRow, "id">): MemoryRow {
  return {
    tenant_id: "t",
    kind: "decision",
    title: "A decision",
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
    topics: ["models"],
    source_kind: "manual",
    source_run_id: null,
    source_proposal_id: null,
    source_quote: null,
    created_by: "u1",
    decided_by: null,
    pinned: false,
    priority: null,
    enforcement: null,
    created_at: "2026-07-14T09:00:00.000Z",
    updated_at: "2026-07-14T09:00:00.000Z",
    ...partial,
  };
}

function handlers() {
  return {
    supersede: vi.fn(async (_id: string, _input: SupersedeMemoryInput) =>
      mem({ id: "new" }),
    ),
    retract: vi.fn(async () => mem({ id: "r", status: "retracted" })),
    defer: vi.fn(async () => mem({ id: "d", status: "deferred" })),
    reactivate: vi.fn(async () => mem({ id: "a", status: "active" })),
    getDetail: vi.fn(async (): Promise<MemoryDetail> => ({
      memory: mem({ id: "mem_1", status: "superseded" }),
      chain: [
        mem({ id: "mem_1", title: "Old title", status: "superseded" }),
        mem({
          id: "mem_2",
          title: "New title",
          change_reason: "cheaper option",
        }),
      ],
    })),
  };
}

describe("MemoryListItem", () => {
  it("renders the status pill, title, and topics for an active memory", () => {
    const h = handlers();
    render(
      <MemoryListItem
        memory={mem({ id: "mem_1", title: "Use Kimi" })}
        {...h}
        isMutating={false}
      />,
    );
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Use Kimi")).toBeInTheDocument();
    expect(screen.getByText("models")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Supersede" })).toBeInTheDocument();
  });

  it("shows Reactivate for a deferred memory (not a dead end) and calls it", () => {
    const h = handlers();
    render(
      <MemoryListItem
        memory={mem({ id: "mem_1", status: "deferred", waiting_on: "legal" })}
        {...h}
        isMutating={false}
      />,
    );
    expect(screen.getByText(/Parked/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reactivate" }));
    expect(h.reactivate).toHaveBeenCalledWith("mem_1");
  });

  it("blocks supersede until a change reason is entered, then submits it", async () => {
    const h = handlers();
    render(<MemoryListItem memory={mem({ id: "mem_1" })} {...h} isMutating={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Supersede" }));
    // Now inside the form: the submit button shares the label but is disabled.
    const submit = screen.getAllByRole("button", { name: "Supersede" }).at(-1)!;
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Change reason"), {
      target: { value: "outdated" },
    });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    await waitFor(() => expect(h.supersede).toHaveBeenCalledTimes(1));
    expect(h.supersede.mock.calls[0]![1]).toMatchObject({
      change_reason: "outdated",
    });
  });

  it("retracts the memory", async () => {
    const h = handlers();
    render(<MemoryListItem memory={mem({ id: "mem_1" })} {...h} isMutating={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Retract" }));
    await waitFor(() => expect(h.retract).toHaveBeenCalledWith("mem_1"));
  });

  it("hides actions and shows history for a superseded memory", async () => {
    const h = handlers();
    render(
      <MemoryListItem
        memory={mem({ id: "mem_1", status: "superseded", superseded_by_id: "mem_2" })}
        {...h}
        isMutating={false}
      />,
    );
    expect(screen.queryByRole("button", { name: "Retract" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show history" }));
    await waitFor(() => expect(h.getDetail).toHaveBeenCalledWith("mem_1"));
    expect(await screen.findByText("New title")).toBeInTheDocument();
    expect(screen.getByText(/because cheaper option/)).toBeInTheDocument();
  });
});
