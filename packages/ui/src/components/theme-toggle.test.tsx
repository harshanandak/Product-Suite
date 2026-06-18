import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ThemeProvider } from "./theme-provider";
import { ThemeToggle } from "./theme-toggle";

describe("ui ThemeToggle", () => {
  test("renders a button with an aria-label for switching mode (light default)", () => {
    const html = renderToStaticMarkup(
      <ThemeProvider defaultTheme="light">
        <ThemeToggle />
      </ThemeProvider>,
    );

    expect(html).toContain("<button");
    // With light resolved, the next mode is dark.
    expect(html).toContain('aria-label="Switch to dark mode"');
    expect(html).toContain('title="Switch to dark mode"');
  });

  test("forwards className onto the rendered button", () => {
    const html = renderToStaticMarkup(
      <ThemeProvider defaultTheme="light">
        <ThemeToggle className="ml-2" />
      </ThemeProvider>,
    );

    expect(html).toContain("<button");
    expect(html).toContain("ml-2");
  });
});
