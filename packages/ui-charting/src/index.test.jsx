import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  MetricCard,
  formatTrendValue,
  normalizeChartData,
  sortChartDataByValue,
} from "./index.jsx";

describe("ui-charting shared charting block", () => {
  test("renders metric values, descriptions, and trend direction without shell coupling", () => {
    const html = renderToStaticMarkup(
      <MetricCard
        title="Completed work"
        value={42}
        description="Items shipped"
        trend={{ value: 12.5, direction: "up" }}
      />,
    );
    const neutralHtml = renderToStaticMarkup(
      <MetricCard title="Blocked work" value="3" trend={{ value: 0, direction: "neutral" }} />,
    );

    expect(html).toContain("Completed work");
    expect(html).toContain("42");
    expect(html).toContain("Items shipped");
    expect(html).toContain("+12.5%");
    expect(html).toContain("trend-up");
    expect(neutralHtml).toContain("0%");
    expect(neutralHtml).toContain("trend-neutral");
  });

  test("normalizes chart data without mutating caller-owned arrays", () => {
    const rows = [
      { label: "Backlog", count: 3 },
      { name: "Done", value: "5" },
      { label: "", count: Number.NaN },
    ];
    const originalRows = rows.map((row) => ({ ...row }));

    expect(normalizeChartData(rows, { nameKey: "label", valueKey: "count" })).toEqual([
      { name: "Backlog", value: 3 },
      { name: "Done", value: 5 },
      { name: "Untitled", value: 0 },
    ]);
    expect(rows).toEqual(originalRows);
  });

  test("falls back safely for null and non-array chart inputs", () => {
    for (const invalidRows of [null, undefined, "bad", 123, { name: "Backlog", value: 3 }]) {
      expect(normalizeChartData(invalidRows)).toEqual([]);
      expect(sortChartDataByValue(invalidRows)).toEqual([]);
    }
  });

  test("exports deterministic chart helpers", () => {
    const rows = [
      { name: "Small", value: 1 },
      { name: "Large", value: 10 },
      { name: "Missing", value: "nope" },
    ];

    expect(sortChartDataByValue(rows).map((row) => row.name)).toEqual(["Large", "Small", "Missing"]);
    expect(rows.map((row) => row.name)).toEqual(["Small", "Large", "Missing"]);
    expect(formatTrendValue({ value: 8, direction: "up" })).toBe("+8%");
    expect(formatTrendValue({ value: 8, direction: "down" })).toBe("-8%");
    expect(formatTrendValue({ value: 0, direction: "neutral" })).toBe("0%");
    expect(formatTrendValue()).toBe("");
  });
});
