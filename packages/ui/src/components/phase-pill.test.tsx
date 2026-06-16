import { describe, expect, test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PHASE_LABELS, PhasePill, type Phase } from "./phase-pill";

describe("PhasePill", () => {
  test("exports the correct PHASE_LABELS map", () => {
    expect(PHASE_LABELS).toEqual({
      plan: "Plan",
      execute: "Execute",
      review: "Review",
      done: "Done",
    });
  });

  test("renders each phase label and data-phase attribute", () => {
    const phases: Phase[] = ["plan", "execute", "review", "done"];

    for (const phase of phases) {
      const html = renderToStaticMarkup(<PhasePill phase={phase} />);

      expect(html).toContain(`data-phase="${phase}"`);
      expect(html).toContain(PHASE_LABELS[phase]);
    }
  });

  test("renders Plan label with its data-phase", () => {
    const html = renderToStaticMarkup(<PhasePill phase="plan" />);

    expect(html).toContain('data-phase="plan"');
    expect(html).toContain("Plan");
  });

  test("renders Execute label with its data-phase", () => {
    const html = renderToStaticMarkup(<PhasePill phase="execute" />);

    expect(html).toContain('data-phase="execute"');
    expect(html).toContain("Execute");
  });

  test("renders Review label with its data-phase", () => {
    const html = renderToStaticMarkup(<PhasePill phase="review" />);

    expect(html).toContain('data-phase="review"');
    expect(html).toContain("Review");
  });

  test("renders Done label with its data-phase", () => {
    const html = renderToStaticMarkup(<PhasePill phase="done" />);

    expect(html).toContain('data-phase="done"');
    expect(html).toContain("Done");
  });

  test("forwards extra props and merges className", () => {
    const html = renderToStaticMarkup(
      <PhasePill phase="plan" className="custom-class" id="my-pill" />,
    );

    expect(html).toContain('id="my-pill"');
    expect(html).toContain("custom-class");
    expect(html).toContain("rounded-full");
  });
});
