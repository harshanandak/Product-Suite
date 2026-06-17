import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Input } from "./input";

describe("ui Input", () => {
  test("renders an <input> with the input data-slot and forwards props", () => {
    const html = renderToStaticMarkup(
      createElement(Input, { placeholder: "Search", type: "search" }),
    );

    expect(html).toContain("<input");
    expect(html).toContain('data-slot="input"');
    expect(html).toContain('placeholder="Search"');
    expect(html).toContain('type="search"');
  });
});
