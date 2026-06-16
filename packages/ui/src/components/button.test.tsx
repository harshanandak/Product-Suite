import { describe, expect, test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Button } from "./button";

describe("ui Button", () => {
  test("renders a button[type=button] with its children by default", () => {
    const html = renderToStaticMarkup(<Button>Save changes</Button>);

    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
    expect(html).toContain("Save changes");
  });

  test("applies the default variant and size classes", () => {
    const html = renderToStaticMarkup(<Button>Default</Button>);

    expect(html).toContain("bg-primary");
    expect(html).toContain("text-primary-foreground");
    expect(html).toContain("h-9");
    expect(html).toContain("px-4");
  });

  test("applies a non-default variant and size", () => {
    const html = renderToStaticMarkup(
      <Button variant="destructive" size="lg">
        Delete
      </Button>,
    );

    expect(html).toContain("bg-destructive");
    expect(html).toContain("text-destructive-foreground");
    expect(html).toContain("h-10");
    expect(html).toContain("px-6");
    expect(html).not.toContain("bg-primary");
  });

  test("merges a custom className with the variant classes", () => {
    const html = renderToStaticMarkup(
      <Button className="custom-class">Styled</Button>,
    );

    expect(html).toContain("custom-class");
    expect(html).toContain("inline-flex");
    expect(html).toContain("bg-primary");
  });
});
