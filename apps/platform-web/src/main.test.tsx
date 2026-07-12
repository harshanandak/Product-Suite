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

// motion/react is a sizable module; the entrypoint only needs MotionConfig to
// pass its children through. Mocking it keeps the dynamic import() fast and
// deterministic (the real lib can exceed the 5s test timeout under suite load).
vi.mock("motion/react", () => ({
  MotionConfig: ({ children }: { children: React.ReactNode }) => children,
}));

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

    // The app root must wrap the tree in <MotionConfig reducedMotion="user"> so
    // motion honors the OS reduced-motion preference (DESIGN §8). render() is a
    // spy no-op, so assert the prop on the element tree handed to it.
    const rootElement = renderSpy.mock.calls[0][0];
    expect(rootElement.props.children.props.reducedMotion).toBe("user");
    // Generous timeout: this dynamically imports the entry, which cold-transforms
    // the @product-suite/ui source graph (deps.inline) — variable and, on a loaded
    // machine, can exceed 20s. 40s gives headroom without masking a real hang.
  }, 40000);
});
