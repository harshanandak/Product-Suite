import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card";

describe("ui Card", () => {
  test("renders the card shell and its sections with data-slot hooks", () => {
    const html = renderToStaticMarkup(
      createElement(
        Card,
        null,
        createElement(
          CardHeader,
          null,
          createElement(CardTitle, null, "Project health"),
          createElement(CardDescription, null, "Last 7 days"),
        ),
        createElement(CardContent, null, "Body copy"),
        createElement(CardFooter, null, "Footer"),
      ),
    );

    expect(html).toContain('data-slot="card"');
    expect(html).toContain('data-slot="card-header"');
    expect(html).toContain('data-slot="card-title"');
    expect(html).toContain('data-slot="card-description"');
    expect(html).toContain('data-slot="card-content"');
    expect(html).toContain('data-slot="card-footer"');
    expect(html).toContain("Project health");
    expect(html).toContain("Last 7 days");
    expect(html).toContain("Body copy");
    expect(html).toContain("Footer");
  });
});
