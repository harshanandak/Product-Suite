// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModuleBoundary } from "../module-boundary";

function ThrowingModule(): ReactNode {
  throw new Error("module load failed");
}

describe("module boundary", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let roots: Root[];

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    roots = [];
  });

  afterEach(async () => {
    for (const root of roots) {
      await act(async () => {
        root.unmount();
      });
    }

    consoleErrorSpy.mockRestore();
  });

  it("contains module child failures inside a scoped fallback", async () => {
    const container = document.createElement("div");
    const root = createTrackedRoot(container, roots);

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

  it("clears the scoped failure state when retry succeeds", async () => {
    const container = document.createElement("div");
    const root = createTrackedRoot(container, roots);
    let shouldThrow = true;

    function RecoverableModule(): ReactNode {
      if (shouldThrow) {
        throw new Error("temporary module failure");
      }

      return <p>Recovered module</p>;
    }

    await act(async () => {
      root.render(
        <ModuleBoundary moduleName="Canvas">
          <RecoverableModule />
        </ModuleBoundary>,
      );
    });

    expect(container.textContent).toContain("Canvas module could not load");
    shouldThrow = false;

    const retryButton = container.querySelector("button");
    expect(retryButton).not.toBeNull();

    await act(async () => {
      retryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Recovered module");
    expect(container.textContent).not.toContain("Canvas module could not load");
  });
});

function createTrackedRoot(container: Element, roots: Root[]) {
  const root = createRoot(container);
  roots.push(root);

  return root;
}
