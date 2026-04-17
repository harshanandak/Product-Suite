import { beforeEach, describe, expect, test } from "vitest";

import {
  getAuthState,
  normalizeRuntimeConfig,
  setAuthToken,
  setRuntimeConfig,
} from "../lib/runtimeConfig";

function createStorage() {
  const values = new Map();
  return {
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

describe("runtimeConfig helpers", () => {
  beforeEach(() => {
    global.window = {
      localStorage: createStorage(),
    };
    window.localStorage.clear();
    setRuntimeConfig({});
    setAuthToken("");
  });

  test("normalizes backendUrl into apiBaseUrl", () => {
    const config = normalizeRuntimeConfig({
      backendUrl: "http://localhost:8000/",
      authRequired: true,
      auth: {
        provider: "neon",
        neon: {
          auth_url: "https://project-123.neon.tech/auth",
        },
      },
    });

    expect(config.apiBaseUrl).toBe("http://localhost:8000/api");
    expect(config.authRequired).toBe(true);
    expect(config.authMode).toBe("token");
    expect(config.auth.provider).toBe("neon");
    expect(config.auth.neon.auth_url).toBe("https://project-123.neon.tech/auth");
  });

  test("reports authenticated state when a token is stored", () => {
    setRuntimeConfig({ authRequired: true });
    setAuthToken("test-token");

    expect(getAuthState()).toEqual({
      status: "authenticated",
      token: "test-token",
    });
  });
});
