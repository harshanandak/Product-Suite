import { describe, expect, test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { EmptyState } from "./empty-state";

describe("EmptyState", () => {
  test("renders an accessible status region with the title and description", () => {
    const html = renderToStaticMarkup(
      <EmptyState
        title="No invoices yet"
        description="Create your first invoice to start tracking revenue."
      />,
    );

    expect(html).toContain("<output");
    expect(html).toContain("No invoices yet");
    expect(html).toContain("Create your first invoice to start tracking revenue.");
  });

  test("omits the description paragraph when no description is provided", () => {
    const html = renderToStaticMarkup(<EmptyState title="Nothing here" />);

    expect(html).toContain("<output");
    expect(html).toContain("Nothing here");
    expect(html).not.toContain("text-muted-foreground");
  });

  test("renders an action node when provided", () => {
    const html = renderToStaticMarkup(
      <EmptyState
        title="No projects"
        description="Start by creating one."
        action={<button type="button">Create project</button>}
      />,
    );

    expect(html).toContain("Create project");
    expect(html).toContain("<button");
    expect(html).toContain("mt-2");
  });

  test("renders an icon node when provided", () => {
    const html = renderToStaticMarkup(
      <EmptyState title="Empty inbox" icon={<svg data-testid="icon" />} />,
    );

    expect(html).toContain("Empty inbox");
    expect(html).toContain('data-testid="icon"');
  });

  test("forwards extra props and merges custom className onto the status container", () => {
    const html = renderToStaticMarkup(
      <EmptyState title="Custom" className="custom-empty" id="empty-1" />,
    );

    expect(html).toContain("<output");
    expect(html).toContain('id="empty-1"');
    expect(html).toContain("custom-empty");
  });
});
