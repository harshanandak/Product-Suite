// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModuleBoundary } from "../module-boundary";

function ThrowingModule() {
  throw new Error("module load failed");

  return null;
}

describe("module boundary", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("contains module child failures inside a scoped fallback", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ModuleBoundary moduleName="Meetings">
          <ThrowingModule />
        </ModuleBoundary>,
      );
    });

    expect(container.textContent).toContain("Meetings module could not load");
    expect(container.textContent).toContain("Try again");
    expect(container.textContent).toContain("module load failed");
  });
});
