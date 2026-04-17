// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, test } from "vitest";

import { DataTable } from "../data-table";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function mountDataTable(meetings) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <MemoryRouter>
        <DataTable meetings={meetings} />
      </MemoryRouter>,
    );
  });

  return {
    container,
    cleanup() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("DataTable", () => {
  test("exposes keyboard-accessible move controls in manual order mode", () => {
    const { container, cleanup } = mountDataTable([
      { id: "meeting-1", title: "Alpha", status: "created", duration_seconds: 60 },
      { id: "meeting-2", title: "Bravo", status: "completed", duration_seconds: 120 },
    ]);

    expect(container.querySelector('button[aria-label="Move Alpha down"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Move Bravo up"]')).not.toBeNull();
    cleanup();
  });

  test("reorders rows when the move controls are used", () => {
    const { container, cleanup } = mountDataTable([
      { id: "meeting-1", title: "Alpha", status: "created", duration_seconds: 60 },
      { id: "meeting-2", title: "Bravo", status: "completed", duration_seconds: 120 },
    ]);

    const before = Array.from(container.querySelectorAll('a[href^="/meetings/"]')).map((link) => link.textContent.trim());
    expect(before).toEqual(["Alpha", "Bravo"]);

    const moveDownButton = container.querySelector('button[aria-label="Move Alpha down"]');
    expect(moveDownButton).not.toBeNull();

    act(() => {
      moveDownButton.click();
    });

    const after = Array.from(container.querySelectorAll('a[href^="/meetings/"]')).map((link) => link.textContent.trim());
    expect(after).toEqual(["Bravo", "Alpha"]);
    cleanup();
  });
});
