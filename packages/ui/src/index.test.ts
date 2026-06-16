import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  HealthBadge,
  PhasePill,
  StatusPill,
  ThemeProvider,
  ThemeToggle,
  applyTheme,
  cn,
} from "./index";

describe("@product-suite/ui barrel", () => {
  test("exports the documented public surface as callable values", () => {
    for (const exported of [
      cn,
      Button,
      Badge,
      PhasePill,
      StatusPill,
      HealthBadge,
      EmptyState,
      ErrorState,
      ThemeProvider,
      ThemeToggle,
      applyTheme,
    ]) {
      expect(exported).toBeDefined();
    }
    // Every public export is invokable: plain components are functions and
    // forwardRef wrappers (Button) are objects, but none should be undefined.
    expect(typeof cn).toBe("function");
    expect(typeof applyTheme).toBe("function");
  });

  test("cn merges classes and resolves Tailwind conflicts", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-sm", undefined, "font-medium")).toBe("text-sm font-medium");
  });

  test("applyTheme is a no-op without a document and never throws", () => {
    expect(() => applyTheme("dark")).not.toThrow();
    expect(() => applyTheme("light")).not.toThrow();
  });

  test("Button renders a button with default type and variant classes", () => {
    const html = renderToStaticMarkup(
      createElement(Button, null, "Save changes"),
    );
    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
    expect(html).toContain("Save changes");
    expect(html).toContain("bg-primary");
  });

  test("Badge renders a span with the default variant token classes", () => {
    const html = renderToStaticMarkup(createElement(Badge, null, "New"));
    expect(html).toContain("<span");
    expect(html).toContain("New");
    expect(html).toContain("bg-primary");
  });

  test("PhasePill renders the human label and data attribute for its phase", () => {
    const html = renderToStaticMarkup(
      createElement(PhasePill, { phase: "execute" }),
    );
    expect(html).toContain('data-phase="execute"');
    expect(html).toContain("Execute");
  });

  test("StatusPill renders the human label and data attribute for its status", () => {
    const html = renderToStaticMarkup(
      createElement(StatusPill, { status: "in_progress" }),
    );
    expect(html).toContain('data-status="in_progress"');
    expect(html).toContain("In progress");
  });

  test("HealthBadge renders the derived health label and data attribute", () => {
    const html = renderToStaticMarkup(
      createElement(HealthBadge, { health: "at_risk" }),
    );
    expect(html).toContain('data-health="at_risk"');
    expect(html).toContain("At risk");
  });

  test("EmptyState renders title, description and action with status role", () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, {
        title: "No work items yet",
        description: "Create your first work item to get started.",
        action: createElement("button", null, "Create"),
      }),
    );
    expect(html).toContain("<output");
    expect(html).toContain("No work items yet");
    expect(html).toContain("Create your first work item to get started.");
    expect(html).toContain("Create");
  });

  test("ErrorState renders its default title under the alert role", () => {
    const html = renderToStaticMarkup(createElement(ErrorState, null));
    expect(html).toContain('role="alert"');
    expect(html).toContain("Something went wrong");
  });

  test("ThemeProvider renders children and resolves to light when matchMedia is absent", () => {
    // Without window.matchMedia the system theme falls back to light, so the
    // toggle advertises switching TO dark and renders the Moon icon.
    const html = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        null,
        createElement("p", null, "Inside provider"),
        createElement(ThemeToggle, null),
      ),
    );
    expect(html).toContain("Inside provider");
    expect(html).toContain('aria-label="Switch to dark mode"');
    expect(html).toContain("<svg");
  });
});
