import { render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createMockWorkItemRepository,
  deriveHealth,
  type WorkItemRow,
} from "@/data/work-items";

import { WorkboardSummary } from "./WorkboardSummary";

/**
 * recharts' `ResponsiveContainer` observes its box via `ResizeObserver`, which
 * jsdom omits (and the shared setup.ts does not stub). Without this the chart
 * throws on mount. A noop RO leaves the SVG at 0×0 — that is fine: every
 * assertion here targets the always-present `role="img"` text rollup, never the
 * (unrendered) bar segments.
 */
class ResizeObserverStub {
  observe(): void {
    /* no-op: jsdom has no ResizeObserver */
  }
  unobserve(): void {
    /* no-op */
  }
  disconnect(): void {
    /* no-op */
  }
}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

/**
 * Build real fixture-backed rows through the seam so phase is authentic and
 * health is genuinely derived. `now` is PINNED to 2026-06-20 (the fixtures'
 * reference instant) so the derived health spread matches the fixture comments
 * regardless of the wall clock.
 */
async function loadRows(): Promise<WorkItemRow[]> {
  const repository = createMockWorkItemRepository();
  const [items, tasks] = await Promise.all([
    repository.list(),
    repository.listTasks(),
  ]);
  const now = Date.parse("2026-06-20T00:00:00.000Z");
  return items.map((item) => {
    const itemTasks = tasks.filter((task) => task.work_item_id === item.id);
    return {
      ...item,
      health: deriveHealth(item, itemTasks, now),
      taskCount: itemTasks.length,
      completedTaskCount: itemTasks.filter((t) => t.status === "completed")
        .length,
    };
  });
}

/** The single AT surface: the visually-hidden role="img" rollup paragraph. */
function summaryImage(): HTMLElement {
  return screen.getByRole("img", { name: /work items/i });
}

describe("WorkboardSummary", () => {
  it("rolls fixture rows into an accessible phase + health breakdown", async () => {
    const rows = await loadRows();
    render(<WorkboardSummary rows={rows} />);

    const label = summaryImage().getAttribute("aria-label") ?? "";

    // 10 fixture rows, 1 archived → 9 active counted.
    expect(label).toContain("9 active work items");

    // Phase distribution (clock-independent): plan 3 / execute 3 / review 2 / done 1.
    expect(label).toContain("Plan 3");
    expect(label).toContain("Execute 3");
    expect(label).toContain("Review 2");
    expect(label).toContain("Done 1");

    // Health distribution (now = 2026-06-20): on_track 3 / at_risk 3 / blocked 3.
    expect(label).toContain("On track 3");
    expect(label).toContain("At risk 3");
    expect(label).toContain("Blocked 3");
  });

  it("excludes archived rows from counts and surfaces them separately", async () => {
    const rows = await loadRows();
    render(<WorkboardSummary rows={rows} />);

    const label = summaryImage().getAttribute("aria-label") ?? "";
    // Exactly one archived fixture (wi_samples, done/on_track) is mentioned…
    expect(label).toContain("1 archived (excluded)");
    // …and never folded into the active total.
    expect(label).toContain("9 active work items");

    // A visible muted footnote also reports the archived count.
    expect(
      screen.getByTestId("workboard-summary-archived"),
    ).toHaveTextContent("1 archived item excluded.");
  });

  it("renders the two labelled distribution charts", async () => {
    const rows = await loadRows();
    render(<WorkboardSummary rows={rows} />);

    const region = screen.getByTestId("workboard-summary");
    expect(within(region).getByText("Phase")).toBeInTheDocument();
    expect(within(region).getByText("Health")).toBeInTheDocument();
  });

  it("renders a graceful empty state with zero rows", () => {
    render(<WorkboardSummary rows={[]} />);

    expect(
      screen.getByTestId("workboard-summary-empty"),
    ).toBeInTheDocument();
    expect(summaryImage()).toHaveAttribute(
      "aria-label",
      expect.stringContaining("No active work items"),
    );
  });

  it("counts only active rows when every visible row is archived", () => {
    const archivedRow: WorkItemRow = {
      id: "wi_only_archived",
      title: "Archived only",
      phase: "done",
      type: "chore",
      priority: "low",
      tags: [],
      source: "manual",
      project_id: null,
      department: "Ops",
      assignee_id: null,
      due_date: null,
      archived: true,
      created_at: "2026-05-01T09:00:00.000Z",
      updated_at: "2026-06-19T09:00:00.000Z",
      health: "on_track",
      taskCount: 0,
      completedTaskCount: 0,
    };
    render(<WorkboardSummary rows={[archivedRow]} />);

    const label = summaryImage().getAttribute("aria-label") ?? "";
    expect(label).toContain("No active work items");
    expect(label).toContain("1 archived (excluded)");
    expect(screen.getByTestId("workboard-summary-empty")).toHaveTextContent(
      "1 archived.",
    );
  });
});
