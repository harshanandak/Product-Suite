import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { CuratorVerdict } from "@/data/proposals";

import { CuratorVerdictPanel } from "./CuratorVerdictPanel";

function verdict(over: Partial<CuratorVerdict> = {}): CuratorVerdict {
  return {
    outcome: "clean",
    summary:
      "Nothing in memory duplicates, overlaps with, or contradicts this, and it is well-formed on its own.",
    quality: [],
    collisions: [],
    private_lane_skipped: false,
    advisory: true,
    ...over,
  };
}

const COLLISION = {
  relation: "duplicate" as const,
  memory_id: "m_1",
  title: "Pricing pages ship through the growth review",
  visibility: "org" as const,
  scope_type: "org" as const,
  similarity: 0.91,
  reason: "This says essentially what “Pricing pages ship through the growth review” (m_1) already says.",
};

describe("CuratorVerdictPanel", () => {
  it("renders nothing without a verdict (fixture mode, or a failed read)", () => {
    const { container } = render(<CuratorVerdictPanel verdict={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when there was nothing to curate", () => {
    const { container } = render(
      <CuratorVerdictPanel verdict={verdict({ outcome: "not_applicable", summary: "x" })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the summary for a clean verdict", () => {
    render(<CuratorVerdictPanel verdict={verdict()} />);
    expect(screen.getByText(/well-formed on its own/)).toBeInTheDocument();
  });

  it("names the colliding memory — its title, its id, and why", () => {
    render(
      <CuratorVerdictPanel
        verdict={verdict({
          outcome: "duplicate",
          summary: "This duplicates an org memory: “Pricing pages ship through the growth review” (m_1).",
          collisions: [COLLISION],
        })}
      />,
    );
    // The title appears in both the summary and the named collision row — both are
    // meant to carry it, so assert presence rather than uniqueness.
    expect(
      screen.getAllByText(/Pricing pages ship through the growth review/).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/m_1/).length).toBeGreaterThan(0);
    expect(screen.getByText(/already says/)).toBeInTheDocument();
    expect(screen.getByText("Duplicates")).toBeInTheDocument();
  });

  it("labels a conflict distinctly from a duplicate", () => {
    render(
      <CuratorVerdictPanel
        verdict={verdict({
          outcome: "conflict",
          collisions: [{ ...COLLISION, relation: "conflict", memory_id: "m_2" }],
        })}
      />,
    );
    expect(screen.getByText("Contradicts")).toBeInTheDocument();
    expect(screen.getByText("Contradicts existing memory")).toBeInTheDocument();
    expect(screen.queryByText("Duplicates")).not.toBeInTheDocument();
  });

  it("marks a private collider as the reviewer’s OWN note, never as org policy", () => {
    render(
      <CuratorVerdictPanel
        verdict={verdict({
          outcome: "overlap",
          collisions: [{ ...COLLISION, relation: "overlap", visibility: "private" }],
        })}
      />,
    );
    expect(screen.getByText(/your private note/i)).toBeInTheDocument();
  });

  it("shows each quality finding’s reason, not its code", () => {
    render(
      <CuratorVerdictPanel
        verdict={verdict({
          outcome: "quality_only",
          quality: [
            { code: "applicability_missing", reason: "This is a rule but it never says when it applies." },
          ],
        })}
      />,
    );
    expect(screen.getByText(/never says when it applies/)).toBeInTheDocument();
    expect(screen.queryByText("applicability_missing")).not.toBeInTheDocument();
  });

  it("says so when the personal lane was not checked", () => {
    render(<CuratorVerdictPanel verdict={verdict({ private_lane_skipped: true })} />);
    expect(screen.getByText(/org memory only|personal/i)).toBeInTheDocument();
  });

  it("does not claim a partial check when both lanes ran", () => {
    render(<CuratorVerdictPanel verdict={verdict()} />);
    expect(screen.queryByText(/org memory only/i)).not.toBeInTheDocument();
  });

  it("labels itself advisory and renders no control of its own", () => {
    // The panel informs a decision; it must never look like it makes one.
    const { container } = render(
      <CuratorVerdictPanel verdict={verdict({ outcome: "conflict", collisions: [COLLISION] })} />,
    );
    expect(screen.getByText(/advisory/i)).toBeInTheDocument();
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.querySelectorAll("input")).toHaveLength(0);
  });
});
