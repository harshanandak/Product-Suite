import { describe, expect, test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ErrorState } from "./error-state";

describe("ErrorState", () => {
  test("renders an alert role with the default title", () => {
    const html = renderToStaticMarkup(<ErrorState />);

    expect(html).toContain('role="alert"');
    expect(html).toContain("Something went wrong");
  });

  test("renders a provided description and action", () => {
    const html = renderToStaticMarkup(
      <ErrorState
        title="Failed to load report"
        description="The server did not respond in time."
        action={<button type="button">Retry</button>}
      />,
    );

    expect(html).toContain("Failed to load report");
    expect(html).toContain("The server did not respond in time.");
    expect(html).toContain("Retry");
    expect(html).toContain("<button");
  });

  test("omits the description and action when not provided", () => {
    const html = renderToStaticMarkup(<ErrorState />);

    expect(html).not.toContain("text-muted-foreground");
    expect(html).not.toContain('class="mt-2"');
  });
});
