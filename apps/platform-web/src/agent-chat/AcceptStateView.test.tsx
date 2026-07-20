import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AcceptResult } from "@/data/proposals";

import { AcceptStateView, type AcceptPhase } from "./AcceptStateView";

/** Render the view with all handlers spied and sensible defaults. */
function renderView(
  props: Partial<{
    phase: AcceptPhase;
    result: AcceptResult | null;
    busy: boolean;
    onViewItem: (itemId: string) => void;
  }> & { phase: AcceptPhase },
) {
  const handlers = {
    onRetry: vi.fn(),
    onEdit: vi.fn(),
    onDiscard: vi.fn(),
    onRefresh: vi.fn(),
    onApplyAnyway: vi.fn(),
  };
  render(
    <AcceptStateView
      phase={props.phase}
      result={props.result ?? null}
      busy={props.busy ?? false}
      onViewItem={props.onViewItem}
      {...handlers}
    />,
  );
  return handlers;
}

describe("AcceptStateView", () => {
  it("renders nothing in the idle phase", () => {
    const { container } = render(
      <AcceptStateView
        phase="idle"
        result={null}
        busy={false}
        onRetry={vi.fn()}
        onEdit={vi.fn()}
        onDiscard={vi.fn()}
        onRefresh={vi.fn()}
        onApplyAnyway={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("applying → shows the optimistic in-flight copy", () => {
    renderView({ phase: "applying" });
    expect(screen.getByText("Applying your change…")).toBeInTheDocument();
  });

  it("rejected → a muted 'Discarded.' terminal", () => {
    renderView({ phase: "rejected" });
    expect(screen.getByText("Discarded.")).toBeInTheDocument();
  });

  it("applied → the applied message + an optional View item action", () => {
    const onViewItem = vi.fn();
    renderView({
      phase: "settled",
      result: { status: "applied", proposal_id: "p1", item_id: "wi_1" },
      onViewItem,
    });
    expect(screen.getByText("Applied.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /View item/ }));
    expect(onViewItem).toHaveBeenCalledWith("wi_1");
  });

  it("invalid + retryable → message + Retry / Edit / Discard", () => {
    const handlers = renderView({
      phase: "settled",
      result: {
        status: "invalid",
        proposal_id: "p1",
        message: "Title is required.",
        retryable: true,
      },
    });
    expect(screen.getByText("Couldn’t apply this proposal")).toBeInTheDocument();
    expect(screen.getByText("Title is required.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(handlers.onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
  });

  it("invalid + NON-retryable → TERMINAL: Discard only, no dead Retry/Edit", () => {
    renderView({
      phase: "settled",
      result: {
        status: "invalid",
        proposal_id: "p1",
        message: "The team no longer exists.",
        retryable: false,
      },
    });
    expect(screen.getByText("The team no longer exists.")).toBeInTheDocument();
    // The copy must NOT promise a retry/edit that can't succeed.
    expect(
      screen.getByText(/can’t be retried as-is\. You can discard it\./),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
  });

  it("failed + NON-retryable → TERMINAL Discard-only (same rule as invalid)", () => {
    renderView({
      phase: "settled",
      result: {
        status: "failed",
        proposal_id: "p1",
        message: "Upstream rejected the write.",
        retryable: false,
      },
    });
    expect(screen.getByText("Upstream rejected the write.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
  });

  it("stale → 'This item changed' + message + Refresh / Discard / Apply anyway, with a non-promising override note", () => {
    const handlers = renderView({
      phase: "settled",
      result: {
        status: "stale",
        proposal_id: "p1",
        item_id: "wi_1",
        message: "Someone moved this item to Done.",
      },
    });
    expect(screen.getByText("This item changed")).toBeInTheDocument();
    expect(screen.getByText("Someone moved this item to Done.")).toBeInTheDocument();
    // Apply anyway must not promise a loop that the server can still decline.
    expect(screen.getByText(/the server may still decline it/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply anyway" }));
    expect(handlers.onApplyAnyway).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(handlers.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("not_found / not_pending → a minimal acknowledgement (nothing to act on)", () => {
    const { unmount } = render(
      <AcceptStateView
        phase="settled"
        result={{ status: "not_found", proposal_id: "p1" }}
        busy={false}
        onRetry={vi.fn()}
        onEdit={vi.fn()}
        onDiscard={vi.fn()}
        onRefresh={vi.fn()}
        onApplyAnyway={vi.fn()}
      />,
    );
    expect(screen.getByText("This proposal is no longer available.")).toBeInTheDocument();
    unmount();
    renderView({
      phase: "settled",
      result: { status: "not_pending", proposal_id: "p1" },
    });
    expect(screen.getByText("Already handled.")).toBeInTheDocument();
  });
});
