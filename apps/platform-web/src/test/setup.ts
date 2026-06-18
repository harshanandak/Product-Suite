import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom implements scrollTo as a stub that throws "Not implemented"; TanStack
// Router's scroll restoration calls it on every navigation. Replace with a noop.
if (typeof globalThis.window !== "undefined") {
  globalThis.scrollTo = () => {};

  // jsdom does not implement matchMedia, which ThemeProvider relies on.
  if (typeof globalThis.matchMedia !== "function") {
    globalThis.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      });
  }
}

afterEach(() => {
  cleanup();
});
