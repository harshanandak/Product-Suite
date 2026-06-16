import { describe, expect, test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Badge, badgeVariants } from "./badge.tsx";

describe("ui Badge", () => {
  test("renders a span with default variant token classes and children", () => {
    const html = renderToStaticMarkup(<Badge>New</Badge>);

    expect(html).toContain("<span");
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
    const html = renderToStaticMarkup(<Badge variant="secondary">Beta</Badge>);

    expect(html).toContain("Beta");
    expect(html).toContain("bg-secondary");
    expect(html).toContain("text-secondary-foreground");
    expect(html).not.toContain("bg-primary");
  });

  test("renders the outline variant with border token and no fill", () => {
    const html = renderToStaticMarkup(<Badge variant="outline">Draft</Badge>);

    expect(html).toContain("Draft");
    expect(html).toContain("border-border");
    expect(html).toContain("text-foreground");
    expect(html).not.toContain("bg-primary");
    expect(html).not.toContain("bg-secondary");
  });

  test("merges a caller className alongside variant tokens", () => {
    const html = renderToStaticMarkup(<Badge className="ml-2">Tag</Badge>);

    expect(html).toContain("ml-2");
    expect(html).toContain("bg-primary");
  });

  test("forwards arbitrary span attributes", () => {
    const html = renderToStaticMarkup(
      <Badge id="status" title="status badge">
        Live
      </Badge>,
    );

    expect(html).toContain('id="status"');
    expect(html).toContain('title="status badge"');
  });

  test("badgeVariants helper resolves tokens for each variant", () => {
    expect(badgeVariants()).toContain("bg-primary");
    expect(badgeVariants({ variant: "muted" })).toContain("bg-muted");
    expect(badgeVariants({ variant: "muted" })).toContain("text-muted-foreground");
    expect(badgeVariants({ variant: "accent" })).toContain("bg-accent");
    expect(badgeVariants({ variant: "accent" })).toContain("text-accent-foreground");
  });
});
