import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { MemoryImpact } from "@/data/memory-impact";
import { createMemoryImpactFixture } from "@/data/memory-impact";

// The card reads everything through `useMemoryImpact`; stub it with a fixture so
// each test drives one verdict state (per the task brief).
let impactMock: MemoryImpact | null = null;
let loadingMock = false;
let errorMock: Error | null = null;
vi.mock("@/data/memory-impact/use-memory-impact", () => ({
  useMemoryImpact: () => ({
    impact: impactMock,
    loading: loadingMock,
    error: errorMock,
  }),
}));

import { MemoryImpactCard } from "./MemoryImpactCard";

function setImpact(overrides: Partial<MemoryImpact>): void {
  impactMock = createMemoryImpactFixture(overrides);
  loadingMock = false;
  errorMock = null;
}

describe("MemoryImpactCard", () => {
  it("insufficient — renders 'measuring' + no-slash comparison, NO headline number", () => {
    setImpact({
      verdict: "insufficient",
      holdout: { applied: 4, edited: 1, editRate: 0.25, rejected: 0, rejectRate: 0, threads: 4 },
      treated: { applied: 3, edited: 1, editRate: 0.33, rejected: 0, rejectRate: 0, threads: 3 },
      savedEdits: 0,
      window_days: 30,
    });
    render(<MemoryImpactCard />);

    expect(
      screen.getByText(/Measuring how much memory helps/i),
    ).toBeInTheDocument();
    // Cohort counts read as a comparison, not a fraction (no slash).
    expect(
      screen.getByText(
        /Comparing 3 proposals with memory and 4 without, so far\./i,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("/")).toBeNull();
    // No headline saved-edits number.
    expect(screen.queryByText(/saved you/i)).toBeNull();
    expect(screen.queryByText(/~\s*\d+\s*edits/i)).toBeNull();
  });

  it("helps — headline saved-edits + comparison with both rates and edited/applied counts", () => {
    setImpact({
      verdict: "helps",
      savedEdits: 12,
      window_days: 30,
      holdout: { applied: 8, edited: 4, editRate: 0.5, rejected: 0, rejectRate: 0, threads: 8 },
      treated: { applied: 12, edited: 2, editRate: 0.167, rejected: 0, rejectRate: 0, threads: 12 },
    });
    render(<MemoryImpactCard />);

    // Headline — the ~ stays, the number renders, window echoed, plural "edits".
    expect(
      screen.getByText(/Memory saved you ~12 edits in the last 30 days/i),
    ).toBeInTheDocument();
    // Comparison — BOTH editRates as whole % AND BOTH edited/applied counts.
    expect(
      screen.getByText(
        /Without memory you edited 50% of proposals \(4 of 8\); with it, 17% \(2 of 12\)\./i,
      ),
    ).toBeInTheDocument();
    // Honest holdout disclosure footer.
    expect(
      screen.getByText(/a small share of runs skip memory/i),
    ).toBeInTheDocument();
  });

  it("helps — pluralizes '~1 edit' (singular)", () => {
    setImpact({
      verdict: "helps",
      savedEdits: 1,
      window_days: 30,
      holdout: { applied: 20, edited: 4, editRate: 0.2, rejected: 0, rejectRate: 0, threads: 20 },
      treated: { applied: 20, edited: 3, editRate: 0.15, rejected: 0, rejectRate: 0, threads: 20 },
    });
    render(<MemoryImpactCard />);

    expect(
      screen.getByText(/Memory saved you ~1 edit in the last 30 days/i),
    ).toBeInTheDocument();
    // Not the plural form.
    expect(screen.queryByText(/~1 edits/i)).toBeNull();
  });

  it("hurts — caution copy (editing MORE) points to the rule list below, NO link, role=status", () => {
    setImpact({
      verdict: "hurts",
      savedEdits: 0,
      window_days: 30,
      holdout: { applied: 10, edited: 2, editRate: 0.2, rejected: 0, rejectRate: 0, threads: 10 },
      treated: { applied: 9, edited: 5, editRate: 0.556, rejected: 0, rejectRate: 0, threads: 9 },
    });
    render(<MemoryImpactCard />);

    expect(
      screen.getByText(
        /You're editing more of the agent's proposals with memory on \(56% vs 20% without it\)/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Your rules are listed below — retract any that look too broad/i),
    ).toBeInTheDocument();
    // The dead-end self-link is gone.
    expect(screen.queryByRole("link")).toBeNull();
    // role=status (not alert) — does not interrupt screen readers on mount.
    expect(screen.getByRole("status")).toBeInTheDocument();
    // Honest holdout disclosure footer.
    expect(
      screen.getByText(/a small share of runs skip memory/i),
    ).toBeInTheDocument();
    // Never a positive "saved" headline on hurts.
    expect(screen.queryByText(/saved you/i)).toBeNull();
  });

  it("never shows a headline number unless verdict is 'helps'", () => {
    for (const verdict of ["insufficient", "hurts"] as const) {
      setImpact({ verdict, savedEdits: 99, window_days: 30 });
      const { unmount } = render(<MemoryImpactCard />);
      expect(screen.queryByText(/~\s*99/)).toBeNull();
      expect(screen.queryByText(/saved you/i)).toBeNull();
      unmount();
    }
  });

  it("renders a skeleton while loading (reserves space, no board shift)", () => {
    impactMock = null;
    loadingMock = true;
    errorMock = null;
    render(<MemoryImpactCard />);
    // The skeleton is present and labelled (mirrors MemoryScreen's pattern).
    expect(screen.getByLabelText(/measuring memory impact/i)).toBeInTheDocument();
  });

  it("renders nothing on error (honest silence, no flash)", () => {
    impactMock = null;
    loadingMock = false;
    errorMock = new Error("boom");
    const { container } = render(<MemoryImpactCard />);
    expect(container).toBeEmptyDOMElement();
  });
});
