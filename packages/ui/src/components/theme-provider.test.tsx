import { describe, expect, test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ThemeProvider, applyTheme, useTheme } from "./theme-provider";

function ThemeProbe() {
  const { theme, resolvedTheme } = useTheme();
  return (
    <span data-theme={theme} data-resolved={resolvedTheme}>
      {resolvedTheme}
    </span>
  );
}

describe("ThemeProvider", () => {
  test("resolves an explicit light defaultTheme to light without a DOM", () => {
    const html = renderToStaticMarkup(
      <ThemeProvider defaultTheme="light">
        <ThemeProbe />
      </ThemeProvider>,
    );

    expect(html).toContain('data-theme="light"');
    expect(html).toContain('data-resolved="light"');
    expect(html).toContain(">light<");
  });

  test('resolves the default "system" theme to light when matchMedia is unavailable', () => {
    const html = renderToStaticMarkup(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    expect(html).toContain('data-theme="system"');
    expect(html).toContain('data-resolved="light"');
  });

  test("useTheme throws when rendered outside a ThemeProvider", () => {
    expect(() => renderToStaticMarkup(<ThemeProbe />)).toThrow(
      "useTheme must be used within a ThemeProvider",
    );
  });

  test("exports applyTheme as a callable that no-ops without a document", () => {
    expect(typeof applyTheme).toBe("function");
    expect(() => applyTheme("dark")).not.toThrow();
  });
});
