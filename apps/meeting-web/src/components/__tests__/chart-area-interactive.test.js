import { afterEach, describe, expect, test, vi } from "vitest";

import { buildSeries } from "../chart-area-interactive";

describe("buildSeries", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("anchors the activity window to today when the newest meeting is stale", () => {
    vi.useFakeTimers();
    const frozenNow = new Date(2026, 3, 16, 12, 0, 0, 0);
    vi.setSystemTime(frozenNow);

    const series = buildSeries(
      [
        {
          id: "meeting-1",
          status: "completed",
          updated_at: "2026-03-01T08:00:00.000Z",
        },
      ],
      "7d",
    );

    expect(series).toHaveLength(7);
    const expectedLastBucketDate = [
      frozenNow.getFullYear(),
      String(frozenNow.getMonth() + 1).padStart(2, "0"),
      String(frozenNow.getDate()).padStart(2, "0"),
    ].join("-");
    expect(series.at(-1)?.date).toBe(expectedLastBucketDate);
    expect(series.every((bucket) => bucket.total === 0 && bucket.completed === 0)).toBe(true);
  });
});
