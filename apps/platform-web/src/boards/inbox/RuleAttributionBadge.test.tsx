import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RuleAttributionBadge } from "./RuleAttributionBadge";

describe("RuleAttributionBadge", () => {
  it("renders nothing when there are no active rules (graceful no-op)", () => {
    const { container } = render(<RuleAttributionBadge ruleTitles={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists the active rule titles, worded as active-during (not caused)", () => {
    render(
      <RuleAttributionBadge
        ruleTitles={["Prefer concise titles", "Always link the source"]}
      />,
    );
    expect(screen.getByText(/Rules active during this run:/)).toBeInTheDocument();
    expect(
      screen.getByText(/Prefer concise titles, Always link the source/),
    ).toBeInTheDocument();
  });
});
