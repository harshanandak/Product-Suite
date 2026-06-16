import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted spies so the react-dom/client mock factory can reference them.
const { renderSpy, createRootSpy } = vi.hoisted(() => {
  const render = vi.fn();
  return {
    renderSpy: render,
    createRootSpy: vi.fn(() => ({ render, unmount: vi.fn() })),
  };
});

vi.mock("react-dom/client", () => ({
  createRoot: createRootSpy,
}));

// Clerk pulls in browser-only SDK internals; stub the names main.tsx imports.
vi.mock("@clerk/clerk-react", () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Keep module load light: avoid pulling the real router tree / shell components.
vi.mock("./router", () => ({ router: {} }));
vi.mock("./shell/SetupNotice", () => ({ SetupNotice: () => null }));

describe("main entrypoint", () => {
  beforeEach(() => {
    vi.resetModules();
    renderSpy.mockClear();
    createRootSpy.mockClear();
    document.body.innerHTML = '<div id="root"></div>';
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("mounts the app into #root via createRoot().render()", async () => {
    await import("./main");

    expect(createRootSpy).toHaveBeenCalledTimes(1);
    expect(createRootSpy).toHaveBeenCalledWith(document.getElementById("root"));
    expect(renderSpy).toHaveBeenCalledTimes(1);
  });
});
