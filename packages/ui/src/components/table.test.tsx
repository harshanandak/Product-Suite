import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table";

describe("ui Table", () => {
  test("renders a table with header and body rows", () => {
    const html = renderToStaticMarkup(
      createElement(
        Table,
        null,
        createElement(
          TableHeader,
          null,
          createElement(
            TableRow,
            null,
            createElement(TableHead, null, "Name"),
          ),
        ),
        createElement(
          TableBody,
          null,
          createElement(
            TableRow,
            null,
            createElement(TableCell, null, "Acme"),
          ),
        ),
      ),
    );

    expect(html).toContain("<table");
    expect(html).toContain('data-slot="table"');
    expect(html).toContain("<thead");
    expect(html).toContain("<tbody");
    expect(html).toContain("Name");
    expect(html).toContain("Acme");
  });
});
