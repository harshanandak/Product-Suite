import { beforeEach, describe, expect, test, vi } from "vitest";
import { identityScopeContract, meetingCoreContract } from "@product-suite/contracts";

import {
  getCachedRuntimeConfig,
  getAuthState,
  initializeRuntimeConfig,
  normalizeRuntimeConfig,
  setAuthToken,
  setRuntimeConfig,
} from "../runtimeConfig";

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
    vi.unstubAllEnvs();
    delete process.env.VITE_BACKEND_URL;
    delete process.env.VITE_REACT_APP_BACKEND_URL;
    delete process.env.REACT_APP_BACKEND_URL;
    global.window = {
      localStorage: createStorage(),
      location: {
        hostname: "localhost",
        origin: "http://localhost:3000",
        port: "3000",
      },
    };
    global.fetch = undefined;
    setRuntimeConfig({});
    window.localStorage.clear();
    setAuthToken("");
  });

  test("normalizes backendUrl and preserves Neon auth metadata", () => {
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
    expect(config.auth[identityScopeContract.auth.providerKey]).toBe("neon");
    expect(config.auth.neon.auth_url).toBe("https://project-123.neon.tech/auth");
  });

  test("uses shared contracts for runtime and auth field naming", () => {
    const config = normalizeRuntimeConfig({
      [meetingCoreContract.runtimeConfig.backendUrlKey]: "https://api.example",
      auth: {
        [identityScopeContract.auth.providerKey]: "neon",
      },
    });

    expect(meetingCoreContract.runtimeConfig.backendUrlKey).toBe("backend_url");
    expect(identityScopeContract.auth.providerKey).toBe("provider");
    expect(config.backendUrl).toBe("https://api.example");
    expect(config.auth[identityScopeContract.auth.providerKey]).toBe("neon");
  });

  test("normalized auth flags override conflicting nested auth values", () => {
    const config = normalizeRuntimeConfig({
      deployment_mode: "hosted",
      auth_required: true,
      auth_mode: "token",
      auth: {
        required: false,
      },
    });

    expect(config.authRequired).toBe(true);
    expect(config.authMode).toBe("token");
    expect(config.auth.required).toBe(true);
    expect(config.auth.mode).toBe("token");
    expect(config.auth.provider).toBe("neon");
  });

  test("reports authenticated state when a token is stored", () => {
    setRuntimeConfig({ authRequired: true });
    setAuthToken("test-token");

    expect(getAuthState()).toEqual({
      status: "authenticated",
      token: "test-token",
    });
  });

  test("returns the seeded runtime config after setRuntimeConfig", () => {
    expect(getCachedRuntimeConfig()).not.toBeNull();
  });

  test("normalization prefers the backend_url field over stale cached backendUrl values", async () => {
    const config = normalizeRuntimeConfig({
      backendUrl: "http://localhost:8000",
      backend_url: "https://api.example",
      deployment_mode: "hosted",
      auth: {
        required: true,
        provider: "neon",
        neon: {
          auth_url: "https://project.neon.tech/auth",
        },
      },
    });

    expect(config.apiBaseUrl).toBe("https://api.example/api");
    expect(config.backendUrl).toBe("https://api.example");
  });

  test("initializeRuntimeConfig prefers deploy env over cached backend origin", async () => {
    vi.stubEnv("VITE_BACKEND_URL", "https://current.example");
    window.localStorage.setItem(
      "meeting-agent.runtime-config",
      JSON.stringify({
        deployment_mode: "hosted",
        backend_url: "https://stale.example",
        auth: {
          required: true,
          provider: "neon",
        },
      }),
    );

    const fetchCalls = [];
    global.fetch = async (url) => {
      fetchCalls.push(url);

      if (url === "/runtime-config.json") {
        return {
          ok: false,
          status: 404,
          text: async () => "",
        };
      }

      if (url === "https://current.example/api/runtime-config") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            deployment_mode: "hosted",
            backend_url: "https://current.example",
            auth: {
              required: true,
              provider: "neon",
            },
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    };

    const config = await initializeRuntimeConfig({ force: true });

    expect(fetchCalls).toContain("https://current.example/api/runtime-config");
    expect(config.backendUrl).toBe("https://current.example");
    expect(config.apiBaseUrl).toBe("https://current.example/api");
  });

  test("initializeRuntimeConfig prefers runtime-config file over cached backend origin when no env is set", async () => {
    window.__MEETING_AGENT_CONFIG__ = undefined;
    window.localStorage.setItem(
      "meeting-agent.runtime-config",
      JSON.stringify({
        deployment_mode: "hosted",
        backend_url: "https://stale.example",
        auth: {
          required: true,
          provider: "neon",
        },
      }),
    );

    const fetchCalls = [];
    global.fetch = async (url) => {
      fetchCalls.push(url);

      if (url === "/runtime-config.json") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              deployment_mode: "hosted",
              backend_url: "https://file.example",
              auth: {
                required: true,
                provider: "neon",
              },
            }),
        };
      }

      if (url === "https://file.example/api/runtime-config") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            deployment_mode: "hosted",
            backend_url: "https://file.example",
            auth: {
              required: true,
              provider: "neon",
            },
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    };

    const config = await initializeRuntimeConfig({ force: true });

    expect(fetchCalls).toContain("https://file.example/api/runtime-config");
    expect(config.backendUrl).toBe("https://file.example");
    expect(config.apiBaseUrl).toBe("https://file.example/api");
  });

  test("initializeRuntimeConfig honors apiBaseUrl aliases from runtime-config sources", async () => {
    window.__MEETING_AGENT_CONFIG__ = undefined;
    window.localStorage.setItem(
      "meeting-agent.runtime-config",
      JSON.stringify({
        deployment_mode: "hosted",
        apiBaseUrl: "https://stale.example/api",
        auth: {
          required: true,
          provider: "neon",
        },
      }),
    );

    const fetchCalls = [];
    global.fetch = async (url) => {
      fetchCalls.push(url);

      if (url === "/runtime-config.json") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              deployment_mode: "hosted",
              api_base_url: "https://file.example/api",
              auth: {
                required: true,
                provider: "neon",
              },
            }),
        };
      }

      if (url === "https://file.example/api/runtime-config") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            deployment_mode: "hosted",
            api_base_url: "https://file.example/api",
            auth: {
              required: true,
              provider: "neon",
            },
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    };

    const config = await initializeRuntimeConfig({ force: true });

    expect(fetchCalls).toContain("https://file.example/api/runtime-config");
    expect(config.backendUrl).toBe("https://file.example");
    expect(config.apiBaseUrl).toBe("https://file.example/api");
  });

  test("initializeRuntimeConfig ignores stale cached backend origin on local Vite ports", async () => {
    window.__MEETING_AGENT_CONFIG__ = undefined;
    window.localStorage.setItem(
      "meeting-agent.runtime-config",
      JSON.stringify({
        deployment_mode: "oss",
        backend_url: "http://localhost:8000",
        api_base_url: "http://localhost:8000/api",
        auth: {
          required: false,
          provider: "local",
        },
      }),
    );

    const fetchCalls = [];
    global.fetch = async (url) => {
      fetchCalls.push(url);

      if (url === "/runtime-config.json") {
        return {
          ok: false,
          status: 404,
          text: async () => "",
        };
      }

      if (url === "http://localhost:3000/api/runtime-config") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            deployment_mode: "oss",
            auth: {
              required: false,
              provider: "local",
            },
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    };

    const config = await initializeRuntimeConfig({ force: true });

    expect(fetchCalls).toContain("http://localhost:3000/api/runtime-config");
    expect(config.backendUrl).toBe("http://localhost:3000");
    expect(config.apiBaseUrl).toBe("http://localhost:3000/api");
  });

  test("fails clearly when hosted mode is injected without any resolvable backend origin", async () => {
    global.window = {
      localStorage: createStorage(),
      location: {
        hostname: "",
        origin: "",
        port: "",
      },
    };
    global.fetch = async (url) => {
      if (url === "/runtime-config.json") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              deployment_mode: "hosted",
              auth: {
                required: true,
                provider: "neon",
              },
            }),
        };
      }

      return {
        ok: false,
        status: 502,
        text: async () => "bad gateway",
      };
    };

    await expect(initializeRuntimeConfig({ force: true })).rejects.toThrow(
      "Hosted deployment requires a resolvable backend origin",
    );
  });

  test("fails clearly when hosted fallback config omits auth requirements", async () => {
    global.window = {
      localStorage: createStorage(),
      location: {
        hostname: "",
        origin: "",
        port: "",
      },
    };
    global.fetch = async (url) => {
      if (url === "/runtime-config.json") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              deployment_mode: "hosted",
              backend_url: "https://api.example",
            }),
        };
      }

      return {
        ok: false,
        status: 503,
        text: async () => "service unavailable",
      };
    };

    await expect(initializeRuntimeConfig({ force: true })).rejects.toThrow(
      "Hosted deployment requires auth.required in runtime config.",
    );
  });
});
