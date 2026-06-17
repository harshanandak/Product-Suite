import { describe, expect, test } from "bun:test";

// The Toaster renders a portal and reads our ThemeProvider context, so it needs
// a browser environment to render; we smoke-test the module here and exercise
// it in the app shell integration tests.
import * as Sonner from "./sonner";

describe("ui Sonner module", () => {
  test("loads and exposes a Toaster export", () => {
    expect(typeof Sonner.Toaster).toBe("function");
  });
});
