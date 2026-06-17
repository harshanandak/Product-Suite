import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Label } from "./label";

describe("ui Label", () => {
  test("renders a <label> with the label data-slot and its text", () => {
    const html = renderToStaticMarkup(
      createElement(Label, { htmlFor: "email" }, "Email address"),
    );

    expect(html).toContain("<label");
    expect(html).toContain('data-slot="label"');
    expect(html).toContain('for="email"');
    expect(html).toContain("Email address");
  });
});
