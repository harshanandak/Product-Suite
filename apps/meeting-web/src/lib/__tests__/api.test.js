import axios from "axios";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { identityScopeContract, meetingCoreContract } from "@product-suite/contracts";

const hostedAuthClient = {
  getSession: vi.fn(),
  getJWTToken: vi.fn(),
  token: vi.fn(),
  signOut: vi.fn(),
  signIn: {
    email: vi.fn(),
    social: vi.fn(),
  },
  signUp: {
    email: vi.fn(),
  },
};

vi.mock("axios", () => {
  const apiClient = {
    interceptors: {
      request: {
        use: vi.fn(),
      },
    },
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  };

  return {
    default: {
      create: vi.fn(() => apiClient),
    },
  };
});

vi.mock("@neondatabase/neon-js/auth", () => ({
  createAuthClient: vi.fn(() => hostedAuthClient),
}));

vi.mock("@neondatabase/neon-js/auth/react/adapters", () => ({
  BetterAuthReactAdapter: vi.fn(() => ({ kind: "react-adapter" })),
}));

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

function createFetchResponse({ ok = true, status = 200, jsonData = {}, textData = "" } = {}) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(jsonData),
    text: vi.fn().mockResolvedValue(textData || JSON.stringify(jsonData)),
  };
}

function installFetchMock({
  runtimePayload = {
    deployment_mode: "oss",
    backend_url: "https://backend.example",
    auth: { required: false },
  },
  runtimeConfigFile = null,
  tokenResponse = null,
  runtimeConfigStatus = 200,
} = {}) {
  global.fetch = vi.fn(async (url) => {
    const normalizedUrl = String(url);

    if (normalizedUrl === "/runtime-config.json") {
      if (!runtimeConfigFile) {
        return createFetchResponse({ ok: false, status: 404, textData: "not found" });
      }
      return createFetchResponse({ jsonData: runtimeConfigFile });
    }

    if (normalizedUrl.endsWith("/api/runtime-config")) {
      return createFetchResponse({
        ok: runtimeConfigStatus >= 200 && runtimeConfigStatus < 300,
        status: runtimeConfigStatus,
        jsonData: runtimePayload,
        textData: runtimeConfigStatus >= 200 && runtimeConfigStatus < 300 ? "" : "runtime config error",
      });
    }

    if (normalizedUrl.endsWith("/token")) {
      if (tokenResponse instanceof Error) {
        throw tokenResponse;
      }

      return tokenResponse || createFetchResponse({ ok: false, status: 404, textData: "missing token endpoint" });
    }

    throw new Error(`Unexpected fetch url: ${normalizedUrl}`);
  });
}

describe("api runtime config bootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
    axios.create.mockClear();
    hostedAuthClient.getSession.mockReset();
    hostedAuthClient.getJWTToken.mockReset();
    hostedAuthClient.token.mockReset();
    hostedAuthClient.signOut.mockReset();
    hostedAuthClient.signIn.email.mockReset();
    hostedAuthClient.signIn.social.mockReset();
    hostedAuthClient.signUp.email.mockReset();

    delete process.env.VITE_BACKEND_URL;
    delete process.env.VITE_REACT_APP_BACKEND_URL;
    process.env.REACT_APP_BACKEND_URL = "https://backend.example";

    global.window = {
      localStorage: createStorage(),
      sessionStorage: createStorage(),
      location: {
        hostname: "localhost",
        origin: "http://localhost:3000",
        port: "3000",
      },
    };
  });

  test("preserves hosted auth provider metadata from runtime-config", async () => {
    process.env.REACT_APP_BACKEND_URL = "";

    installFetchMock({
      runtimePayload: {
        deployment_mode: "hosted",
        tenant_mode: "organization",
        backend_url: "https://api.example",
        auth: {
          required: true,
          mode: "bearer",
          provider: "neon",
          supported_providers: ["email", "google"],
          organization_required: true,
          onboarding_required: true,
          neon: {
            auth_url: "https://project-123.neon.tech/auth",
          },
        },
      },
    });

    const { initializeRuntimeConfig } = await import("../api.js");
    const config = await initializeRuntimeConfig();

    expect(config.auth[identityScopeContract.auth.providerKey]).toBe("neon");
    expect(config.auth[identityScopeContract.auth.supportedProvidersKey]).toEqual(["email", "google"]);
    expect(config.auth[identityScopeContract.auth.organizationRequiredKey]).toBe(true);
    expect(config.auth[identityScopeContract.auth.onboardingRequiredKey]).toBe(true);
    expect(config.auth.neon.auth_url).toBe("https://project-123.neon.tech/auth");
  });

  test("imports shared contracts for hosted runtime payload field access", () => {
    const apiSource = readFileSync(new URL("../api.js", import.meta.url), "utf8");

    expect(apiSource).toContain("@product-suite/contracts");
    expect(meetingCoreContract.runtimeConfig.auth.providerKey).toBe("provider");
    expect(meetingCoreContract.runtimeConfig.auth.neonAuthUrlKey).toBe("auth_url");
  });

  test("constructs hosted auth client with the React adapter export", async () => {
    process.env.REACT_APP_BACKEND_URL = "";
    installFetchMock({
      runtimePayload: {
        deployment_mode: "hosted",
        tenant_mode: "organization",
        backend_url: "https://api.example",
        auth: {
          required: true,
          mode: "bearer",
          provider: "neon",
          neon: {
            auth_url: "https://project-123.neon.tech/auth/",
          },
        },
      },
    });

    const { createAuthClient } = await import("@neondatabase/neon-js/auth");
    const { BetterAuthReactAdapter } = await import("@neondatabase/neon-js/auth/react/adapters");
    const { signInHostedWithEmail } = await import("../api.js");

    await signInHostedWithEmail({
      email: "user@example.com",
      password: "password-123",
    });

    expect(BetterAuthReactAdapter).toHaveBeenCalledTimes(1);
    expect(createAuthClient).toHaveBeenCalledWith("https://project-123.neon.tech/auth", {
      adapter: { kind: "react-adapter" },
    });
    expect(hostedAuthClient.signIn.email).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "password-123",
    });
  });

  test("prefers VITE_BACKEND_URL over the REACT_APP compatibility alias", async () => {
    process.env.VITE_BACKEND_URL = "https://vite.example";
    process.env.REACT_APP_BACKEND_URL = "https://legacy.example";
    installFetchMock();

    const { initializeRuntimeConfig } = await import("../api.js");
    await initializeRuntimeConfig();

    const runtimeConfigCall = global.fetch.mock.calls.find(([url]) => String(url).endsWith("/api/runtime-config"));
    expect(runtimeConfigCall?.[0]).toBe("https://vite.example/api/runtime-config");
  });

  test("falls back to REACT_APP_BACKEND_URL while the alias is still supported", async () => {
    process.env.REACT_APP_BACKEND_URL = "https://legacy.example";
    installFetchMock();

    const { initializeRuntimeConfig } = await import("../api.js");
    await initializeRuntimeConfig();

    const runtimeConfigCall = global.fetch.mock.calls.find(([url]) => String(url).endsWith("/api/runtime-config"));
    expect(runtimeConfigCall?.[0]).toBe("https://legacy.example/api/runtime-config");
  });

  test("uses the current origin when the frontend is served from a Vite localhost port", async () => {
    process.env.REACT_APP_BACKEND_URL = "";
    global.window = {
      localStorage: createStorage(),
      sessionStorage: createStorage(),
      location: {
        hostname: "127.0.0.1",
        origin: "http://127.0.0.1:4176",
        port: "4176",
      },
    };
    installFetchMock({
      runtimePayload: {
        deployment_mode: "oss",
        backend_url: "",
        auth: { required: false },
      },
    });

    const { initializeRuntimeConfig } = await import("../api.js");
    await initializeRuntimeConfig();

    const runtimeConfigCall = global.fetch.mock.calls.find(([url]) => String(url).endsWith("/api/runtime-config"));
    expect(runtimeConfigCall?.[0]).toBe("http://127.0.0.1:4176/api/runtime-config");
  });

  test("uses the current origin for localhost deployments on non-dev ports", async () => {
    process.env.REACT_APP_BACKEND_URL = "";
    global.window = {
      localStorage: createStorage(),
      sessionStorage: createStorage(),
      location: {
        hostname: "localhost",
        origin: "http://localhost",
        port: "",
      },
    };
    installFetchMock({
      runtimePayload: {
        deployment_mode: "oss",
        backend_url: "",
        auth: { required: false },
      },
    });

    const { initializeRuntimeConfig } = await import("../api.js");
    await initializeRuntimeConfig();

    const runtimeConfigCall = global.fetch.mock.calls.find(([url]) => String(url).endsWith("/api/runtime-config"));
    expect(runtimeConfigCall?.[0]).toBe("http://localhost/api/runtime-config");
  });

  test("exposes hosted onboarding endpoints", async () => {
    installFetchMock({
      runtimePayload: {
        deployment_mode: "hosted",
        tenant_mode: "organization",
        backend_url: "https://api.example",
        auth: {
          required: true,
          mode: "bearer",
          provider: "neon",
          supported_providers: ["email", "google"],
          organization_required: true,
          onboarding_required: true,
          neon: {
            auth_url: "https://project-123.neon.tech/auth",
          },
        },
      },
      tokenResponse: createFetchResponse({
        ok: true,
        jsonData: { token: "provider-jwt-123" },
      }),
    });

    const {
      exchangeHostedSession,
      createOrganization,
      acceptOrganizationInvite,
      getHostedIdentityToken,
      getHostedSession,
      getOnboardingState,
      signInHostedWithEmail,
      signInHostedWithGoogle,
      signOutHostedSession,
      signUpHostedWithEmail,
    } = await import("../api.js");
    const apiClient = axios.create.mock.results.at(-1).value;

    apiClient.post.mockResolvedValue({ data: {} });
    apiClient.get.mockResolvedValue({ data: {} });
    hostedAuthClient.getSession.mockResolvedValue({ data: { user: { email: "user@example.com" } } });

    await getOnboardingState();
    expect(apiClient.get).toHaveBeenCalledWith("/auth/onboarding/state");

    await createOrganization("Team Alpha", "team-alpha");
    expect(apiClient.post).toHaveBeenCalledWith("/auth/onboarding/organizations", {
      name: "Team Alpha",
      slug: "team-alpha",
    });

    await acceptOrganizationInvite("invite-123");
    expect(apiClient.post).toHaveBeenCalledWith("/auth/onboarding/invitations/accept", {
      invite_token: "invite-123",
    });

    await signInHostedWithEmail({
      email: "user@example.com",
      password: "password-123",
    });
    expect(hostedAuthClient.signIn.email).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "password-123",
    });

    await signUpHostedWithEmail({
      email: "user@example.com",
      password: "password-123",
      name: "Ada",
    });
    expect(hostedAuthClient.signUp.email).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "password-123",
      name: "Ada",
    });

    await signInHostedWithGoogle("https://app.example.com/auth/callback");
    expect(hostedAuthClient.signIn.social).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: "https://app.example.com/auth/callback",
    });

    await expect(getHostedSession()).resolves.toEqual({ data: { user: { email: "user@example.com" } } });
    await expect(getHostedIdentityToken()).resolves.toBe("provider-jwt-123");

    await signOutHostedSession();
    expect(hostedAuthClient.signOut).toHaveBeenCalled();

    await exchangeHostedSession("provider-jwt-123");
    expect(apiClient.post).toHaveBeenCalledWith(
      "/auth/session/exchange",
      {
        provider_token: "provider-jwt-123",
        provider: "neon",
      },
    );
  });

  test("falls back to the hosted session token when the token endpoint returns a non-2xx response", async () => {
    installFetchMock({
      runtimePayload: {
        deployment_mode: "hosted",
        tenant_mode: "organization",
        backend_url: "https://api.example",
        auth: {
          required: true,
          mode: "bearer",
          provider: "neon",
          supported_providers: ["email", "google"],
          organization_required: true,
          onboarding_required: true,
          neon: {
            auth_url: "https://project-123.neon.tech/auth",
          },
        },
      },
      tokenResponse: createFetchResponse({
        ok: false,
        status: 500,
        textData: "token failed",
      }),
    });

    const { getHostedIdentityToken } = await import("../api.js");
    hostedAuthClient.getSession.mockResolvedValue({
      data: {
        session: {
          token: "session-jwt-456",
        },
      },
    });

    await expect(getHostedIdentityToken()).resolves.toBe("session-jwt-456");
  });

  test("reads hosted identity token from the Neon session when the token helper is unavailable", async () => {
    installFetchMock({
      runtimePayload: {
        deployment_mode: "hosted",
        tenant_mode: "organization",
        backend_url: "https://api.example",
        auth: {
          required: true,
          mode: "bearer",
          provider: "neon",
          supported_providers: ["email", "google"],
          organization_required: true,
          onboarding_required: true,
          neon: {
            auth_url: "https://project-123.neon.tech/auth",
          },
        },
      },
      tokenResponse: createFetchResponse({
        ok: true,
        jsonData: {},
      }),
    });

    const { getHostedIdentityToken } = await import("../api.js");
    hostedAuthClient.getSession.mockResolvedValue({
      data: {
        session: {
          token: "session-jwt-456",
        },
      },
    });

    await expect(getHostedIdentityToken()).resolves.toBe("session-jwt-456");
  });

  test("prefers the hosted JWT token endpoint over an opaque session token", async () => {
    installFetchMock({
      runtimePayload: {
        deployment_mode: "hosted",
        tenant_mode: "organization",
        backend_url: "https://api.example",
        auth: {
          required: true,
          mode: "bearer",
          provider: "neon",
          supported_providers: ["email", "google"],
          organization_required: true,
          onboarding_required: true,
          neon: {
            auth_url: "https://project-123.neon.tech/auth",
          },
        },
      },
      tokenResponse: createFetchResponse({
        ok: true,
        jsonData: {
          token: "provider-jwt-789",
        },
      }),
    });

    const { getHostedIdentityToken } = await import("../api.js");
    hostedAuthClient.getSession.mockResolvedValue({
      data: {
        session: {
          token: "opaque-session-token",
        },
      },
    });

    await expect(getHostedIdentityToken()).resolves.toBe("provider-jwt-789");
  });

  test("falls back to the hosted session token without calling the unsupported getJWTToken endpoint", async () => {
    installFetchMock({
      runtimePayload: {
        deployment_mode: "hosted",
        tenant_mode: "organization",
        backend_url: "https://api.example",
        auth: {
          required: true,
          mode: "bearer",
          provider: "neon",
          supported_providers: ["email", "google"],
          organization_required: true,
          onboarding_required: true,
          neon: {
            auth_url: "https://project-123.neon.tech/auth",
          },
        },
      },
      tokenResponse: createFetchResponse({
        ok: true,
        jsonData: {},
      }),
    });

    const { getHostedIdentityToken } = await import("../api.js");
    hostedAuthClient.getJWTToken.mockRejectedValue(new Error("HTTP 404"));
    hostedAuthClient.getSession.mockResolvedValue({
      data: {
        session: {
          token: "session-jwt-456",
        },
      },
    });

    await expect(getHostedIdentityToken()).resolves.toBe("session-jwt-456");
    expect(hostedAuthClient.getJWTToken).not.toHaveBeenCalled();
  });

  test("falls back to the hosted session token when the token endpoint throws a network error", async () => {
    installFetchMock({
      runtimePayload: {
        deployment_mode: "hosted",
        tenant_mode: "organization",
        backend_url: "https://api.example",
        auth: {
          required: true,
          mode: "bearer",
          provider: "neon",
          supported_providers: ["email", "google"],
          organization_required: true,
          onboarding_required: true,
          neon: {
            auth_url: "https://project-123.neon.tech/auth",
          },
        },
      },
      tokenResponse: new TypeError("Failed to fetch"),
    });

    const { getHostedIdentityToken } = await import("../api.js");
    hostedAuthClient.getSession.mockResolvedValue({
      data: {
        session: {
          token: "session-jwt-456",
        },
      },
    });

    await expect(getHostedIdentityToken()).resolves.toBe("session-jwt-456");
  });

  test("falls back to the hosted session token when the token helper throws", async () => {
    installFetchMock({
      runtimePayload: {
        deployment_mode: "hosted",
        tenant_mode: "organization",
        backend_url: "https://api.example",
        auth: {
          required: true,
          mode: "bearer",
          provider: "neon",
          supported_providers: ["email", "google"],
          organization_required: true,
          onboarding_required: true,
          neon: {
            auth_url: "https://project-123.neon.tech/auth",
          },
        },
      },
      tokenResponse: createFetchResponse({
        ok: true,
        jsonData: {},
      }),
    });

    const { getHostedIdentityToken } = await import("../api.js");
    hostedAuthClient.token.mockRejectedValue(new Error("token helper unavailable"));
    hostedAuthClient.getSession.mockResolvedValue({
      data: {
        session: {
          token: "session-jwt-456",
        },
      },
    });

    await expect(getHostedIdentityToken()).resolves.toBe("session-jwt-456");
  });

  test("throws a clear exhaustion error when every hosted token source is unavailable", async () => {
    installFetchMock({
      runtimePayload: {
        deployment_mode: "hosted",
        tenant_mode: "organization",
        backend_url: "https://api.example",
        auth: {
          required: true,
          mode: "bearer",
          provider: "neon",
          supported_providers: ["email", "google"],
          organization_required: true,
          onboarding_required: true,
          neon: {
            auth_url: "https://project-123.neon.tech/auth",
          },
        },
      },
      tokenResponse: createFetchResponse({
        ok: true,
        jsonData: {},
      }),
    });

    const { getHostedIdentityToken } = await import("../api.js");
    hostedAuthClient.token.mockResolvedValue(null);
    hostedAuthClient.getSession.mockResolvedValue({ data: { session: {} } });

    await expect(getHostedIdentityToken()).rejects.toThrow(
      "Hosted identity token is unavailable: all token sources exhausted",
    );
  });

  test("rejects hosted auth calls when Neon auth is not configured", async () => {
    installFetchMock({
      runtimePayload: {
        deployment_mode: "hosted",
        tenant_mode: "organization",
        backend_url: "https://api.example",
        auth: {
          required: true,
          mode: "bearer",
          provider: "neon",
          supported_providers: ["email", "google"],
          organization_required: true,
          onboarding_required: true,
          neon: {},
        },
      },
    });

    const { signInHostedWithEmail } = await import("../api.js");

    await expect(
      signInHostedWithEmail({
        email: "user@example.com",
        password: "password-123",
      })
    ).rejects.toThrow("Hosted Neon auth is not configured");
  });
});
