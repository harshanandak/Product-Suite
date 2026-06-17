import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Badge, badgeVariants } from "./badge";

describe("ui Badge", () => {
  test("renders a span with the default variant token classes and children", () => {
    const html = renderToStaticMarkup(createElement(Badge, null, "New"));

    expect(html).toContain("<span");
    expect(html).toContain('data-slot="badge"');
    expect(html).toContain("New");
    // shared base tokens
    expect(html).toContain("inline-flex");
    expect(html).toContain("rounded-full");
    expect(html).toContain("text-xs");
    // default variant tokens
    expect(html).toContain("bg-primary");
    expect(html).toContain("text-primary-foreground");
  });

  test("renders the secondary variant token classes", () => {
    const html = renderToStaticMarkup(
      createElement(Badge, { variant: "secondary" }, "Beta"),
    );

    expect(html).toContain("Beta");
    expect(html).toContain("bg-secondary");
    expect(html).toContain("text-secondary-foreground");
    expect(html).toContain('data-variant="secondary"');
    expect(html).not.toContain("bg-primary");
  });

  test("renders the outline variant with border token and no fill", () => {
    const html = renderToStaticMarkup(
      createElement(Badge, { variant: "outline" }, "Draft"),
    );

    expect(html).toContain("Draft");
    expect(html).toContain("border-border");
    expect(html).toContain("text-foreground");
    expect(html).not.toContain("bg-primary");
    expect(html).not.toContain("bg-secondary");
  });

  test("renders the destructive variant with white text", () => {
    const html = renderToStaticMarkup(
      createElement(Badge, { variant: "destructive" }, "Error"),
    );

    expect(html).toContain("bg-destructive");
    expect(html).toContain("text-white");
  });

  test("renders as its child element when asChild is set", () => {
    const html = renderToStaticMarkup(
      createElement(
        Badge,
        { asChild: true },
        createElement("a", { href: "/tag" }, "Tag"),
      ),
    );

    expect(html).toContain("<a");
    expect(html).toContain('data-slot="badge"');
    expect(html).not.toContain("<span");
  });

  test("forwards arbitrary span attributes", () => {
    const html = renderToStaticMarkup(
      createElement(Badge, { id: "status", title: "status badge" }, "Live"),
    );

    expect(html).toContain('id="status"');
    expect(html).toContain('title="status badge"');
  });

  test("badgeVariants resolves a class string for each variant", () => {
    expect(badgeVariants()).toContain("bg-primary");
    for (const variant of [
      "default",
      "secondary",
      "destructive",
      "outline",
      "ghost",
      "link",
    ] as const) {
      const classes = badgeVariants({ variant });
      expect(typeof classes).toBe("string");
      expect(classes.length).toBeGreaterThan(0);
    }
  });
});
