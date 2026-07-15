import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CreateMemoryInput, MemoryRow } from "@/data/memories";

import { LogDecisionForm } from "./LogDecisionForm";

function createSpy() {
  return vi.fn(
    async (input: CreateMemoryInput): Promise<MemoryRow> =>
      ({ id: "mem_new", title: input.title }) as MemoryRow,
  );
}

describe("LogDecisionForm", () => {
  it("disables submit until a title is entered", () => {
    render(<LogDecisionForm create={createSpy()} />);
    const submit = screen.getByRole("button", { name: "Log it" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "We chose X" },
    });
    expect(submit).not.toBeDisabled();
  });

  it("submits title + default decision kind + org scope", async () => {
    const create = createSpy();
    render(<LogDecisionForm create={create} />);
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "We chose X" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log it" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith({
      kind: "decision",
      title: "We chose X",
      scopeType: "org",
    });
  });

  it("switches kind to fact via the toggle", async () => {
    const create = createSpy();
    render(<LogDecisionForm create={create} />);
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Ad account id" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Fact" }));
    fireEvent.click(screen.getByRole("button", { name: "Log it" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]![0].kind).toBe("fact");
  });

  it("surfaces a submit failure without clearing the form", async () => {
    const create = vi.fn(async () => {
      throw new Error("server said no");
    });
    render(<LogDecisionForm create={create} />);
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Keep me" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log it" }));
    expect(await screen.findByText("server said no")).toBeDefined();
    expect(screen.getByLabelText("Title")).toHaveValue("Keep me");
  });

  it("calls onCreated after a successful submit", async () => {
    const onCreated = vi.fn();
    render(<LogDecisionForm create={createSpy()} onCreated={onCreated} />);
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Done" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log it" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  });
});
