import { describe, expect, test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { STATUS_LABELS, StatusPill, type CheckStatus } from "./status-pill";

const STATUSES: CheckStatus[] = ["todo", "in_progress", "completed"];

describe("StatusPill", () => {
  test("exposes the fixed check-status triad labels", () => {
    expect(STATUS_LABELS).toEqual({
      todo: "To-do",
      in_progress: "In progress",
      completed: "Completed",
    });
  });

  test("renders each CheckStatus with its label and data-status", () => {
    for (const status of STATUSES) {
      const html = renderToStaticMarkup(<StatusPill status={status} />);
      expect(html).toContain(`data-status="${status}"`);
      expect(html).toContain(STATUS_LABELS[status]);
    }
  });

  test("renders To-do for the todo status", () => {
    const html = renderToStaticMarkup(<StatusPill status="todo" />);
    expect(html).toContain('data-status="todo"');
    expect(html).toContain("To-do");
  });

  test("renders In progress for the in_progress status", () => {
    const html = renderToStaticMarkup(<StatusPill status="in_progress" />);
    expect(html).toContain('data-status="in_progress"');
    expect(html).toContain("In progress");
  });

  test("renders Completed for the completed status", () => {
    const html = renderToStaticMarkup(<StatusPill status="completed" />);
    expect(html).toContain('data-status="completed"');
    expect(html).toContain("Completed");
  });

  test("applies the base pill classes for every status", () => {
    for (const status of STATUSES) {
      const html = renderToStaticMarkup(<StatusPill status={status} />);
      expect(html).toContain("inline-flex");
      expect(html).toContain("rounded-full");
    }
  });

  test("merges a caller-provided className and forwards span attributes", () => {
    const html = renderToStaticMarkup(
      <StatusPill status="completed" className="custom-class" title="run status" />,
    );
    expect(html).toContain("custom-class");
    expect(html).toContain('title="run status"');
    expect(html).toContain('data-status="completed"');
  });

  test("renders a span element", () => {
    const html = renderToStaticMarkup(<StatusPill status="todo" />);
    expect(html.startsWith("<span")).toBe(true);
  });
});
