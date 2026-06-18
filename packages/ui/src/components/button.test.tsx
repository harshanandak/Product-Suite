import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Button, buttonVariants } from "./button";

describe("ui Button", () => {
  test("renders a <button> with its children and the button data-slot", () => {
    const html = renderToStaticMarkup(createElement(Button, null, "Save changes"));

    expect(html).toContain("<button");
    expect(html).toContain('data-slot="button"');
    expect(html).toContain("Save changes");
  });

  test("does not force a default type attribute (keeps the native default)", () => {
    const html = renderToStaticMarkup(createElement(Button, null, "Submit"));

    expect(html).not.toContain('type="button"');
  });

  test("applies the default variant and size classes", () => {
    const html = renderToStaticMarkup(createElement(Button, null, "Default"));

    expect(html).toContain("bg-primary");
    expect(html).toContain("text-primary-foreground");
    expect(html).toContain("h-9");
    expect(html).toContain("px-4");
  });

  test("applies a non-default variant and size", () => {
    const html = renderToStaticMarkup(
      createElement(Button, { variant: "destructive", size: "lg" }, "Delete"),
    );

    // shadcn's destructive variant pairs the destructive fill with white text.
    expect(html).toContain("bg-destructive");
    expect(html).toContain("text-white");
    expect(html).toContain("h-10");
    expect(html).toContain("px-6");
    expect(html).not.toContain("bg-primary");
    expect(html).toContain('data-variant="destructive"');
    expect(html).toContain('data-size="lg"');
  });

  test("renders as its child element when asChild is set", () => {
    const html = renderToStaticMarkup(
      createElement(
        Button,
        { asChild: true },
        createElement("a", { href: "/docs" }, "Docs"),
      ),
    );

    expect(html).toContain("<a");
    expect(html).toContain('href="/docs"');
    expect(html).toContain('data-slot="button"');
    expect(html).not.toContain("<button");
  });

  test("merges a custom className with the variant classes", () => {
    const html = renderToStaticMarkup(
      createElement(Button, { className: "custom-class" }, "Styled"),
    );

    expect(html).toContain("custom-class");
    expect(html).toContain("inline-flex");
    expect(html).toContain("bg-primary");
  });

  test("buttonVariants resolves a class string for each variant", () => {
    for (const variant of [
      "default",
      "destructive",
      "outline",
      "secondary",
      "ghost",
      "link",
    ] as const) {
      const classes = buttonVariants({ variant });
      expect(typeof classes).toBe("string");
      expect(classes.length).toBeGreaterThan(0);
    }
  });
});
