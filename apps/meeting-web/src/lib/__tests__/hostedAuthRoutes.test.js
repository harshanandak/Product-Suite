import { beforeEach, describe, expect, test } from "vitest";

import {
  HOSTED_AUTH_CALLBACK_PATH,
  HOSTED_AUTH_SIGNED_OUT_PATH,
  HOSTED_AUTH_SIGN_IN_PATH,
  clearHostedPostLoginPath,
  getHostedPostLoginPath,
  normalizeHostedAuthPath,
  resolveHostedPostLoginPath,
  sanitizeSameOriginPath,
  setHostedPostLoginPath,
  stripHostedAuthParams,
} from "../hostedAuthRoutes";

function createStorage() {
  const values = new Map();
  return {
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

describe("hostedAuthRoutes", () => {
  beforeEach(() => {
    global.window = {
      location: {
        href: "https://meeting-agent.example.com/auth/callback?code=abc&state=def&error=none",
        origin: "https://meeting-agent.example.com",
      },
      sessionStorage: createStorage(),
    };
  });

  test("normalizes auth paths and strips callback query parameters", () => {
    expect(normalizeHostedAuthPath("/auth/sign-in/")).toBe(HOSTED_AUTH_SIGN_IN_PATH);
    expect(stripHostedAuthParams()).toBe(HOSTED_AUTH_CALLBACK_PATH);
  });

  test("keeps post-login redirects on same-origin non-auth paths", () => {
    setHostedPostLoginPath("/meetings/active?tab=summary");
    expect(getHostedPostLoginPath()).toBe("/meetings/active?tab=summary");

    expect(resolveHostedPostLoginPath(HOSTED_AUTH_SIGN_IN_PATH)).toBe("/");
    expect(resolveHostedPostLoginPath(HOSTED_AUTH_CALLBACK_PATH)).toBe("/");
    expect(resolveHostedPostLoginPath(HOSTED_AUTH_SIGNED_OUT_PATH)).toBe("/");

    clearHostedPostLoginPath();
    expect(getHostedPostLoginPath()).toBe("/");
  });

  test("rejects external redirect targets", () => {
    expect(sanitizeSameOriginPath("https://evil.example.com/attack")).toBe("/");
  });
});
