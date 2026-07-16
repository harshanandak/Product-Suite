import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { MemoryImpact } from "@/data/memory-impact";
import { createMemoryImpactFixture } from "@/data/memory-impact";

// The card links the "hurts" caution to the rule list via a router <Link>; stub
// the router so the card can render standalone (mirrors the MemoryScreen test).
vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ workspace: "demo" }),
  Link: ({
    to,
    children,
  }: {
    to: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => <a href={to}>{children}</a>,
}));

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
  it("insufficient — renders 'measuring' + counts, NO headline number", () => {
    setImpact({
      verdict: "insufficient",
      holdout: { applied: 4, edited: 1, editRate: 0.25, rejected: 0, rejectRate: 0 },
      treated: { applied: 3, edited: 1, editRate: 0.33, rejected: 0, rejectRate: 0 },
      savedEdits: 0,
      window_days: 30,
    });
    render(<MemoryImpactCard />);

    expect(screen.getByText(/not enough data yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Measuring/i)).toBeInTheDocument();
    // Small cohort counts are shown.
    expect(screen.getByText(/4/)).toBeInTheDocument();
    expect(screen.getByText(/3/)).toBeInTheDocument();
    // No headline saved-edits number.
    expect(screen.queryByText(/saved you/i)).toBeNull();
    expect(screen.queryByText(/~\s*\d+\s*edits/i)).toBeNull();
  });

  it("helps — headline saved-edits + comparison with both rates and applied counts", () => {
    setImpact({
      verdict: "helps",
      savedEdits: 12,
      window_days: 30,
      holdout: { applied: 8, edited: 4, editRate: 0.5, rejected: 0, rejectRate: 0 },
      treated: { applied: 12, edited: 2, editRate: 0.167, rejected: 0, rejectRate: 0 },
    });
    render(<MemoryImpactCard />);

    // Headline — the ~ stays, the number renders, window echoed.
    expect(
      screen.getByText(/Memory saved you ~12 edits in the last 30 days/i),
    ).toBeInTheDocument();
    // Comparison — BOTH editRates as whole % AND BOTH applied counts.
    const comparison = screen.getByText(
      /You edited 50% of the agent's proposals without memory \(from 8\), vs 17% with it \(from 12\)\./i,
    );
    expect(comparison).toBeInTheDocument();
  });

  it("hurts — caution copy (editing MORE) + review link, NO positive saved number", () => {
    setImpact({
      verdict: "hurts",
      savedEdits: 0,
      window_days: 30,
      holdout: { applied: 10, edited: 2, editRate: 0.2, rejected: 0, rejectRate: 0 },
      treated: { applied: 9, edited: 5, editRate: 0.556, rejected: 0, rejectRate: 0 },
    });
    render(<MemoryImpactCard />);

    expect(
      screen.getByText(
        /You're editing more of the agent's proposals with memory on \(56% vs 20% without it\)/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Your rules may be too broad/i)).toBeInTheDocument();
    // A link to the rule list to review.
    expect(screen.getByRole("link", { name: /review/i })).toBeInTheDocument();
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

  it("renders nothing while loading or on error (honest silence, no flash)", () => {
    impactMock = null;
    loadingMock = true;
    errorMock = null;
    const { container, unmount } = render(<MemoryImpactCard />);
    expect(container).toBeEmptyDOMElement();
    unmount();

    impactMock = null;
    loadingMock = false;
    errorMock = new Error("boom");
    const { container: c2 } = render(<MemoryImpactCard />);
    expect(c2).toBeEmptyDOMElement();
  });
});
